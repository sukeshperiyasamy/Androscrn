package com.androscrn.companion.session

/** Companion state as reported to the desktop and shown on the phone. */
enum class SessionState(val wire: String) {
    WAITING_FOR_DESKTOP("waiting_for_desktop"),
    PAIRING("pairing"),
    CONNECTED("connected"),
    PERMISSION_REQUIRED("permission_required"),
    CAMERA_UNAVAILABLE("camera_unavailable"),
    STARTING_CAMERA("starting_camera"),
    STREAMING("streaming"),
    STOPPING("stopping"),
    ERROR("error");
}

/**
 * Tracks the session state plus a camera generation counter. Every camera start increments the generation;
 * asynchronous camera callbacks carry the generation they were started with and are ignored once stale,
 * so a slow bind from an earlier start can never overwrite the state of a newer one.
 */
class SessionTracker(private val onChange: (SessionState, String?) -> Unit = { _, _ -> }) {
    @Volatile var state: SessionState = SessionState.WAITING_FOR_DESKTOP
        private set
    @Volatile var lastError: String? = null
        private set
    @Volatile var generation: Long = 0
        private set

    @Synchronized
    fun beginCameraStart(): Long {
        generation++
        set(SessionState.STARTING_CAMERA, null)
        return generation
    }

    /** Applies a result of an async camera operation; returns false (ignored) if [gen] is stale. */
    @Synchronized
    fun complete(gen: Long, next: SessionState, error: String? = null): Boolean {
        if (gen != generation) return false
        set(next, error)
        return true
    }

    /** Stops the camera: invalidates in-flight starts. */
    @Synchronized
    fun beginStop(): Long {
        generation++
        set(SessionState.STOPPING, null)
        return generation
    }

    @Synchronized
    fun set(next: SessionState, error: String? = null) {
        state = next
        lastError = error
        onChange(next, error)
    }

    fun isCameraActive(): Boolean = state == SessionState.STARTING_CAMERA || state == SessionState.STREAMING
}
