package com.androscrn.companion.camera

/**
 * Holds only the most recent encoded frame (bounded: one frame, never a queue). Stream writers wait for a frame
 * newer than the one they last sent, so slow clients skip frames instead of accumulating them.
 */
class FrameBuffer {
    data class Frame(val sequence: Long, val jpeg: ByteArray)

    private val lock = Object()
    private var latest: Frame? = null
    private var nextSequence = 1L
    private var closed = false

    fun publish(jpeg: ByteArray) {
        synchronized(lock) {
            latest = Frame(nextSequence++, jpeg)
            lock.notifyAll()
        }
    }

    /** Returns the next frame newer than [afterSequence], or null on timeout or after [clear]. */
    fun awaitNewer(afterSequence: Long, timeoutMs: Long): Frame? {
        val deadline = System.currentTimeMillis() + timeoutMs
        synchronized(lock) {
            while (true) {
                val frame = latest
                if (closed) return null
                if (frame != null && frame.sequence > afterSequence) return frame
                val remaining = deadline - System.currentTimeMillis()
                if (remaining <= 0) return null
                lock.wait(remaining)
            }
        }
    }

    /** Drops the held frame and wakes waiters; used when the camera stops. */
    fun clear() {
        synchronized(lock) {
            latest = null
            closed = true
            lock.notifyAll()
        }
    }

    fun reopen() {
        synchronized(lock) { closed = false }
    }

    fun latestSequence(): Long = synchronized(lock) { latest?.sequence ?: 0L }
}
