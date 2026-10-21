package com.androscrn.companion.camera

/** Camera operations the control server needs; implemented by [CompanionCamera], faked in JVM tests. */
interface CameraBackend {
    fun permissionGranted(): Boolean
    fun status(): CameraStatus
    fun listCameras(): List<CameraDescriptor>
    fun start(facing: String?, cameraId: String?): OpResult
    fun stop(): OpResult
    fun select(facing: String?, cameraId: String?): OpResult
    fun setZoom(ratio: Float): OpResult
    fun setTorch(enabled: Boolean): OpResult
    fun takePhoto(timeoutMs: Long): PhotoResult
    /** Returns and forgets a captured photo (single download). */
    fun takeStoredPhoto(id: String): ByteArray?
}

data class CameraDescriptor(
    val id: String,
    val facing: String,
    val sensorOrientation: Int?,
    val hasFlash: Boolean,
    val outputSizes: List<String>
)

data class CameraStatus(
    val active: Boolean,
    val cameraId: String?,
    val facing: String?,
    val zoom: Float,
    val minZoom: Float,
    val maxZoom: Float,
    val torchOn: Boolean,
    val hasFlash: Boolean,
    val frameWidth: Int,
    val frameHeight: Int
)

data class OpResult(val success: Boolean, val code: String? = null, val message: String? = null, val zoom: Float? = null, val torchOn: Boolean? = null)

data class PhotoResult(val success: Boolean, val photoId: String? = null, val sizeBytes: Int = 0, val code: String? = null, val message: String? = null)
