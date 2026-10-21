package com.androscrn.companion.session

import org.junit.Assert.assertEquals
import org.junit.Assert.assertFalse
import org.junit.Assert.assertTrue
import org.junit.Test

class SessionTrackerTest {

    @Test
    fun staleCameraCallbacksAreIgnored() {
        val t = SessionTracker()
        val first = t.beginCameraStart()
        val second = t.beginCameraStart() // rapid restart / camera switch
        assertFalse("a late result of the first start must not apply", t.complete(first, SessionState.CAMERA_UNAVAILABLE, "old error"))
        assertEquals(SessionState.STARTING_CAMERA, t.state)
        assertTrue(t.complete(second, SessionState.STREAMING))
        assertEquals(SessionState.STREAMING, t.state)
    }

    @Test
    fun stopInvalidatesInFlightStart() {
        val t = SessionTracker()
        val gen = t.beginCameraStart()
        val stopGen = t.beginStop()
        assertFalse("start finishing after stop must not resurrect STREAMING", t.complete(gen, SessionState.STREAMING))
        assertTrue(t.complete(stopGen, SessionState.CONNECTED))
        assertFalse(t.isCameraActive())
    }

    @Test
    fun repeatedStartStopKeepsConsistentState() {
        val t = SessionTracker()
        repeat(50) {
            t.complete(t.beginCameraStart(), SessionState.STREAMING)
            assertTrue(t.isCameraActive())
            t.complete(t.beginStop(), SessionState.CONNECTED)
            assertFalse(t.isCameraActive())
        }
        assertEquals(SessionState.CONNECTED, t.state)
    }

    @Test
    fun listenerSeesErrorsAndClears() {
        val seen = mutableListOf<Pair<SessionState, String?>>()
        val t = SessionTracker { s, e -> seen += s to e }
        t.set(SessionState.PERMISSION_REQUIRED, "need camera")
        t.set(SessionState.CONNECTED)
        assertEquals(SessionState.PERMISSION_REQUIRED to "need camera", seen[0])
        assertEquals(null, t.lastError)
    }
}
