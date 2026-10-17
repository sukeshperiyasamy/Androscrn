package com.androscrn.companion.camera

import android.content.Context
import android.graphics.Bitmap
import android.graphics.BitmapFactory
import android.graphics.ImageFormat
import android.graphics.Rect
import android.graphics.YuvImage
import android.media.Image
import android.util.Log
import androidx.camera.core.*
import androidx.camera.lifecycle.ProcessCameraProvider
import androidx.camera.view.PreviewView
import androidx.core.content.ContextCompat
import androidx.lifecycle.LifecycleOwner
import java.io.ByteArrayOutputStream
import java.io.File
import java.util.concurrent.ExecutorService
import java.util.concurrent.Executors

/**
 * Manages CameraX use cases: Preview, ImageCapture (full-res still photo),
 * ImageAnalysis (frame buffer extraction for MJPEG preview stream),
 * digital zoom ratio, torch control, and physical lens switching.
 */
class CameraManager(
    private val context: Context,
    private val lifecycleOwner: LifecycleOwner
) {
    private var cameraProvider: ProcessCameraProvider? = null
    private var camera: Camera? = null
    private var preview: Preview? = null
    private var imageCapture: ImageCapture? = null
    private var imageAnalysis: ImageAnalysis? = null

    private val cameraExecutor: ExecutorService = Executors.newSingleThreadExecutor()

    var currentFacing: Int = CameraSelector.LENS_FACING_BACK
        private set
    var isTorchOn: Boolean = false
        private set
    var currentZoomRatio: Float = 1.0f
        private set
    var minZoomRatio: Float = 1.0f
        private set
    var maxZoomRatio: Float = 10.0f
        private set

    // Holds latest compressed JPEG frame for MJPEG stream
    @Volatile
    var latestFrameJpeg: ByteArray? = null
        private set

    // Holds captured full-res photos by ID
    val photoStore = HashMap<String, ByteArray>()

    fun startCamera(viewFinder: PreviewView, facing: Int = CameraSelector.LENS_FACING_BACK, onReady: () -> Unit) {
        currentFacing = facing
        val cameraProviderFuture = ProcessCameraProvider.getInstance(context)

        cameraProviderFuture.addListener({
            cameraProvider = cameraProviderFuture.get()
            bindCameraUseCases(viewFinder)
            onReady()
        }, ContextCompat.getMainExecutor(context))
    }

    private fun bindCameraUseCases(viewFinder: PreviewView) {
        val provider = cameraProvider ?: return
        provider.unbindAll()

        val cameraSelector = CameraSelector.Builder()
            .requireLensFacing(currentFacing)
            .build()

        // 1. Viewfinder Preview Use Case
        preview = Preview.Builder().build().also {
            it.setSurfaceProvider(viewFinder.surfaceProvider)
        }

        // 2. Full-Resolution Still Image Capture Use Case
        imageCapture = ImageCapture.Builder()
            .setCaptureMode(ImageCapture.CAPTURE_MODE_MAXIMIZE_QUALITY)
            .build()

        // 3. Frame Analysis for In-App Live Stream (MJPEG extraction)
        imageAnalysis = ImageAnalysis.Builder()
            .setBackpressureStrategy(ImageAnalysis.STRATEGY_KEEP_ONLY_LATEST)
            .setOutputImageFormat(ImageAnalysis.OUTPUT_IMAGE_FORMAT_YUV_420_888)
            .build()
            .also {
                it.setAnalyzer(cameraExecutor) { imageProxy ->
                    processFrame(imageProxy)
                }
            }

        try {
            camera = provider.bindToLifecycle(
                lifecycleOwner,
                cameraSelector,
                preview,
                imageCapture,
                imageAnalysis
            )

            // Introspect hardware zoom range
            camera?.cameraInfo?.zoomState?.observe(lifecycleOwner) { zoomState ->
                minZoomRatio = zoomState.minZoomRatio
                maxZoomRatio = zoomState.maxZoomRatio
                currentZoomRatio = zoomState.zoomRatio
            }
        } catch (exc: Exception) {
            Log.error("CameraManager", "Use case binding failed", exc)
        }
    }

    private fun processFrame(imageProxy: ImageProxy) {
        try {
            val yuvImage = imageProxyToYuvImage(imageProxy)
            if (yuvImage != null) {
                val out = ByteArrayOutputStream()
                yuvImage.compressToJpeg(
                    Rect(0, 0, imageProxy.width, imageProxy.height),
                    70, // 70% quality balanced for streaming
                    out
                )
                latestFrameJpeg = out.toByteArray()
            }
        } catch (e: Exception) {
            // Ignore transient frame conversion glitches
        } finally {
            imageProxy.close()
        }
    }

    private fun imageProxyToYuvImage(image: ImageProxy): YuvImage? {
        val planes = image.planes
        val yBuffer = planes[0].buffer
        val uBuffer = planes[1].buffer
        val vBuffer = planes[2].buffer

        val ySize = yBuffer.remaining()
        val uSize = uBuffer.remaining()
        val vSize = vBuffer.remaining()

        val nv21 = ByteArray(ySize + uSize + vSize)
        yBuffer.get(nv21, 0, ySize)
        vBuffer.get(nv21, ySize, vSize)
        uBuffer.get(nv21, ySize + vSize, uSize)

        return YuvImage(nv21, ImageFormat.NV21, image.width, image.height, null)
    }

    fun flipCamera(viewFinder: PreviewView) {
        currentFacing = if (currentFacing == CameraSelector.LENS_FACING_BACK) {
            CameraSelector.LENS_FACING_FRONT
        } else {
            CameraSelector.LENS_FACING_BACK
        }
        isTorchOn = false
        bindCameraUseCases(viewFinder)
    }

    fun setZoom(ratio: Float): Boolean {
        val cam = camera ?: return false
        val clamped = ratio.coerceIn(minZoomRatio, maxZoomRatio)
        cam.cameraControl.setZoomRatio(clamped)
        currentZoomRatio = clamped
        return true
    }

    fun toggleTorch(): Boolean {
        val cam = camera ?: return false
        if (!cam.cameraInfo.hasFlashUnit()) return false
        isTorchOn = !isTorchOn
        cam.cameraControl.enableTorch(isTorchOn)
        return isTorchOn
    }

    fun takePhoto(onSuccess: (photoId: String, sizeBytes: Int) -> Unit, onError: (String) -> Unit) {
        val capture = imageCapture ?: run {
            onError("Camera capture use case is not bound")
            return
        }

        val tempFile = File(context.cacheDir, "photo_${System.currentTimeMillis()}.jpg")
        val outputOptions = ImageCapture.OutputFileOptions.Builder(tempFile).build()

        capture.takePicture(
            outputOptions,
            cameraExecutor,
            object : ImageCapture.OnImageSavedCallback {
                override fun onImageSaved(outputFileResults: ImageCapture.OutputFileResults) {
                    try {
                        val bytes = tempFile.readBytes()
                        tempFile.delete()
                        val photoId = "photo_${System.currentTimeMillis()}"
                        photoStore[photoId] = bytes
                        onSuccess(photoId, bytes.size)
                    } catch (e: Exception) {
                        onError("Failed to read captured image: ${e.message}")
                    }
                }

                override fun onError(exception: ImageCaptureException) {
                    onError("Image capture failed: ${exception.message}")
                }
            }
        )
    }

    fun shutdown() {
        cameraProvider?.unbindAll()
        cameraExecutor.shutdown()
    }
}
