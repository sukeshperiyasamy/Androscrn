package com.androscrn.companion.security

import java.security.MessageDigest
import java.security.SecureRandom
import java.util.concurrent.atomic.AtomicInteger

/**
 * Manages out-of-band human-in-the-loop pairing, session tokens,
 * challenge expiry (TTL), and brute-force protection.
 *
 * The PIN is shown only on the phone screen; the desktop user types it in. Besides the per-challenge attempt
 * limit, the number of challenges is limited per window so a client cannot brute-force by requesting
 * fresh PINs indefinitely.
 */
class PairingManager(private val clock: () -> Long = System::currentTimeMillis) {

    private val secureRandom = SecureRandom()
    private val failedAttempts = AtomicInteger(0)

    private var activePin: String? = null
    private var pinExpiryTimestamp: Long = 0
    private var activeSessionToken: String? = null
    private var sessionExpiryTimestamp: Long = 0
    private val challengeTimes = ArrayDeque<Long>()

    companion object {
        const val PIN_TTL_MS = 60_000L // 60 seconds
        const val SESSION_TTL_MS = 3_600_000L // 1 hour
        const val MAX_FAILED_ATTEMPTS = 3
        const val MAX_CHALLENGES_PER_WINDOW = 5
        const val CHALLENGE_WINDOW_MS = 5 * 60_000L
    }

    /**
     * Generates a new cryptographically secure 6-digit pairing PIN, or returns null when too many
     * challenges were requested recently.
     */
    @Synchronized
    fun generatePairingChallenge(): String? {
        val now = clock()
        while (challengeTimes.isNotEmpty() && now - challengeTimes.first() > CHALLENGE_WINDOW_MS) {
            challengeTimes.removeFirst()
        }
        if (challengeTimes.size >= MAX_CHALLENGES_PER_WINDOW) return null
        challengeTimes.addLast(now)

        val pin = String.format("%06d", secureRandom.nextInt(1_000_000))
        activePin = pin
        pinExpiryTimestamp = now + PIN_TTL_MS
        failedAttempts.set(0)
        return pin
    }

    /**
     * Validates the pairing PIN provided by the desktop client.
     * If valid, generates and returns a 64-character session token.
     */
    @Synchronized
    fun validateChallenge(pinCandidate: String): Pair<Boolean, String?> {
        if (failedAttempts.get() >= MAX_FAILED_ATTEMPTS) {
            activePin = null
            return Pair(false, "Rate limit exceeded: Too many failed pairing attempts. Request a new PIN.")
        }

        val now = clock()
        val pin = activePin
        if (pin == null || now > pinExpiryTimestamp) {
            activePin = null
            return Pair(false, "Pairing challenge expired or not requested.")
        }

        if (!constantTimeEquals(pin, pinCandidate.trim())) {
            val attempts = failedAttempts.incrementAndGet()
            if (attempts >= MAX_FAILED_ATTEMPTS) activePin = null
            return Pair(false, "Invalid verification PIN ($attempts/$MAX_FAILED_ATTEMPTS).")
        }

        // Challenge accepted: issue 64-char session token
        val tokenBytes = ByteArray(32)
        secureRandom.nextBytes(tokenBytes)
        val token = tokenBytes.joinToString("") { "%02x".format(it) }

        activeSessionToken = token
        sessionExpiryTimestamp = now + SESSION_TTL_MS
        activePin = null // Consume single-use challenge
        failedAttempts.set(0)

        return Pair(true, token)
    }

    /**
     * Verifies that the provided bearer token is active and unexpired.
     */
    @Synchronized
    fun validateSessionToken(token: String?): Boolean {
        val active = activeSessionToken
        if (token.isNullOrBlank() || active == null) {
            return false
        }
        if (clock() > sessionExpiryTimestamp) {
            revokeSession()
            return false
        }
        return constantTimeEquals(active, token.trim())
    }

    /**
     * Immediately purges the active session token (Emergency Kill Switch).
     */
    @Synchronized
    fun revokeSession() {
        activeSessionToken = null
        sessionExpiryTimestamp = 0
        activePin = null
        failedAttempts.set(0)
    }

    @Synchronized
    fun isPaired(): Boolean {
        return activeSessionToken != null && clock() <= sessionExpiryTimestamp
    }

    @Synchronized
    fun hasPendingChallenge(): Boolean = activePin != null && clock() <= pinExpiryTimestamp

    private fun constantTimeEquals(a: String, b: String): Boolean =
        MessageDigest.isEqual(a.toByteArray(Charsets.UTF_8), b.toByteArray(Charsets.UTF_8))
}
