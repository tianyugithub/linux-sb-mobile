package sb.linux.mobile

import java.io.IOException
import java.io.InputStream
import java.io.OutputStream
import java.net.InetAddress
import java.net.InetSocketAddress
import java.net.Socket
import java.net.SocketAddress
import javax.net.SocketFactory

/**
 * 把 TLS ClientHello 从 `linux.sb` 中间切开，发给只看单个记录的中间盒。
 *
 * DoH / 直连都会拆 ClientHello；旧镜像通道已下线。
 * RECORD：同一条 ClientHello 拆成两个合法 TLS 记录（RFC 8446 §5.1），
 * Cloudflare 会重组；墙如果只扫单个记录就看不到完整名字。
 */
object TlsFrag {
  enum class Style { NONE, SEGMENT, RECORD }

  @Volatile
  var style: Style = Style.NONE
    private set

  val enabled: Boolean get() = style != Style.NONE

  const val SPLIT_DELAY_MS = 20L

  fun install() {
    runCatching {
      System.setProperty("org.conscrypt.useEngineSocket", "true")
      System.setProperty("com.android.org.conscrypt.useEngineSocket", "true")
    }
  }

  fun configure(on: Boolean) {
    style = if (on) Style.RECORD else Style.NONE
  }

  fun sniRange(b: ByteArray, off: Int, len: Int): IntRange? =
    try {
      findSni(b, off, len)
    } catch (_: RuntimeException) {
      null
    }

  fun cutAt(b: ByteArray, off: Int, len: Int): Int? {
    val name = sniRange(b, off, len) ?: return null
    if (!blockedSni(b, name)) return null
    val at = name.first + (name.last - name.first + 1) / 2
    return if (at > off && at < off + len) at else null
  }

  fun records(b: ByteArray, off: Int, len: Int): Pair<ByteArray, ByteArray>? {
    val at = cutAt(b, off, len) ?: return null
    val body = off + 5
    val end = body + u16(b, off + 3)
    return (header(b, off, at - body) + b.copyOfRange(body, at)) to
      (header(b, off, end - at) + b.copyOfRange(at, off + len))
  }

  fun write(out: OutputStream, b: ByteArray, off: Int, len: Int, how: Style = style): Boolean {
    val halves = when (how) {
      Style.NONE -> null
      Style.RECORD -> records(b, off, len)
      Style.SEGMENT -> cutAt(b, off, len)?.let { at ->
        b.copyOfRange(off, at) to b.copyOfRange(at, off + len)
      }
    }
    if (halves == null) {
      out.write(b, off, len)
      out.flush()
      return false
    }
    out.write(halves.first)
    out.flush()
    pause()
    out.write(halves.second)
    out.flush()
    return true
  }

  /**
   * WebView CONNECT 隧道：先拼出第一条 TLS 记录再决定拆不拆。
   * Chromium 可能把 ClientHello 拆成多次 write，按记录重组才靠得住。
   */
  fun copyUplink(from: InputStream, to: OutputStream) {
    if (!enabled) {
      copy(from, to)
      return
    }
    val header = readExact(from, 5)
    if (header == null) return
    if (header.size < 5 || (header[0].toInt() and 0xFF) != HANDSHAKE) {
      to.write(header)
      to.flush()
      copy(from, to)
      return
    }
    val recLen = u16(header, 3)
    if (recLen <= 0 || recLen > 16_384) {
      to.write(header)
      to.flush()
      copy(from, to)
      return
    }
    val body = readExact(from, recLen)
    if (body == null || body.size < recLen) {
      to.write(header)
      if (body != null) to.write(body)
      to.flush()
      copy(from, to)
      return
    }
    val record = header + body
    val split = write(to, record, 0, record.size)
    if (split) android.util.Log.i("lsb-tls", "webview split ${record.size}B")
    copy(from, to)
  }

  val factory: SocketFactory = FragSocketFactory()

  private fun blockedSni(b: ByteArray, name: IntRange): Boolean {
    val host = String(b, name.first, name.last - name.first + 1, Charsets.US_ASCII).lowercase()
    return host == "linux.sb" || host.endsWith(".linux.sb")
  }

  private fun findSni(b: ByteArray, off: Int, len: Int): IntRange? {
    if (len < 47) return null
    if ((b[off].toInt() and 0xFF) != HANDSHAKE) return null
    if ((b[off + 5].toInt() and 0xFF) != CLIENT_HELLO) return null
    val end = off + 5 + u16(b, off + 3)
    if (end > off + len) return null
    var i = off + 43
    i += 1 + (b[i].toInt() and 0xFF)
    i += 2 + u16(b, i)
    i += 1 + (b[i].toInt() and 0xFF)
    if (i + 2 > end) return null
    val extensions = minOf(i + 2 + u16(b, i), end)
    i += 2
    while (i + 4 <= extensions) {
      val type = u16(b, i)
      val size = u16(b, i + 2)
      val data = i + 4
      if (data + size > extensions) return null
      if (type == SERVER_NAME) return hostName(b, data, size)
      i = data + size
    }
    return null
  }

