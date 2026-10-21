package com.androscrn.companion.camera

import android.Manifest
import android.annotation.SuppressLint
import android.content.Context
import android.content.pm.PackageManager
import android.graphics.ImageFormat
import android.graphics.Rect
import android.graphics.YuvImage
import android.hardware.camera2.CameraCharacteristics
import android.os.Handler
import android.os.Looper
import android.util.Log
import android.util.Size
import android.view.Surface
import androidx.annotation.OptIn
import androidx.camera.camera2.interop.Camera2CameraInfo
import androidx.camera.camera2.interop.ExperimentalCamera2Interop
import androidx.camera.core.Camera
import androidx.camera.core.CameraInfo
import androidx.camera.core.CameraSelector
import androidx.camera.core.CameraState
import androidx.camera.core.ImageAnalysis
import androidx.camera.core.ImageCapture
import androidx.camera.core.ImageCaptureException
import androidx.camera.core.ImageProxy
import androidx.camera.core.Preview
import androidx.camera.core.resolutionselector.ResolutionSelector
import androidx.camera.core.resolutionselector.ResolutionStrategy
import androidx.camera.lifecycle.ProcessCameraProvider
import androidx.camera.view.PreviewView
import androidx.core.content.ContextCompat
import androidx.lifecycle.LifecycleOwner
import com.androscrn.companion.session.SessionState
import com.androscrn.companion.session.SessionTracker
import java.io.ByteArrayOutputStream
import java.util.concurrent.CountDownLatch
import java.util.concurrent.Executors
import java.util.concurrent.TimeUnit
import java.util.concurrent.atomic.AtomicInteger
import java.util.concurrent.atomic.AtomicReference

/**
 * CameraX implementation of [CameraBackend].
 *
 * The camera is bound only between an explicit start and stop requested by the desktop (or the idle watchdog),
 * never just because the app is open. All CameraX calls run on the main thread; server threads block on a
 * bounded latch. Callbacks carry the session generation they were started with so a stale bind or error
 * cannot overwrite the state of a newer session.
 */
