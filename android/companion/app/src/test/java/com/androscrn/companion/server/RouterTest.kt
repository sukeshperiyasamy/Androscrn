package com.androscrn.companion.server

import com.androscrn.companion.camera.CameraBackend
import com.androscrn.companion.camera.CameraDescriptor
import com.androscrn.companion.camera.CameraStatus
import com.androscrn.companion.camera.OpResult
import com.androscrn.companion.camera.PhotoResult
import com.androscrn.companion.protocol.HttpRequest
import com.androscrn.companion.protocol.Protocol
import com.androscrn.companion.security.PairingManager
import com.androscrn.companion.session.SessionState
import com.androscrn.companion.session.SessionTracker
import org.junit.Assert.assertEquals
import org.junit.Assert.assertFalse
import org.junit.Assert.assertTrue
import org.junit.Before
import org.junit.Test

class FakeCamera(private val tracker: SessionTracker) : CameraBackend {
    var permission = true
    var startResult: OpResult? = null
    val calls = mutableListOf<String>()
    var torch = false
    private val photos = HashMap<String, ByteArray>()

    override fun permissionGranted() = permission
    override fun status() = CameraStatus(tracker.isCameraActive(), "0", "back", 1f, 1f, 8f, torch, true, 720, 1280)
    override fun listCameras() = listOf(CameraDescriptor("0", "back", 90, true, listOf("1280x720")))
    override fun start(facing: String?, cameraId: String?): OpResult {
        calls += "start:$facing:$cameraId"
        if (!permission) return OpResult(false, "permission_required", "no permission")
        startResult?.let { return it }
        tracker.complete(tracker.beginCameraStart(), SessionState.STREAMING)
        return OpResult(true)
    }
    override fun stop(): OpResult {
        calls += "stop"
        tracker.complete(tracker.beginStop(), SessionState.CONNECTED)
        return OpResult(true)
    }
    override fun select(facing: String?, cameraId: String?): OpResult { calls += "select:$facing:$cameraId"; return OpResult(true) }
    override fun setZoom(ratio: Float) = OpResult(true, zoom = ratio.coerceAtMost(8f))
    override fun setTorch(enabled: Boolean): OpResult { torch = enabled; return OpResult(true, torchOn = enabled) }
    override fun takePhoto(timeoutMs: Long): PhotoResult { photos["photo_1"] = byteArrayOf(1, 2, 3); return PhotoResult(true, "photo_1", 3) }
    override fun takeStoredPhoto(id: String) = photos.remove(id)
}

class RouterTest {
    private lateinit var tracker: SessionTracker
    private lateinit var pairing: PairingManager
    private lateinit var camera: FakeCamera
    private lateinit var router: Router
    private var shownPin: String? = null

    @Before
    fun setUp() {
        tracker = SessionTracker()
        pairing = PairingManager()
        camera = FakeCamera(tracker)
        router = Router(
            DeviceInfo("1.0.0-alpha.2", 2, "21091116I", "pissarroin", "13", 33),
            pairing, camera, tracker, { 0 }, { shownPin = it }
        )
    }

    private fun get(path: String, token: String? = null, query: Map<String, String> = emptyMap()) =
        router.route(HttpRequest("GET", path, query, token?.let { mapOf("authorization" to "Bearer $it") } ?: emptyMap(), ByteArray(0)))

    private fun post(path: String, body: String, token: String? = null) =
        router.route(HttpRequest("POST", path, emptyMap(), token?.let { mapOf("authorization" to "Bearer $it") } ?: emptyMap(), body.toByteArray()))

    private fun json(r: RouteResult) = r as RouteResult.Json

    private fun pairAndGetToken(): String {
        assertEquals(200, json(post("/api/v1/pair", "{}")).status)
        val res = json(post("/api/v1/pair", """{"pin":"$shownPin"}"""))
        assertEquals(200, res.status)
        return res.body["token"].asString
    }

    @Test
    fun statusIsUnauthenticatedAndCarriesHandshakeFields() {
        val body = json(get("/api/v1/status")).body
        assertEquals(Protocol.VERSION, body["protocolVersion"].asInt)
        assertEquals(2, body["versionCode"].asInt)
        assertEquals("waiting_for_desktop", body["state"].asString)
        assertFalse(body["isPaired"].asBoolean)
        assertFalse(body["cameraActive"].asBoolean)
    }