  private fun hostName(b: ByteArray, data: Int, size: Int): IntRange? {
    val listEnd = data + size
    var i = data + 2
    while (i + 3 <= listEnd) {
      val nameType = b[i].toInt() and 0xFF
      val nameLen = u16(b, i + 1)
      val start = i + 3
      if (start + nameLen > listEnd) return null
      if (nameType == HOST_NAME && nameLen >= 2) return start until start + nameLen
      i = start + nameLen
    }
    return null
  }

  private fun header(b: ByteArray, off: Int, length: Int): ByteArray = byteArrayOf(
    b[off], b[off + 1], b[off + 2], (length shr 8).toByte(), length.toByte(),
  )

  private fun pause() {
    try {
      Thread.sleep(SPLIT_DELAY_MS)
    } catch (_: InterruptedException) {
      Thread.currentThread().interrupt()
    }
  }

  private fun copy(from: InputStream, to: OutputStream) {
    try {
      val buf = ByteArray(16 * 1024)
      while (true) {
        val n = from.read(buf)
        if (n <= 0) break
        to.write(buf, 0, n)
        to.flush()
      }
    } catch (_: Exception) {
      /* peer closed */
    }
  }

  private fun readExact(input: InputStream, n: Int): ByteArray? {
    val buf = ByteArray(n)
    var off = 0
    while (off < n) {
      val r = try {
        input.read(buf, off, n - off)
      } catch (_: IOException) {
        return if (off == 0) null else buf.copyOf(off)
      }
      if (r < 0) return if (off == 0) null else buf.copyOf(off)
      off += r
    }
    return buf
  }

  internal fun u16(b: ByteArray, at: Int): Int =
    ((b[at].toInt() and 0xFF) shl 8) or (b[at + 1].toInt() and 0xFF)

  private const val HANDSHAKE = 0x16
  private const val CLIENT_HELLO = 0x01
  private const val SERVER_NAME = 0x0000
  private const val HOST_NAME = 0x00
}

class FragSocket(private val style: TlsFrag.Style) : Socket() {
  private var stream: FragStream? = null
  val wrote: Boolean get() = stream?.wrote == true
  val split: Boolean get() = stream?.split == true

  override fun connect(endpoint: SocketAddress?, timeout: Int) {
    super.connect(endpoint, timeout)
    runCatching { tcpNoDelay = true }
  }

  @Synchronized
  override fun getOutputStream(): OutputStream {
    stream?.let { return it }
    return FragStream(super.getOutputStream(), style).also { stream = it }
  }
}

class FragStream(
  private val out: OutputStream,
  private val style: TlsFrag.Style,
) : OutputStream() {
  @Volatile
  var wrote = false
    private set

  @Volatile
  var split = false
    private set

  private var first = true

  override fun write(b: Int) {
    first = false
    wrote = true
    out.write(b)
  }

  override fun write(b: ByteArray) = write(b, 0, b.size)

  override fun write(b: ByteArray, off: Int, len: Int) {
    if (!first || style == TlsFrag.Style.NONE) {
      wrote = true
      out.write(b, off, len)
      return
    }
    first = false
    wrote = true
    split = TlsFrag.write(out, b, off, len, style)
  }

  override fun flush() = out.flush()

  override fun close() = out.close()
}

class FragSocketFactory : SocketFactory() {
  private fun open() = FragSocket(TlsFrag.style)

  override fun createSocket(): Socket = open()

  override fun createSocket(host: String, port: Int): Socket =
    open().also { it.connect(InetSocketAddress(host, port)) }

  override fun createSocket(host: String, port: Int, localHost: InetAddress, localPort: Int): Socket =
    open().also {
      it.bind(InetSocketAddress(localHost, localPort))
      it.connect(InetSocketAddress(host, port))
    }

  override fun createSocket(address: InetAddress, port: Int): Socket =
    open().also { it.connect(InetSocketAddress(address, port)) }

  override fun createSocket(
    address: InetAddress,
    port: Int,
    localAddress: InetAddress,
    localPort: Int,
  ): Socket = open().also {
    it.bind(InetSocketAddress(localAddress, localPort))
    it.connect(InetSocketAddress(address, port))
  }
}
