package sb.linux.mobile

import androidx.webkit.ProxyConfig
import androidx.webkit.ProxyController
import androidx.webkit.WebViewFeature
import okhttp3.Dns
import java.io.ByteArrayOutputStream
import java.io.InputStream
import java.io.OutputStream
import java.net.InetAddress
import java.net.InetSocketAddress
import java.net.ServerSocket
import java.net.Socket
import java.util.concurrent.Executors
import kotlin.concurrent.thread

/**
 * 内置 WebView 走系统 DNS，国内会把 linux.sb 解析成假 IP。
 * 在本机起一个只监听 127.0.0.1 的 CONNECT 代理：解析用 DohDns，
 * TLS 仍由 WebView 和官网直接完成（不做中间人）。
 * DoH / 直连时把第一条 ClientHello 拆成两个 TLS 记录再送出。
 */
object WebDnsProxy {
  fun start(dns: Dns) {
    val server = try {
      ServerSocket(0, 32, InetAddress.getByName("127.0.0.1"))
    } catch (_: Exception) {
      return
    }
    val port = server.localPort
    thread(name = "lsb-web-proxy", isDaemon = true) {
      while (!server.isClosed) {
        val client = try {
          server.accept()
        } catch (_: Exception) {
          break
        }
        thread(name = "lsb-web-proxy-conn", isDaemon = true) {
          handle(client, dns)
        }
      }
    }
    attachWebView(port)
  }

  private fun attachWebView(port: Int) {
    if (!WebViewFeature.isFeatureSupported(WebViewFeature.PROXY_OVERRIDE)) return
    val config = ProxyConfig.Builder()
      .addProxyRule("127.0.0.1:$port")
      .addDirect("127.0.0.1")
      .addDirect("localhost")
      .build()
    try {
      ProxyController.getInstance().setProxyOverride(
        config,
        Executors.newSingleThreadExecutor(),
      ) {}
    } catch (_: Exception) {
      /* 旧 WebView 没有代理覆盖时，内置浏览器仍走系统 DNS */
    }
  }

  private fun handle(client: Socket, dns: Dns) {
    try {
      client.soTimeout = 30_000
      client.tcpNoDelay = true
      val input = client.getInputStream()
      val output = client.getOutputStream()
      val head = readHead(input) ?: return
      val first = head.lineSequence().firstOrNull()?.trim().orEmpty()
      if (first.startsWith("CONNECT ", ignoreCase = true)) {
        val target = first.split(" ").getOrNull(1).orEmpty()
        val host = target.substringBefore(":").trim().trim('[', ']')
        val port = target.substringAfter(":", "443").toIntOrNull() ?: 443
        val remote = connectRemote(dns, host, port)
        if (remote == null) {
          output.write("HTTP/1.1 502 Bad Gateway\r\nConnection: close\r\n\r\n".toByteArray())
          return
        }
        output.write("HTTP/1.1 200 Connection Established\r\n\r\n".toByteArray())
        output.flush()
        pipe(client, remote, tlsUplink = port == 443)
        return
      }
      val hostLine = Regex("(?im)^Host:\\s*([^\\r\\n]+)").find(head)?.groupValues?.get(1)?.trim().orEmpty()
      if (hostLine.isBlank()) {
        output.write("HTTP/1.1 400 Bad Request\r\nConnection: close\r\n\r\n".toByteArray())
        return
      }
      val host = hostLine.substringBefore(":").trim()
      val port = hostLine.substringAfter(":", "").toIntOrNull() ?: 80
      val remote = connectRemote(dns, host, port)
      if (remote == null) {
        output.write("HTTP/1.1 502 Bad Gateway\r\nConnection: close\r\n\r\n".toByteArray())
        return
      }
      remote.getOutputStream().write(head.toByteArray(Charsets.ISO_8859_1))
      pipe(client, remote, tlsUplink = false)
    } catch (_: Exception) {
      /* connection dropped */
    } finally {
      try {
        client.close()
      } catch (_: Exception) {
      }
    }
  }

  private fun connectRemote(dns: Dns, host: String, port: Int): Socket? {
    if (host.isBlank() || host == "127.0.0.1" || host.equals("localhost", true)) return null
    val addresses = try {
      if (IPV4.matches(host)) listOf(InetAddress.getByName(host)) else dns.lookup(host)
    } catch (_: Exception) {
      try {
        Dns.SYSTEM.lookup(host)
      } catch (_: Exception) {
        emptyList()
      }
    }
    for (address in addresses) {
      try {
        val socket = Socket()
        socket.tcpNoDelay = true
        socket.connect(InetSocketAddress(address, port), 8_000)
        socket.soTimeout = 30_000
        return socket
      } catch (_: Exception) {
        continue
      }
    }
    return null
  }

  private fun pipe(left: Socket, right: Socket, tlsUplink: Boolean) {
    val up = thread(name = "lsb-web-proxy-up", isDaemon = true) {
      if (tlsUplink) {
        TlsFrag.copyUplink(left.getInputStream(), right.getOutputStream())
      } else {
        copy(left.getInputStream(), right.getOutputStream())
      }
      try {
        right.shutdownOutput()
      } catch (_: Exception) {
      }
    }
    copy(right.getInputStream(), left.getOutputStream())
    try {
      left.shutdownOutput()
    } catch (_: Exception) {
    }
    try {
      up.join(1_000)
    } catch (_: Exception) {
    }
    try {
      right.close()
    } catch (_: Exception) {
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

  private fun readHead(input: InputStream): String? {
    val data = ByteArrayOutputStream()
    var matched = 0
    val end = byteArrayOf(13, 10, 13, 10)
    while (data.size() < 65_536) {
      val next = input.read()
      if (next < 0) break
      data.write(next)
      if (next.toByte() == end[matched]) {
        matched += 1
        if (matched == end.size) break
      } else {
        matched = if (next.toByte() == end[0]) 1 else 0
      }
    }
    if (data.size() == 0) return null
    return data.toString(Charsets.ISO_8859_1.name())
  }

  private val IPV4 = Regex("""^\d{1,3}(?:\.\d{1,3}){3}$""")
}
