package com.androscrn.companion.protocol

import com.google.gson.JsonElement
import com.google.gson.JsonObject

/**
 * Desktop <-> companion control protocol (see docs/companion/PROTOCOL.md).
 * Pure Kotlin so it can be unit tested on the JVM.
 */
object Protocol {
    /** Bumped on any incompatible change. v1 = legacy TCP 127.0.0.1:8080 NanoHTTPD server. */
    const val VERSION = 2

    /** Abstract UNIX socket name; the desktop reaches it with `adb forward tcp:0 localabstract:<name>`. */
    const val SOCKET_NAME = "androscrn_companion"

    const val MAX_ZOOM_REQUEST = 100f

    val FACINGS = setOf("front", "back")
}

/** A validated control request. */
sealed class ControlCommand {
    data class StartCamera(val facing: String?, val cameraId: String?) : ControlCommand()
    object StopCamera : ControlCommand()
    data class SetCamera(val facing: String?, val cameraId: String?) : ControlCommand()
    data class SetZoom(val ratio: Float) : ControlCommand()
    data class SetTorch(val enabled: Boolean) : ControlCommand()
    object TakePhoto : ControlCommand()
    object Disconnect : ControlCommand()
}

sealed class ParseResult {
    data class Ok(val command: ControlCommand) : ParseResult()
    data class Error(val code: String, val message: String) : ParseResult()
}

object ControlParser {
    private val CAMERA_ID = Regex("^[A-Za-z0-9_.:-]{1,32}$")

    fun parse(body: JsonObject?): ParseResult {
        if (body == null) return ParseResult.Error("invalid_json", "Request body must be a JSON object")
        val action = body.stringOrNull("action")
            ?: return ParseResult.Error("missing_action", "Missing 'action'")

        return when (action) {
            "start_camera", "set_camera" -> {
                val facing = body.stringOrNull("facing")
                val cameraId = body.stringOrNull("cameraId")
                if (facing != null && facing !in Protocol.FACINGS) {
                    return ParseResult.Error("invalid_facing", "facing must be 'front' or 'back'")
                }
                if (cameraId != null && !CAMERA_ID.matches(cameraId)) {
                    return ParseResult.Error("invalid_camera_id", "cameraId is not a valid camera identifier")
                }
                if (action == "set_camera" && facing == null && cameraId == null) {
                    return ParseResult.Error("missing_camera", "set_camera requires 'facing' or 'cameraId'")
                }
                if (action == "start_camera") ParseResult.Ok(ControlCommand.StartCamera(facing, cameraId))
                else ParseResult.Ok(ControlCommand.SetCamera(facing, cameraId))
            }
            "stop_camera" -> ParseResult.Ok(ControlCommand.StopCamera)
            "set_zoom" -> {
                val ratio = body.numberOrNull("ratio")
                    ?: return ParseResult.Error("invalid_zoom", "ratio must be a number")
                if (ratio.isNaN() || ratio <= 0f || ratio > Protocol.MAX_ZOOM_REQUEST) {
                    return ParseResult.Error("invalid_zoom", "ratio must be > 0 and <= ${Protocol.MAX_ZOOM_REQUEST}")
                }
                ParseResult.Ok(ControlCommand.SetZoom(ratio))
            }
            "set_torch" -> {
                val enabled = body.booleanOrNull("enabled")
                    ?: return ParseResult.Error("invalid_torch", "enabled must be true or false")
                ParseResult.Ok(ControlCommand.SetTorch(enabled))
            }
            "take_photo" -> ParseResult.Ok(ControlCommand.TakePhoto)
            "disconnect" -> ParseResult.Ok(ControlCommand.Disconnect)
            else -> ParseResult.Error("unknown_action", "Unknown action")
        }
    }

    private fun JsonObject.prim(key: String): JsonElement? =
        get(key)?.takeIf { it.isJsonPrimitive }

    private fun JsonObject.stringOrNull(key: String): String? =
        prim(key)?.asJsonPrimitive?.takeIf { it.isString }?.asString

    private fun JsonObject.numberOrNull(key: String): Float? =
        prim(key)?.asJsonPrimitive?.takeIf { it.isNumber }?.asFloat

    private fun JsonObject.booleanOrNull(key: String): Boolean? =
        prim(key)?.asJsonPrimitive?.takeIf { it.isBoolean }?.asBoolean
}
