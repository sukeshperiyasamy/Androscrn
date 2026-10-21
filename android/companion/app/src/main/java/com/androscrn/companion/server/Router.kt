package com.androscrn.companion.server

import com.androscrn.companion.camera.CameraBackend
import com.androscrn.companion.camera.OpResult
import com.androscrn.companion.protocol.ControlCommand
import com.androscrn.companion.protocol.ControlParser
import com.androscrn.companion.protocol.HttpRequest
import com.androscrn.companion.protocol.ParseResult
import com.androscrn.companion.protocol.Protocol
import com.androscrn.companion.security.PairingManager
import com.androscrn.companion.session.SessionState
import com.androscrn.companion.session.SessionTracker
import com.google.gson.Gson
import com.google.gson.JsonObject
import com.google.gson.JsonParser

sealed class RouteResult {
    data class Json(val status: Int, val body: JsonObject) : RouteResult()
    data class Binary(val status: Int, val contentType: String, val body: ByteArray) : RouteResult()
    /** Authenticated request for the MJPEG stream; the socket layer serves it. */
    object Stream : RouteResult()
}

data class DeviceInfo(
    val companionVersion: String,
    val versionCode: Int,
    val model: String,
    val product: String,
    val androidVersion: String,
    val sdkInt: Int
)

/**
 * Pure request router: validation, authentication and dispatch, independent of the socket transport so it can be
 * unit tested on the JVM. Status is the only unauthenticated endpoint besides pairing; it carries the protocol
 * version used for the desktop handshake.
 */
