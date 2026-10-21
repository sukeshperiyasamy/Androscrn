package com.androscrn.companion.protocol

import com.google.gson.JsonParser
import org.junit.Assert.assertEquals
import org.junit.Assert.assertTrue
import org.junit.Test
import java.io.ByteArrayInputStream

class ProtocolTest {

    private fun parseJson(json: String) = ControlParser.parse(JsonParser.parseString(json).asJsonObject)

    private fun errorCode(json: String) = (parseJson(json) as ParseResult.Error).code

    @Test
    fun validCommandsParse() {
        assertEquals(ControlCommand.StartCamera("front", null), (parseJson("""{"action":"start_camera","facing":"front"}""") as ParseResult.Ok).command)
        assertEquals(ControlCommand.StartCamera(null, "2"), (parseJson("""{"action":"start_camera","cameraId":"2"}""") as ParseResult.Ok).command)
        assertEquals(ControlCommand.StopCamera, (parseJson("""{"action":"stop_camera"}""") as ParseResult.Ok).command)
        assertEquals(ControlCommand.SetZoom(2.5f), (parseJson("""{"action":"set_zoom","ratio":2.5}""") as ParseResult.Ok).command)
        assertEquals(ControlCommand.SetTorch(false), (parseJson("""{"action":"set_torch","enabled":false}""") as ParseResult.Ok).command)
        assertEquals(ControlCommand.Disconnect, (parseJson("""{"action":"disconnect"}""") as ParseResult.Ok).command)
    }

    @Test
    fun invalidCommandsAreRejectedWithCodes() {
        assertEquals("invalid_json", (ControlParser.parse(null) as ParseResult.Error).code)
        assertEquals("missing_action", errorCode("""{}"""))
        assertEquals("missing_action", errorCode("""{"action":5}"""))
        assertEquals("unknown_action", errorCode("""{"action":"rm -rf"}"""))
        assertEquals("invalid_facing", errorCode("""{"action":"start_camera","facing":"sideways"}"""))
        assertEquals("invalid_camera_id", errorCode("""{"action":"start_camera","cameraId":"../../etc"}"""))
        assertEquals("missing_camera", errorCode("""{"action":"set_camera"}"""))
        assertEquals("invalid_zoom", errorCode("""{"action":"set_zoom","ratio":"2"}"""))
        assertEquals("invalid_zoom", errorCode("""{"action":"set_zoom","ratio":0}"""))
        assertEquals("invalid_zoom", errorCode("""{"action":"set_zoom","ratio":1000}"""))
        // Regression: the legacy server toggled the torch regardless of the requested state.
        assertEquals("invalid_torch", errorCode("""{"action":"set_torch"}"""))
        assertEquals("invalid_torch", errorCode("""{"action":"set_torch","enabled":"yes"}"""))
    }

    private fun req(raw: String) = HttpRequestParser.parse(ByteArrayInputStream(raw.toByteArray(Charsets.ISO_8859_1)))

    private fun httpStatus(raw: String): Int = try {
        req(raw)
        200
    } catch (e: HttpParseException) {
        e.status
    }

    @Test
    fun httpRequestParsesHeadersQueryAndBody() {
        val r = req("POST /api/v1/control?token=ab%20c&x=1 HTTP/1.1\r\nHost: x\r\nContent-Type: application/json\r\nContent-Length: 4\r\n\r\n{\"a\"")
        assertEquals("POST", r.method)
        assertEquals("/api/v1/control", r.path)
        assertEquals("ab c", r.query["token"])
        assertEquals("application/json", r.headers["content-type"])
        assertEquals("{\"a\"", String(r.body))
    }

    @Test
    fun httpRequestLimitsAndMalformedInput() {
        assertEquals(400, httpStatus(""))
        assertEquals(400, httpStatus("GET /x HTTP/1.1\r\nHost: x\r\n")) // truncated head
        assertEquals(400, httpStatus("GARBAGE\r\n\r\n"))
        assertEquals(405, httpStatus("DELETE /x HTTP/1.1\r\n\r\n"))
        assertEquals(400, httpStatus("GET x HTTP/1.1\r\n\r\n"))
        assertEquals(400, httpStatus("GET /x HTTP/1.1\r\nNoColonHeader\r\n\r\n"))
        assertEquals(400, httpStatus("POST /x HTTP/1.1\r\nContent-Length: abc\r\n\r\n"))
        assertEquals(400, httpStatus("POST /x HTTP/1.1\r\nContent-Length: 10\r\n\r\nshort"))
        assertEquals(413, httpStatus("POST /x HTTP/1.1\r\nContent-Length: ${HttpRequestParser.MAX_BODY_BYTES + 1}\r\n\r\n"))
        assertEquals(501, httpStatus("POST /x HTTP/1.1\r\nTransfer-Encoding: chunked\r\n\r\n"))
        val hugeHeader = "GET /x HTTP/1.1\r\nX: " + "a".repeat(HttpRequestParser.MAX_HEADER_BYTES) + "\r\n\r\n"
        assertEquals(431, httpStatus(hugeHeader))
        assertTrue(Protocol.VERSION >= 2)
    }
}
