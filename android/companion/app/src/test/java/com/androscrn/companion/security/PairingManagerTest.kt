package com.androscrn.companion.security

import org.junit.Assert.*
import org.junit.Before
import org.junit.Test

/**
 * Unit tests for PairingManager:
 * - 6-digit challenge generation
 * - Brute-force rate limiting (3 failed attempts lockout)
 * - Single-use challenge consumption
 * - 64-character bearer session token generation
 * - Session token validation & emergency revocation
 */
class PairingManagerTest {

    private lateinit var pairingManager: PairingManager

    @Before
    fun setUp() {
        pairingManager = PairingManager()
    }

    @Test
    fun testGeneratePairingChallenge() {
        val pin = pairingManager.generatePairingChallenge()!!
        assertNotNull(pin)
        assertEquals(6, pin.length)
        assertTrue("PIN must consist of 6 numeric digits", pin.matches(Regex("^\\d{6}$")))
    }

    @Test
    fun testSuccessfulPairingFlow() {
        val pin = pairingManager.generatePairingChallenge()!!
        assertFalse(pairingManager.isPaired())

        val (success, token) = pairingManager.validateChallenge(pin)
        assertTrue(success)
        assertNotNull(token)
        assertEquals(64, token!!.length)
        assertTrue("Token must be a 64-character lowercase hexadecimal string", token.matches(Regex("^[0-9a-f]{64}$")))

        // Validate session is now active
        assertTrue(pairingManager.isPaired())
        assertTrue(pairingManager.validateSessionToken(token))
    }

    @Test
    fun testInvalidPinRejection() {
        pairingManager.generatePairingChallenge()
        val (success, error) = pairingManager.validateChallenge("000000")
        assertFalse(success)
        assertTrue(error!!.contains("Invalid verification PIN (1/3)"))
        assertFalse(pairingManager.isPaired())
    }

    @Test
    fun testBruteForceRateLimitLockout() {
        pairingManager.generatePairingChallenge()

        // 3 consecutive failed attempts
        pairingManager.validateChallenge("111111")
        pairingManager.validateChallenge("222222")
        val (success3, error3) = pairingManager.validateChallenge("333333")
        assertFalse(success3)

        // 4th attempt should be blocked by rate limiter
        val (success4, error4) = pairingManager.validateChallenge("444444")
        assertFalse(success4)
        assertTrue(error4!!.contains("Rate limit exceeded"))
    }

    @Test
    fun testChallengeSingleUse() {
        val pin = pairingManager.generatePairingChallenge()!!
        val (success1, _) = pairingManager.validateChallenge(pin)
        assertTrue(success1)

        // Reusing the same PIN should fail
        val (success2, error2) = pairingManager.validateChallenge(pin)
        assertFalse(success2)
        assertTrue(error2!!.contains("expired or not requested"))
    }

    @Test
    fun testSessionRevocation() {
        val pin = pairingManager.generatePairingChallenge()!!
        val (success, token) = pairingManager.validateChallenge(pin)
        assertTrue(success)
        assertTrue(pairingManager.validateSessionToken(token))

        // Emergency Kill Switch
        pairingManager.revokeSession()
        assertFalse(pairingManager.isPaired())
        assertFalse(pairingManager.validateSessionToken(token))
    }

    @Test
    fun testInvalidSessionTokens() {
        assertFalse(pairingManager.validateSessionToken(null))
        assertFalse(pairingManager.validateSessionToken(""))
        assertFalse(pairingManager.validateSessionToken("   "))
        assertFalse(pairingManager.validateSessionToken("invalid_token"))
    }

    @Test
    fun testChallengeRequestsAreRateLimitedAcrossChallenges() {
        var now = 1_000_000L
        val pm = PairingManager { now }
        repeat(PairingManager.MAX_CHALLENGES_PER_WINDOW) { assertNotNull(pm.generatePairingChallenge()) }
        assertNull("Further challenges inside the window are refused", pm.generatePairingChallenge())
        now += PairingManager.CHALLENGE_WINDOW_MS + 1
        assertNotNull("Window expiry allows new challenges", pm.generatePairingChallenge())
    }

    @Test
    fun testLockoutConsumesChallenge() {
        val pin = pairingManager.generatePairingChallenge()!!
        repeat(PairingManager.MAX_FAILED_ATTEMPTS) { pairingManager.validateChallenge("000000".takeIf { it != pin } ?: "111111") }
        val (ok, _) = pairingManager.validateChallenge(pin)
        assertFalse("Correct PIN after lockout must still be rejected", ok)
    }

    @Test
    fun testPinAndSessionExpiry() {
        var now = 0L
        val pm = PairingManager { now }
        val pin = pm.generatePairingChallenge()!!
        now += PairingManager.PIN_TTL_MS + 1
        assertFalse(pm.validateChallenge(pin).first)

        val pin2 = pm.generatePairingChallenge()!!
        val token = pm.validateChallenge(pin2).second!!
        now += PairingManager.SESSION_TTL_MS + 1
        assertFalse(pm.validateSessionToken(token))
        assertFalse(pm.isPaired())
    }
}
