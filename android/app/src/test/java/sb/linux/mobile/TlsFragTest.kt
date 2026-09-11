package sb.linux.mobile

import org.junit.Assert.assertEquals
import org.junit.Assert.assertFalse
import org.junit.Assert.assertNotNull
import org.junit.Assert.assertNull
import org.junit.Assert.assertTrue
import org.junit.Test
import java.io.ByteArrayOutputStream
import java.io.OutputStream

class TlsFragTest {

  @Test
  fun sniRangePointsAtTheHostnameItself() {
    val hello = clientHello("linux.sb")
    val range = TlsFrag.sniRange(hello, 0, hello.size)
    assertNotNull(range)
    assertEquals("linux.sb", text(hello, range!!))
  }

  @Test
  fun sniRangeIgnoresUnrelatedHosts() {
    val hello = clientHello("github.com")
    val range = TlsFrag.sniRange(hello, 0, hello.size)
    assertNotNull(range)
    assertEquals("github.com", text(hello, range!!))
    assertNull(TlsFrag.cutAt(hello, 0, hello.size))
  }

  @Test
  fun cutAtLandsInsideTheNameSoNeitherHalfHoldsIt() {
    val hello = clientHello("linux.sb")
    val name = TlsFrag.sniRange(hello, 0, hello.size)!!
    val at = TlsFrag.cutAt(hello, 0, hello.size)
    assertNotNull(at)
    assertTrue(at!! > name.first)
    assertTrue(at <= name.last)
    assertFalse(String(hello, 0, at, Charsets.US_ASCII).contains("linux.sb"))
    assertFalse(String(hello, at, hello.size - at, Charsets.US_ASCII).contains("linux.sb"))
  }

  @Test
  fun sniRangeIsNullForEverythingThatIsNotAClientHelloWithAName() {
    val hello = clientHello("linux.sb")
    val data = hello.copyOf().also { it[0] = 0x17 }
    assertNull(TlsFrag.sniRange(data, 0, data.size))
    val server = hello.copyOf().also { it[5] = 0x02 }
    assertNull(TlsFrag.sniRange(server, 0, server.size))
    assertNull(TlsFrag.sniRange(hello, 0, hello.size - 12))
    assertNull(TlsFrag.sniRange(clientHello(null), 0, clientHello(null).size))
    assertNull(TlsFrag.cutAt(clientHello("a"), 0, clientHello("a").size))
  }

  @Test
  fun writeSendsTheHandshakeAsTwoRecords() {
    val hello = clientHello("linux.sb")
    val out = Segments()
    assertTrue(TlsFrag.write(out, hello, 0, hello.size, TlsFrag.Style.RECORD))
    assertEquals(2, out.writes.size)
    out.writes.forEach {
      assertEquals(0x16, it[0].toInt() and 0xFF)
      assertTrue(it.size > 5)
      assertEquals(it.size - 5, u16(it, 3))
      assertFalse(String(it, Charsets.US_ASCII).contains("linux.sb"))
    }
    val body = ByteArrayOutputStream()
    out.writes.forEach { body.write(it, 5, it.size - 5) }
    assertTrue(hello.copyOfRange(5, hello.size).contentEquals(body.toByteArray()))
  }

  @Test
  fun writePassesUnrelatedHelloThrough() {
    val hello = clientHello("github.com")
    val out = Segments()
    assertFalse(TlsFrag.write(out, hello, 0, hello.size, TlsFrag.Style.RECORD))
    assertEquals(1, out.writes.size)
    assertTrue(hello.contentEquals(out.joined()))
  }

  @Test
  fun fragStreamSplitsTheFirstWriteOnly() {
    val out = Segments()
    val stream = FragStream(out, TlsFrag.Style.RECORD)
    val hello = clientHello("linux.sb")
    stream.write(hello)
    assertTrue(stream.split)
    assertEquals(2, out.writes.size)
    stream.write(hello)
    assertEquals(3, out.writes.size)
  }

  @Test
  fun configureTurnsRecordSplitOn() {
    val before = TlsFrag.enabled
    try {
      TlsFrag.configure(true)
      assertTrue(TlsFrag.enabled)
      assertEquals(TlsFrag.Style.RECORD, TlsFrag.style)
      TlsFrag.configure(false)
      assertFalse(TlsFrag.enabled)
      assertEquals(TlsFrag.Style.NONE, TlsFrag.style)
    } finally {
      TlsFrag.configure(before)
    }
  }

  private class Segments : OutputStream() {
    val writes = ArrayList<ByteArray>()
    override fun write(b: Int) {
      writes += byteArrayOf(b.toByte())
    }
    override fun write(b: ByteArray, off: Int, len: Int) {
      writes += b.copyOfRange(off, off + len)
    }
    fun joined(): ByteArray {
      val all = ByteArrayOutputStream()
      writes.forEach { all.write(it) }
      return all.toByteArray()
    }
  }

  private fun u16(b: ByteArray, at: Int): Int =
    ((b[at].toInt() and 0xFF) shl 8) or (b[at + 1].toInt() and 0xFF)

  private fun text(b: ByteArray, range: IntRange): String =
    String(b, range.first, range.last - range.first + 1, Charsets.US_ASCII)

  private fun clientHello(host: String?): ByteArray {
    val extensions = ByteArrayOutputStream()
    if (host != null) {
      val name = host.toByteArray(Charsets.US_ASCII)
      val entries = ByteArrayOutputStream()
      entries.write(0x00)
      entries.u16(name.size)
      entries.write(name)
      val list = entries.toByteArray()
      extensions.u16(0x0000)
      extensions.u16(list.size + 2)
      extensions.u16(list.size)
      extensions.write(list)
    }
    val body = ByteArrayOutputStream()
    body.write(byteArrayOf(0x03, 0x03))
    body.write(ByteArray(32) { 0x41 })
    body.write(32)
    body.write(ByteArray(32) { 0x42 })
    body.u16(2)
    body.write(byteArrayOf(0x13, 0x01))
    body.write(1)
    body.write(0x00)
    body.u16(extensions.size())
    body.write(extensions.toByteArray())
    val hello = body.toByteArray()
    val out = ByteArrayOutputStream()
    out.write(0x16)
    out.write(byteArrayOf(0x03, 0x01))
    out.u16(hello.size + 4)
    out.write(0x01)
    out.write((hello.size shr 16) and 0xFF)
    out.u16(hello.size and 0xFFFF)
    out.write(hello)
    return out.toByteArray()
  }

  private fun ByteArrayOutputStream.u16(value: Int) {
    write((value shr 8) and 0xFF)
    write(value and 0xFF)
  }
}