class CompanionCamera(
    private val context: Context,
    private val lifecycleOwner: LifecycleOwner,
    private val tracker: SessionTracker,
    private val frames: FrameBuffer,
    private val previewViewProvider: () -> PreviewView?
) : CameraBackend {

    companion object {
        private const val TAG = "CompanionCamera"
        private const val MAIN_TIMEOUT_MS = 8_000L
        private const val JPEG_QUALITY = 70
        private const val MIN_FRAME_INTERVAL_MS = 50L // cap encoding at ~20 fps
        private const val MAX_STORED_PHOTOS = 3
        val TARGET_ANALYSIS_SIZE = Size(1280, 720)
    }

    private val main = Handler(Looper.getMainLooper())
    private val analysisExecutor = Executors.newSingleThreadExecutor()
    private val captureExecutor = Executors.newSingleThreadExecutor()

    /** Number of open MJPEG streams; frames are encoded only while > 0. */
    val streamClients = AtomicInteger(0)

    @Volatile private var provider: ProcessCameraProvider? = null
    @Volatile private var camera: Camera? = null
    @Volatile private var imageCapture: ImageCapture? = null
    @Volatile private var selectedId: String? = null
    @Volatile private var selectedFacing: String = "back"
    @Volatile private var zoom = 1f
    @Volatile private var minZoom = 1f
    @Volatile private var maxZoom = 1f
    @Volatile private var torchOn = false
    @Volatile private var frameWidth = 0
    @Volatile private var frameHeight = 0
    @Volatile private var lastEncodeAt = 0L
    private var nv21Scratch: ByteArray? = null

    private val photos = object : LinkedHashMap<String, ByteArray>() {
        override fun removeEldestEntry(eldest: MutableMap.MutableEntry<String, ByteArray>?) = size > MAX_STORED_PHOTOS
    }

    override fun permissionGranted(): Boolean =
        ContextCompat.checkSelfPermission(context, Manifest.permission.CAMERA) == PackageManager.PERMISSION_GRANTED

    override fun status(): CameraStatus = CameraStatus(
        active = tracker.isCameraActive(),
        cameraId = selectedId,
        facing = selectedFacing,
        zoom = zoom,
        minZoom = minZoom,
        maxZoom = maxZoom,
        torchOn = torchOn,
        hasFlash = camera?.cameraInfo?.hasFlashUnit() ?: false,
        frameWidth = frameWidth,
        frameHeight = frameHeight
    )

    @OptIn(ExperimentalCamera2Interop::class)
    override fun listCameras(): List<CameraDescriptor> {
        val p = obtainProvider() ?: return emptyList()
        return onMain {
            p.availableCameraInfos.mapNotNull { info -> describe(info) }
        } ?: emptyList()
    }

    @OptIn(ExperimentalCamera2Interop::class)
    private fun describe(info: CameraInfo): CameraDescriptor? = try {
        val c2 = Camera2CameraInfo.from(info)
        val facing = when (c2.getCameraCharacteristic(CameraCharacteristics.LENS_FACING)) {
            CameraCharacteristics.LENS_FACING_FRONT -> "front"
            CameraCharacteristics.LENS_FACING_BACK -> "back"
            CameraCharacteristics.LENS_FACING_EXTERNAL -> "external"
            else -> "unknown"
        }
        val map = c2.getCameraCharacteristic(CameraCharacteristics.SCALER_STREAM_CONFIGURATION_MAP)
        val sizes = map?.getOutputSizes(ImageFormat.YUV_420_888)
            ?.sortedByDescending { it.width.toLong() * it.height }
            ?.take(8)
            ?.map { "${it.width}x${it.height}" }
            ?: emptyList()
        CameraDescriptor(
            id = c2.cameraId,
            facing = facing,
            sensorOrientation = c2.getCameraCharacteristic(CameraCharacteristics.SENSOR_ORIENTATION),
            hasFlash = info.hasFlashUnit(),
            outputSizes = sizes
        )
    } catch (e: Exception) {
        Log.w(TAG, "Could not describe camera", e)
        null
    }

    override fun start(facing: String?, cameraId: String?): OpResult {
        if (!permissionGranted()) {
            tracker.set(SessionState.PERMISSION_REQUIRED, "Camera permission has not been granted on the phone.")
            return OpResult(false, "permission_required", "Camera permission is required. Allow it on the phone, then try again.")
        }
        val p = obtainProvider()
            ?: return fail(tracker.beginCameraStart(), "camera_unavailable", "Camera service is not available on this device.")

        val gen = tracker.beginCameraStart()
        frames.reopen()
        val result = onMain { bind(p, gen, facing ?: selectedFacing, cameraId) }
            ?: return fail(gen, "timeout", "Timed out while opening the camera.")
        return result
    }

    @OptIn(ExperimentalCamera2Interop::class)
    @SuppressLint("UnsafeOptInUsageError")
    private fun bind(p: ProcessCameraProvider, gen: Long, facing: String, cameraId: String?): OpResult {
        val infos = p.availableCameraInfos
        val target = when {
            cameraId != null -> infos.firstOrNull { Camera2CameraInfo.from(it).cameraId == cameraId }
                ?: return fail(gen, "camera_not_found", "Camera $cameraId is not available to apps on this device.")
            else -> infos.firstOrNull { describe(it)?.facing == facing }
                ?: return fail(gen, "camera_not_found", "No $facing-facing camera is available.")
        }
        val targetId = Camera2CameraInfo.from(target).cameraId
        val selector = CameraSelector.Builder()
            .addCameraFilter { list -> list.filter { Camera2CameraInfo.from(it).cameraId == targetId } }
            .build()

        val resolution = ResolutionSelector.Builder()
            .setResolutionStrategy(ResolutionStrategy(TARGET_ANALYSIS_SIZE, ResolutionStrategy.FALLBACK_RULE_CLOSEST_LOWER_THEN_HIGHER))
            .build()

        val analysis = ImageAnalysis.Builder()
            .setResolutionSelector(resolution)
            .setBackpressureStrategy(ImageAnalysis.STRATEGY_KEEP_ONLY_LATEST)
            .setOutputImageFormat(ImageAnalysis.OUTPUT_IMAGE_FORMAT_YUV_420_888)
            .setOutputImageRotationEnabled(true)
            .setTargetRotation(Surface.ROTATION_0)
            .build()
        analysis.setAnalyzer(analysisExecutor) { image -> onFrame(gen, image) }

        val capture = ImageCapture.Builder()
            .setCaptureMode(ImageCapture.CAPTURE_MODE_MINIMIZE_LATENCY)
            .setTargetRotation(Surface.ROTATION_0)
            .build()

        val preview = previewViewProvider()?.let { view ->
            Preview.Builder().build().also { it.setSurfaceProvider(view.surfaceProvider) }
        }

        return try {
            detachObservers()
            p.unbindAll()
            val useCases = listOfNotNull(preview, capture, analysis).toTypedArray()
            val cam = p.bindToLifecycle(lifecycleOwner, selector, *useCases)
            camera = cam
            imageCapture = capture
            selectedId = targetId
            selectedFacing = describe(target)?.facing ?: facing
            torchOn = false

            cam.cameraInfo.zoomState.observe(lifecycleOwner) { z ->
                if (tracker.generation == gen) {
                    zoom = z.zoomRatio
                    minZoom = z.minZoomRatio
                    maxZoom = z.maxZoomRatio
                }
            }
            cam.cameraInfo.cameraState.observe(lifecycleOwner) { state -> onCameraState(gen, state) }
            // STREAMING is reported only once the first frame arrives (see onFrame).
            OpResult(true, message = "Camera $targetId starting")
        } catch (e: Exception) {
            Log.e(TAG, "Use case binding failed", e)
            fail(gen, "camera_bind_failed", "Could not open camera $targetId: ${e.message ?: e.javaClass.simpleName}")
        }
    }

    private fun onCameraState(gen: Long, state: CameraState) {
        val err = state.error ?: return
        val message = when (err.code) {
            CameraState.ERROR_CAMERA_IN_USE, CameraState.ERROR_MAX_CAMERAS_IN_USE ->
                "The camera is in use by another app (for example a scrcpy camera session). Close it and try again."
            CameraState.ERROR_CAMERA_DISABLED ->
                "The camera is disabled on the phone (privacy toggle or device policy)."
            CameraState.ERROR_DO_NOT_DISTURB_MODE_ENABLED ->
                "Do Not Disturb is blocking camera access on this device."
            CameraState.ERROR_CAMERA_FATAL_ERROR, CameraState.ERROR_STREAM_CONFIG ->
                "The camera reported a fatal error. Stop and start the camera again."
            else -> "Camera error ${err.code}."
        }
        if (err.type == CameraState.ErrorType.CRITICAL) {
            tracker.complete(gen, SessionState.CAMERA_UNAVAILABLE, message)
        } else {
            Log.w(TAG, "Recoverable camera error: $message")
        }
    }

    private fun onFrame(gen: Long, image: ImageProxy) {
        try {
            if (tracker.generation != gen) return
            frameWidth = image.width
            frameHeight = image.height
            if (tracker.state == SessionState.STARTING_CAMERA) {
                tracker.complete(gen, SessionState.STREAMING)
            }
            if (streamClients.get() <= 0) return
            val now = System.currentTimeMillis()
            if (now - lastEncodeAt < MIN_FRAME_INTERVAL_MS) return
            lastEncodeAt = now

            val w = image.width and 1.inv()
            val h = image.height and 1.inv()
            val p = image.planes
            val nv21 = YuvConverter.toNv21(
                w, h,
                YuvConverter.Plane(p[0].buffer, p[0].rowStride, p[0].pixelStride),
                YuvConverter.Plane(p[1].buffer, p[1].rowStride, p[1].pixelStride),
                YuvConverter.Plane(p[2].buffer, p[2].rowStride, p[2].pixelStride),
                nv21Scratch
            )
            nv21Scratch = nv21
            val out = ByteArrayOutputStream(w * h / 4)
            YuvImage(nv21, ImageFormat.NV21, w, h, null).compressToJpeg(Rect(0, 0, w, h), JPEG_QUALITY, out)
            frames.publish(out.toByteArray())
        } catch (e: Exception) {
            Log.w(TAG, "Frame conversion failed", e)
        } finally {
            image.close()
        }
    }

    override fun stop(): OpResult {
        val gen = tracker.beginStop()
        frames.clear()
        onMain {
            detachObservers()
            provider?.unbindAll()
            camera = null
            imageCapture = null
            torchOn = false
        }
        tracker.complete(gen, SessionState.CONNECTED)
        return OpResult(true, message = "Camera stopped")
    }

    override fun select(facing: String?, cameraId: String?): OpResult {
        if (!tracker.isCameraActive()) {
            if (facing != null) selectedFacing = facing
            if (cameraId != null) selectedId = cameraId
            return OpResult(true, message = "Selection saved; it applies when the camera starts.")
        }
        return start(facing, cameraId)
    }

    override fun setZoom(ratio: Float): OpResult {
        val cam = camera ?: return OpResult(false, "camera_not_running", "Start the camera first.")
        val clamped = ratio.coerceIn(minZoom, maxZoom)
        onMain { cam.cameraControl.setZoomRatio(clamped) }
        zoom = clamped
        return OpResult(true, zoom = clamped)
    }

    override fun setTorch(enabled: Boolean): OpResult {
        val cam = camera ?: return OpResult(false, "camera_not_running", "Start the camera first.")
        if (!cam.cameraInfo.hasFlashUnit()) return OpResult(false, "torch_unsupported", "This camera has no flash unit.", torchOn = false)
        onMain { cam.cameraControl.enableTorch(enabled) }
        torchOn = enabled
        return OpResult(true, torchOn = enabled)
    }

    override fun takePhoto(timeoutMs: Long): PhotoResult {
        val capture = imageCapture ?: return PhotoResult(false, code = "camera_not_running", message = "Start the camera first.")
        val latch = CountDownLatch(1)
        val result = AtomicReference<PhotoResult>()
        capture.takePicture(captureExecutor, object : ImageCapture.OnImageCapturedCallback() {
            override fun onCaptureSuccess(image: ImageProxy) {
                try {
                    val buffer = image.planes[0].buffer
                    val bytes = ByteArray(buffer.remaining()).also { buffer.get(it) }
                    val id = "photo_${System.currentTimeMillis()}"
                    synchronized(photos) { photos[id] = bytes }
                    result.set(PhotoResult(true, id, bytes.size))
                } catch (e: Exception) {
                    result.set(PhotoResult(false, code = "capture_failed", message = e.message))
                } finally {
                    image.close()
                    latch.countDown()
                }
            }

            override fun onError(exception: ImageCaptureException) {
                result.set(PhotoResult(false, code = "capture_failed", message = "Image capture failed: ${exception.message}"))
                latch.countDown()
            }
        })
        if (!latch.await(timeoutMs, TimeUnit.MILLISECONDS)) {
            return PhotoResult(false, code = "timeout", message = "Photo capture timed out.")
        }
        return result.get()
    }

    override fun takeStoredPhoto(id: String): ByteArray? = synchronized(photos) { photos.remove(id) }

    fun shutdown() {
        tracker.beginStop()
        frames.clear()
        try {
            provider?.unbindAll()
        } catch (e: Exception) {
            Log.w(TAG, "unbindAll failed during shutdown", e)
        }
        analysisExecutor.shutdown()
        captureExecutor.shutdown()
    }

    /** Main thread only: drops LiveData observers of the previously bound camera. */
    private fun detachObservers() {
        camera?.cameraInfo?.let { info ->
            info.zoomState.removeObservers(lifecycleOwner)
            info.cameraState.removeObservers(lifecycleOwner)
        }
    }

    private fun obtainProvider(): ProcessCameraProvider? {
        provider?.let { return it }
        return try {
            ProcessCameraProvider.getInstance(context).get(MAIN_TIMEOUT_MS, TimeUnit.MILLISECONDS).also { provider = it }
        } catch (e: Exception) {
            Log.e(TAG, "Camera provider unavailable", e)
            null
        }
    }

    private fun fail(gen: Long, code: String, message: String): OpResult {
        val next = if (code == "permission_required") SessionState.PERMISSION_REQUIRED else SessionState.CAMERA_UNAVAILABLE
        tracker.complete(gen, next, message)
        return OpResult(false, code, message)
    }

    /** Runs [block] on the main thread and waits (bounded). Returns null on timeout. */
    private fun <T> onMain(block: () -> T): T? {
        if (Looper.myLooper() == Looper.getMainLooper()) return block()
        val latch = CountDownLatch(1)
        val ref = AtomicReference<T>()
        val err = AtomicReference<Throwable>()
        main.post {
            try {
                ref.set(block())
            } catch (t: Throwable) {
                err.set(t)
            } finally {
                latch.countDown()
            }
        }
        if (!latch.await(MAIN_TIMEOUT_MS, TimeUnit.MILLISECONDS)) return null
        err.get()?.let { throw it }
        return ref.get()
    }
}