class Router(
    private val device: DeviceInfo,
    private val pairing: PairingManager,
    private val camera: CameraBackend,
    private val tracker: SessionTracker,
    private val streamClients: () -> Int,
    private val onPairingRequested: (String) -> Unit,
    private val onActivity: () -> Unit = {}
) {
    private val gson = Gson()

    fun route(req: HttpRequest): RouteResult {
        onActivity()
        return when {
            req.path == "/api/v1/status" && req.method == "GET" -> json(200, statusJson())
            req.path == "/api/v1/pair" && req.method == "POST" -> pair(req)
            req.path == "/api/v1/capabilities" && req.method == "GET" -> authed(req) { json(200, capabilities()) }
            req.path == "/api/v1/control" && req.method == "POST" -> authed(req) { control(req) }
            req.path == "/api/v1/stream" && req.method == "GET" -> authed(req) {
                if (!tracker.isCameraActive()) error(409, "camera_not_running", "Start the camera before opening the stream.")
                else RouteResult.Stream
            }
            req.path.startsWith("/api/v1/photo/") && req.method == "GET" -> authed(req) { photo(req) }
            req.path.startsWith("/api/v1/") -> error(405, "method_not_allowed", "Unsupported method or endpoint")
            else -> error(404, "not_found", "Not Found")
        }
    }

    fun statusJson(): JsonObject {
        val cam = camera.status()
        return JsonObject().apply {
            addProperty("status", "ready")
            addProperty("protocolVersion", Protocol.VERSION)
            addProperty("companionVersion", device.companionVersion)
            addProperty("versionCode", device.versionCode)
            addProperty("state", tracker.state.wire)
            tracker.lastError?.let { addProperty("error", it) }
            addProperty("deviceModel", device.model)
            addProperty("deviceProduct", device.product)
            addProperty("androidVersion", device.androidVersion)
            addProperty("sdkVersion", device.sdkInt)
            addProperty("permissionGranted", camera.permissionGranted())
            addProperty("isPaired", pairing.isPaired())
            addProperty("pairingPending", pairing.hasPendingChallenge())
            addProperty("cameraActive", cam.active)
            addProperty("isStreaming", tracker.state == SessionState.STREAMING && streamClients() > 0)
            addProperty("streamClients", streamClients())
            cam.cameraId?.let { addProperty("cameraId", it) }
            addProperty("cameraFacing", cam.facing ?: "back")
            addProperty("currentZoom", cam.zoom)
            addProperty("minZoom", cam.minZoom)
            addProperty("maxZoom", cam.maxZoom)
            addProperty("torchOn", cam.torchOn)
            addProperty("frameWidth", cam.frameWidth)
            addProperty("frameHeight", cam.frameHeight)
        }
    }

    private fun capabilities(): JsonObject = JsonObject().apply {
        addProperty("protocolVersion", Protocol.VERSION)
        addProperty("transport", "adb_forward_localabstract")
        addProperty("deviceModel", device.model)
        addProperty("streamFormat", "mjpeg")
        addProperty("torchSupported", true)
        addProperty("zoomSupported", true)
        addProperty("minZoom", camera.status().minZoom)
        addProperty("maxZoom", camera.status().maxZoom)
        addProperty("snapshotsSupported", true)
        addProperty("inAppPreviewSupported", true)
        add("cameras", gson.toJsonTree(camera.listCameras()))
    }

    private fun pair(req: HttpRequest): RouteResult {
        val body = parseBody(req)
        if (req.body.isNotEmpty() && body == null) return error(400, "invalid_json", "Request body must be a JSON object")
        val pinEl = body?.get("pin")
        val candidate = if (pinEl != null && pinEl.isJsonPrimitive && pinEl.asJsonPrimitive.isString) pinEl.asString else null

        if (candidate.isNullOrBlank()) {
            val pin = pairing.generatePairingChallenge()
                ?: return error(429, "too_many_challenges", "Too many pairing requests. Wait a few minutes and try again.")
            // Any idle state (including a stale camera error) moves to PAIRING; a running camera is left alone.
            if (!tracker.isCameraActive()) tracker.set(SessionState.PAIRING)
            onPairingRequested(pin)
            return json(200, JsonObject().apply {
                addProperty("success", true)
                addProperty("message", "Pairing challenge generated. Check phone screen for verification PIN.")
                addProperty("expiresInSeconds", PairingManager.PIN_TTL_MS / 1000)
            })
        }

        val (valid, result) = pairing.validateChallenge(candidate)
        return if (valid && result != null) {
            if (!tracker.isCameraActive()) tracker.set(SessionState.CONNECTED)
            json(200, JsonObject().apply {
                addProperty("success", true)
                addProperty("token", result)
                addProperty("message", "Pairing approved. Use bearer token for subsequent control and streaming.")
            })
        } else {
            error(401, "pairing_rejected", result ?: "Invalid PIN")
        }
    }

    private fun control(req: HttpRequest): RouteResult {
        val command = when (val parsed = ControlParser.parse(parseBody(req))) {
            is ParseResult.Error -> return error(400, parsed.code, parsed.message)
            is ParseResult.Ok -> parsed.command
        }
        return when (command) {
            is ControlCommand.StartCamera -> op("start_camera", camera.start(command.facing, command.cameraId))
            ControlCommand.StopCamera -> op("stop_camera", camera.stop())
            is ControlCommand.SetCamera -> op("set_camera", camera.select(command.facing, command.cameraId))
            is ControlCommand.SetZoom -> op("set_zoom", camera.setZoom(command.ratio))
            is ControlCommand.SetTorch -> op("set_torch", camera.setTorch(command.enabled))
            ControlCommand.TakePhoto -> {
                val res = camera.takePhoto(5_000)
                if (!res.success) return error(statusFor(res.code), res.code ?: "capture_failed", res.message ?: "Photo capture failed")
                json(200, JsonObject().apply {
                    addProperty("success", true)
                    addProperty("action", "take_photo")
                    addProperty("photoId", res.photoId)
                    addProperty("sizeBytes", res.sizeBytes)
                    addProperty("downloadUrl", "/api/v1/photo/${res.photoId}")
                })
            }
            ControlCommand.Disconnect -> {
                if (camera.status().active) camera.stop()
                pairing.revokeSession()
                tracker.set(SessionState.WAITING_FOR_DESKTOP)
                json(200, JsonObject().apply {
                    addProperty("success", true)
                    addProperty("action", "disconnect")
                    addProperty("message", "Session revoked")
                })
            }
        }
    }

    private fun op(action: String, res: OpResult): RouteResult {
        if (!res.success) return error(statusFor(res.code), res.code ?: "failed", res.message ?: "$action failed")
        return json(200, JsonObject().apply {
            addProperty("success", true)
            addProperty("action", action)
            res.message?.let { addProperty("message", it) }
            res.zoom?.let { addProperty("currentZoom", it) }
            res.torchOn?.let { addProperty("torchOn", it) }
            addProperty("state", tracker.state.wire)
        })
    }

    private fun photo(req: HttpRequest): RouteResult {
        val id = req.path.removePrefix("/api/v1/photo/")
        if (!Regex("^photo_\\d{1,20}$").matches(id)) return error(400, "invalid_photo_id", "Invalid photo id")
        val bytes = camera.takeStoredPhoto(id) ?: return error(404, "photo_not_found", "Photo not found or already downloaded")
        return RouteResult.Binary(200, "image/jpeg", bytes)
    }

    private inline fun authed(req: HttpRequest, block: () -> RouteResult): RouteResult {
        val header = req.headers["authorization"]
        val token = when {
            header != null && header.startsWith("Bearer ", ignoreCase = true) -> header.substring(7).trim()
            else -> req.query["token"]
        }
        if (!pairing.validateSessionToken(token)) {
            return error(401, "unauthorized", "Valid session token required. Complete pairing first.")
        }
        return block()
    }

    private fun parseBody(req: HttpRequest): JsonObject? {
        if (req.body.isEmpty()) return null
        return try {
            val el = JsonParser.parseString(String(req.body, Charsets.UTF_8))
            if (el.isJsonObject) el.asJsonObject else null
        } catch (e: Exception) {
            null
        }
    }

    private fun statusFor(code: String?): Int = when (code) {
        "permission_required" -> 403
        "camera_not_running" -> 409
        "camera_not_found", "torch_unsupported" -> 404
        "timeout" -> 504
        else -> 500
    }

    private fun json(status: Int, body: JsonObject) = RouteResult.Json(status, body)

    private fun error(status: Int, code: String, message: String) = RouteResult.Json(status, JsonObject().apply {
        addProperty("success", false)
        addProperty("code", code)
        addProperty("error", message)
    })
}
