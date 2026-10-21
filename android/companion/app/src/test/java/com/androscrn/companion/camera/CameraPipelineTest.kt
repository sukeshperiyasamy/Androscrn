package com.androscrn.companion.camera

import org.junit.Assert.assertArrayEquals
import org.junit.Assert.assertEquals
import org.junit.Assert.assertNull
import org.junit.Assert.assertTrue
import org.junit.Test
import java.nio.ByteBuffer
import kotlin.concurrent.thread

class CameraPipelineTest {

    /** Builds a padded plane where pixel (x, y) holds value(x, y); padding bytes are 0xEE. */
    private fun plane(w: Int, h: Int, rowStride: Int, pixelStride: Int, value: (Int, Int) -> Int): YuvConverter.Plane {
        val bytes = ByteArray(rowStride * h) { 0xEE.toByte() }
        for (y in 0 until h) for (x in 0 until w) bytes[y * rowStride + x * pixelStride] = value(x, y).toByte()
        return YuvConverter.Plane(ByteBuffer.wrap(bytes), rowStride, pixelStride)
    }

    @Test
    fun nv21ConversionHonoursRowAndPixelStrides() {
        val w = 4
        val h = 2
        val y = plane(w, h, rowStride = 8, pixelStride = 1) { x, r -> r * 10 + x }
        // Interleaved chroma (pixelStride 2) with row padding, as most devices deliver it.
        val u = plane(w / 2, h / 2, rowStride = 8, pixelStride = 2) { x, _ -> 100 + x }
        val v = plane(w / 2, h / 2, rowStride = 8, pixelStride = 2) { x, _ -> 200 + x }

        val nv21 = YuvConverter.toNv21(w, h, y, u, v)

        val expected = byteArrayOf(0, 1, 2, 3, 10, 11, 12, 13, 200.toByte(), 100, 201.toByte(), 101)
        assertArrayEquals(expected, nv21)
    }

    @Test
    fun nv21ConversionPlanarChromaAndReusedBuffer() {
        val y = plane(2, 2, 2, 1) { x, r -> r * 2 + x }
        val u = plane(1, 1, 1, 1) { _, _ -> 7 }
        val v = plane(1, 1, 1, 1) { _, _ -> 9 }
        val scratch = ByteArray(6)
        val out = YuvConverter.toNv21(2, 2, y, u, v, scratch)
        assertTrue("reuses the scratch buffer to avoid per-frame allocation", out === scratch)
        assertArrayEquals(byteArrayOf(0, 1, 2, 3, 9, 7), out)
    }

    @Test(expected = IllegalArgumentException::class)
    fun nv21ConversionRejectsOddDimensions() {
        val p = plane(3, 3, 3, 1) { _, _ -> 0 }
        YuvConverter.toNv21(3, 3, p, p, p)
    }

    @Test
    fun frameBufferKeepsOnlyLatestFrame() {
        val fb = FrameBuffer()
        fb.publish(byteArrayOf(1))
        fb.publish(byteArrayOf(2))
        fb.publish(byteArrayOf(3))
        val f = fb.awaitNewer(0, 10)!!
        assertArrayEquals("slow readers skip to the newest frame (bounded buffer)", byteArrayOf(3), f.jpeg)
        assertNull("no newer frame -> timeout", fb.awaitNewer(f.sequence, 20))
    }

    @Test
    fun frameBufferWakesWaitersAndClearEndsStreams() {
        val fb = FrameBuffer()
        var got: FrameBuffer.Frame? = null
        val t = thread { got = fb.awaitNewer(0, 2_000) }
        Thread.sleep(50)
        fb.publish(byteArrayOf(42))
        t.join(1_000)
        assertEquals(42.toByte(), got!!.jpeg[0])

        var afterClear: FrameBuffer.Frame? = FrameBuffer.Frame(-1, ByteArray(0))
        val t2 = thread { afterClear = fb.awaitNewer(got!!.sequence, 2_000) }
        Thread.sleep(50)
        val start = System.currentTimeMillis()
        fb.clear()
        t2.join(1_000)
        assertNull("clear() releases waiting stream writers", afterClear)
        assertTrue(System.currentTimeMillis() - start < 1_000)

        fb.reopen()
        fb.publish(byteArrayOf(5))
        assertEquals(5.toByte(), fb.awaitNewer(0, 10)!!.jpeg[0])
    }
}
