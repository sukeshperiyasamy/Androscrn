package com.androscrn.companion.camera

import java.nio.ByteBuffer

/**
 * Converts a YUV_420_888 image (three planes with arbitrary row and pixel strides) into tightly packed NV21.
 *
 * The previous implementation concatenated the raw plane buffers, which is only correct when rowStride == width
 * and the chroma planes are fully planar. Most devices pad rows and interleave U/V (pixelStride 2), which produced
 * sheared or green-tinted frames. Pure Kotlin so it can be tested on the JVM.
 */
object YuvConverter {
    data class Plane(val buffer: ByteBuffer, val rowStride: Int, val pixelStride: Int)

    fun toNv21(width: Int, height: Int, y: Plane, u: Plane, v: Plane, out: ByteArray? = null): ByteArray {
        require(width > 0 && height > 0 && width % 2 == 0 && height % 2 == 0) { "width and height must be positive and even" }
        val ySize = width * height
        val size = ySize + ySize / 2
        val nv21 = if (out != null && out.size == size) out else ByteArray(size)

        // Luma: copy row by row, skipping padding.
        val yBuf = y.buffer.duplicate()
        var pos = 0
        for (row in 0 until height) {
            val rowStart = row * y.rowStride
            if (y.pixelStride == 1) {
                yBuf.position(rowStart)
                yBuf.get(nv21, pos, width)
                pos += width
            } else {
                for (col in 0 until width) nv21[pos++] = yBuf.get(rowStart + col * y.pixelStride)
            }
        }

        // Chroma: NV21 is interleaved V,U at quarter resolution.
        val uBuf = u.buffer.duplicate()
        val vBuf = v.buffer.duplicate()
        val chromaHeight = height / 2
        val chromaWidth = width / 2
        for (row in 0 until chromaHeight) {
            val uRow = row * u.rowStride
            val vRow = row * v.rowStride
            for (col in 0 until chromaWidth) {
                nv21[pos++] = vBuf.get(vRow + col * v.pixelStride)
                nv21[pos++] = uBuf.get(uRow + col * u.pixelStride)
            }
        }
        return nv21
    }
}