    @Test
    fun protectedEndpointsRequireToken() {
        for (path in listOf("/api/v1/capabilities", "/api/v1/stream", "/api/v1/photo/photo_1")) {
            assertEquals(path, 401, json(get(path)).status)
            assertEquals(path, 401, json(get(path, token = "f".repeat(64))).status)
        }
        assertEquals(401, json(post("/api/v1/control", """{"action":"stop_camera"}""")).status)
        assertTrue("no camera call without auth", camera.calls.isEmpty())
    }

    @Test
    fun pairingFlowMovesStateAndRejectsWrongPin() {
        post("/api/v1/pair", "{}")
        assertEquals("pairing", tracker.state.wire)
        assertEquals(401, json(post("/api/v1/pair", """{"pin":"${if (shownPin == "000000") "111111" else "000000"}"}""")).status)
        assertEquals(400, json(post("/api/v1/pair", "not json")).status)
        val ok = json(post("/api/v1/pair", """{"pin":"$shownPin"}"""))
        assertEquals(200, ok.status)
        assertEquals(SessionState.CONNECTED, tracker.state)
    }

    @Test
    fun streamRequiresRunningCameraAndControlDrivesCamera() {
        val t = pairAndGetToken()
        assertEquals("stream before start is a conflict", 409, json(get("/api/v1/stream", t)).status)

        val start = json(post("/api/v1/control", """{"action":"start_camera","facing":"front"}""", t))
        assertEquals(200, start.status)
        assertEquals("start:front:null", camera.calls.last())
        assertEquals(RouteResult.Stream, get("/api/v1/stream", query = mapOf("token" to t)))

        val torch = json(post("/api/v1/control", """{"action":"set_torch","enabled":true}""", t))
        assertTrue(torch.body["torchOn"].asBoolean)
        assertEquals(400, json(post("/api/v1/control", """{"action":"set_zoom","ratio":-1}""", t)).status)

        val photo = json(post("/api/v1/control", """{"action":"take_photo"}""", t))
        val id = photo.body["photoId"].asString
        assertEquals(200, (get("/api/v1/photo/$id", t) as RouteResult.Binary).status)
        assertEquals("photo is single-download", 404, json(get("/api/v1/photo/$id", t)).status)
        assertEquals(400, json(get("/api/v1/photo/..%2Fx", t)).status)

        assertEquals(200, json(post("/api/v1/control", """{"action":"stop_camera"}""", t)).status)
        assertEquals(SessionState.CONNECTED, tracker.state)
    }

    @Test
    fun permissionDenialIsReportedNotLooped() {
        val t = pairAndGetToken()
        camera.permission = false
        val res = json(post("/api/v1/control", """{"action":"start_camera"}""", t))
        assertEquals(403, res.status)
        assertEquals("permission_required", res.body["code"].asString)
        assertFalse(json(get("/api/v1/status")).body["permissionGranted"].asBoolean)
    }

    @Test
    fun disconnectStopsCameraAndRevokesToken() {
        val t = pairAndGetToken()
        post("/api/v1/control", """{"action":"start_camera"}""", t)
        assertEquals(200, json(post("/api/v1/control", """{"action":"disconnect"}""", t)).status)
        assertTrue(camera.calls.contains("stop"))
        assertEquals(SessionState.WAITING_FOR_DESKTOP, tracker.state)
        assertEquals(401, json(get("/api/v1/capabilities", t)).status)
    }

    @Test
    fun unknownRoutes() {
        assertEquals(404, json(get("/")).status)
        assertEquals(405, json(post("/api/v1/status", "{}")).status)
    }

    @Test
    fun pairingClearsStaleCameraErrorState() {
        // Regression (hardware D4): after a background stop the phone kept showing "Camera unavailable" while pairing.
        tracker.set(SessionState.CAMERA_UNAVAILABLE, "Keep this app open on screen while streaming.")
        post("/api/v1/pair", "{}")
        assertEquals(SessionState.PAIRING, tracker.state)
        assertEquals(null, tracker.lastError)
        assertEquals(200, json(post("/api/v1/pair", """{"pin":"$shownPin"}""")).status)
        assertEquals(SessionState.CONNECTED, tracker.state)
    }
}
