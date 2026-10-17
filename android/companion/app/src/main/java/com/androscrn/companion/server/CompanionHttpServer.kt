package com.androscrn.companion.server

import android.os.BatteryManager
import android.os.Build
import com.androscrn.companion.camera.CameraManager
import com.androscrn.companion.security.PairingManager
import com.google.gson.Gson
import com.google.gson.JsonObject
import fi.iki.elonen.NanoHTTPD
import java.io.ByteArrayInputStream
import java.io.InputStream
import java.io.PipedInputStream
import java.io.PipedOutputStream
import kotlin.concurrent.thread

/**
 * Embedded HTTP server listening on loopback (127.0.0.1:8080) for
 * ADB port-forwarded control commands and low-latency MJPEG preview streams.
 */
class CompanionHttpServer(
    port: Int = 8080,
    private val cameraManager: CameraManager,
    private val pairingManager: PairingManager,
    private val onPairingRequested: (pin: String) -> Unit,
    private val onStreamingChanged: (streaming: Boolean) -> Unit
) : NanoHTTPD("127.0.0.1", port) {

    private val gson = Gson()
    var isStreamingActive = false
        private set

    override fun serve(session: IHTTPSession): Response {
        val uri = session.uri
        val method = session.method

        return when {
            uri == "/api/v1/status" && method == Method.GET -> handleStatus()
            uri == "/api/v1/pair" && method == Method.POST -> handlePair(session)
            uri == "/api/v1/capabilities" && method == Method.GET -> handleCapabilities(session)
            uri == "/api/v1/control" && method == Method.POST -> handleControl(session)
            uri == "/api/v1/stream" && method == Method.GET -> handleStream(session)
            uri.startsWith("/api/v1/photo/") && method == Method.GET -> handlePhotoDownload(session)
            else -> newFixedLengthResponse(Response.Status.NOT_FOUND, "application/json", "{\"error\":\"Not Found\"}")
        }
    }

    private fun handleStatus(): Response {
        val root = JsonObject().apply {
            addProperty("status", "ready")
            addProperty("companionVersion", "1.0.0-alpha.1")
            addProperty("deviceModel", Build.MODEL)
            addProperty("deviceProduct", Build.PRODUCT)
            addProperty("androidVersion", Build.VERSION.RELEASE)
            addProperty("sdkVersion", Build.VERSION.SDK_INT)
            addProperty("isPaired", pairingManager.isPaired())
            addProperty("isStreaming", isStreamingActive)
            addProperty("cameraFacing", if (cameraManager.currentFacing == 0) "front" else "back")
            addProperty("currentZoom", cameraManager.currentZoomRatio)
            addProperty("minZoom", cameraManager.minZoomRatio)
            addProperty("maxZoom", cameraManager.maxZoomRatio)
            addProperty("torchOn", cameraManager.isTorchOn)
        }
        return newFixedLengthResponse(Response.Status.OK, "application/json", root.toString())
    }

    private fun handlePair(session: IHTTPSession): Response {
        val body = parseBodyJson(session)
        val candidatePin = body?.get("pin")?.asString

        if (candidatePin.isNullOrBlank()) {
            // Step 1: Request pairing challenge (triggers PIN display on phone)
            val newPin = pairingManager.generatePairingChallenge()
            onPairingRequested(newPin)
            val res = JsonObject().apply {
                addProperty("success", true)
                addProperty("message", "Pairing challenge generated. Check phone screen for verification PIN.")
                addProperty("expiresInSeconds", 60)
            }
            return newFixedLengthResponse(Response.Status.OK, "application/json", res.toString())
        }

        // Step 2: Validate PIN candidate
        val (valid, result) = pairingManager.validateChallenge(candidatePin)
        val res = JsonObject()
        if (valid && result != null) {
            res.addProperty("success", true)
            res.addProperty("token", result)
            res.addProperty("message", "Pairing approved. Use bearer token for subsequent control and streaming.")
            return newFixedLengthResponse(Response.Status.OK, "application/json", res.toString())
        } else {
            res.addProperty("success", false)
            res.addProperty("error", result ?: "Invalid PIN")
            return newFixedLengthResponse(Response.Status.UNAUTHORIZED, "application/json", res.toString())
        }
    }

    private fun handleCapabilities(session: IHTTPSession): Response {
        if (!validateAuth(session)) {
            return unauthorizedResponse()
        }

        val root = JsonObject().apply {
            addProperty("transport", "companion_adb_loopback")
            addProperty("deviceModel", Build.MODEL)
            addProperty("torchSupported", true)
            addProperty("zoomSupported", true)
            addProperty("minZoom", cameraManager.minZoomRatio)
            addProperty("maxZoom", cameraManager.maxZoomRatio)
            addProperty("snapshotsSupported", true)
            addProperty("inAppPreviewSupported", true)
        }
        return newFixedLengthResponse(Response.Status.OK, "application/json", root.toString())
    }

    private fun handleControl(session: IHTTPSession): Response {
        if (!validateAuth(session)) {
            return unauthorizedResponse()
        }

        val body = parseBodyJson(session) ?: run {
            return newFixedLengthResponse(Response.Status.BAD_REQUEST, "application/json", "{\"error\":\"Invalid JSON\"}")
        }

        val action = body.get("action")?.asString ?: run {
            return newFixedLengthResponse(Response.Status.BAD_REQUEST, "application/json", "{\"error\":\"Missing 'action'\"}")
        }

        val response = JsonObject()

        when (action) {
            "set_camera" -> {
                val facing = body.get("facing")?.asString
                // Client requests flip
                response.addProperty("success", true)
                response.addProperty("action", "set_camera")
                response.addProperty("facing", facing)
            }
            "set_zoom" -> {
                val ratio = body.get("ratio")?.asFloat ?: 1.0f
                val ok = cameraManager.setZoom(ratio)
                response.addProperty("success", ok)
                response.addProperty("currentZoom", cameraManager.currentZoomRatio)
            }
            "set_torch" -> {
                val ok = cameraManager.toggleTorch()
                response.addProperty("success", true)
                response.addProperty("torchOn", cameraManager.isTorchOn)
            }
            "take_photo" -> {
                var photoIdResult: String? = null
                var sizeResult = 0
                var errorResult: String? = null
                val lock = Object()

                cameraManager.takePhoto(
                    onSuccess = { id, size ->
                        photoIdResult = id
                        sizeResult = size
                        synchronized(lock) { lock.notify() }
                    },
                    onError = { err ->
                        errorResult = err
                        synchronized(lock) { lock.notify() }
                    }
                )

                synchronized(lock) {
                    lock.wait(5000)
                }

                if (photoIdResult != null) {
                    response.addProperty("success", true)
                    response.addProperty("photoId", photoIdResult)
                    response.addProperty("sizeBytes", sizeResult)
                    response.addProperty("downloadUrl", "/api/v1/photo/$photoIdResult")
                } else {
                    response.addProperty("success", false)
                    response.addProperty("error", errorResult ?: "Capture timeout")
                }
            }
            "disconnect" -> {
                pairingManager.revokeSession()
                isStreamingActive = false
                onStreamingChanged(false)
                response.addProperty("success", true)
                response.addProperty("message", "Session revoked")
            }
            else -> {
                response.addProperty("success", false)
                response.addProperty("error", "Unknown command action '$action'")
                return newFixedLengthResponse(Response.Status.BAD_REQUEST, "application/json", response.toString())
            }
        }

        return newFixedLengthResponse(Response.Status.OK, "application/json", response.toString())
    }

    private fun handleStream(session: IHTTPSession): Response {
        if (!validateAuth(session)) {
            return unauthorizedResponse()
        }

        isStreamingActive = true
        onStreamingChanged(true)

        val boundary = "frameboundary_androscrn"
        val pipedOut = PipedOutputStream()
        val pipedIn = PipedInputStream(pipedOut)

        thread(name = "mjpeg-stream-thread") {
            try {
                while (isStreamingActive && pairingManager.isPaired()) {
                    val frame = cameraManager.latestFrameJpeg
                    if (frame != null) {
                        val header = "--$boundary\r\nContent-Type: image/jpeg\r\nContent-Length: ${frame.size}\r\n\r\n"
                        pipedOut.write(header.toByteArray())
                        pipedOut.write(frame)
                        pipedOut.write("\r\n".toByteArray())
                        pipedOut.flush()
                    }
                    Thread.sleep(33) // ~30 FPS
                }
            } catch (e: Exception) {
                // Client closed stream connection
            } finally {
                try { pipedOut.close() } catch (ignored: Exception) {}
                isStreamingActive = false
                onStreamingChanged(false)
            }
        }

        return newChunkedResponse(
            Response.Status.OK,
            "multipart/x-mixed-replace; boundary=$boundary",
            pipedIn
        )
    }

    private fun handlePhotoDownload(session: IHTTPSession): Response {
        if (!validateAuth(session)) {
            return unauthorizedResponse()
        }

        val photoId = session.uri.removePrefix("/api/v1/photo/")
        val bytes = cameraManager.photoStore[photoId] ?: run {
            return newFixedLengthResponse(Response.Status.NOT_FOUND, "application/json", "{\"error\":\"Photo not found\"}")
        }

        return newFixedLengthResponse(
            Response.Status.OK,
            "image/jpeg",
            ByteArrayInputStream(bytes),
            bytes.size.toLong()
        )
    }

    private fun validateAuth(session: IHTTPSession): Boolean {
        // Check query param ?token=...
        val queryToken = session.parms["token"]
        if (pairingManager.validateSessionToken(queryToken)) {
            return true
        }

        // Check header Authorization: Bearer <token>
        val authHeader = session.headers["authorization"]
        if (authHeader != null && authHeader.startsWith("Bearer ", ignoreCase = true)) {
            val token = authHeader.substring(7).trim()
            if (pairingManager.validateSessionToken(token)) {
                return true
            }
        }

        return false
    }

    private fun unauthorizedResponse(): Response {
        return newFixedLengthResponse(
            Response.Status.UNAUTHORIZED,
            "application/json",
            "{\"error\":\"Unauthorized: Valid session token required. Complete pairing challenge first.\"}"
        )
    }

    private fun parseBodyJson(session: IHTTPSession): JsonObject? {
        val files = HashMap<String, String>()
        session.parseBody(files)
        val postData = files["postData"] ?: return null
        return try {
            gson.fromJson(postData, JsonObject::class.java)
        } catch (e: Exception) {
            null
        }
    }
}
