package com.androscrn.companion.security

import java.security.SecureRandom
import java.util.concurrent.atomic.AtomicInteger

/**
 * Manages out-of-band human-in-the-loop pairing, session tokens,
 * challenge expiry (TTL), and brute-force protection.
 */
class PairingManager {

    private val secureRandom = SecureRandom()
    private val failedAttempts = AtomicInteger(0)

    private var activePin: String? = null
    private var pinExpiryTimestamp: Long = 0
    private var activeSessionToken: String? = null
    private var sessionExpiryTimestamp: Long = 0

    companion object {
        private const val PIN_TTL_MS = 60_000L // 60 seconds
        private const val SESSION_TTL_MS = 3_600_000L // 1 hour
        private const val MAX_FAILED_ATTEMPTS = 3
    }

    /**
     * Generates a new cryptographically secure 6-digit pairing PIN.
     */
    @Synchronized
    fun generatePairingChallenge(): String {
        val pin = String.format("%06d", secureRandom.nextInt(1_000_000))
        activePin = pin
        pinExpiryTimestamp = System.currentTimeMillis() + PIN_TTL_MS
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
            return Pair(false, "Rate limit exceeded: Too many failed pairing attempts. Request a new PIN.")
        }

        val now = System.currentTimeMillis()
        if (activePin == null || now > pinExpiryTimestamp) {
            activePin = null
            return Pair(false, "Pairing challenge expired or not requested.")
        }

        if (activePin != pinCandidate.trim()) {
            val attempts = failedAttempts.incrementAndGet()
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
        if (token.isNullOrBlank() || activeSessionToken == null) {
            return false
        }
        val now = System.currentTimeMillis()
        if (now > sessionExpiryTimestamp) {
            revokeSession()
            return false
        }
        return activeSessionToken == token.trim()
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
        return activeSessionToken != null && System.currentTimeMillis() <= sessionExpiryTimestamp
    }
}
