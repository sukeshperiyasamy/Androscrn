package com.androscrn.companion

import android.Manifest
import android.content.Intent
import android.net.Uri
import android.os.Build
import android.os.Bundle
import android.os.Handler
import android.os.Looper
import android.provider.Settings
import android.util.Log
import android.view.View
import android.view.WindowManager
import android.widget.Button
import android.widget.LinearLayout
import android.widget.TextView
import androidx.activity.result.contract.ActivityResultContracts
import androidx.appcompat.app.AppCompatActivity
import androidx.camera.view.PreviewView
import androidx.core.content.ContextCompat
import androidx.core.content.pm.PackageInfoCompat
import com.androscrn.companion.camera.CompanionCamera
import com.androscrn.companion.camera.FrameBuffer
import com.androscrn.companion.protocol.Protocol
import com.androscrn.companion.security.PairingManager
import com.androscrn.companion.server.CompanionServer
import com.androscrn.companion.server.DeviceInfo
import com.androscrn.companion.server.Router
import com.androscrn.companion.session.SessionState
import com.androscrn.companion.session.SessionTracker

/**
 * Companion entry point. The activity owns the control server and camera for as long as it is alive.
 * Android only allows camera access from a visible app, so the companion must stay on screen while streaming;
 * when it leaves the screen the camera is stopped and the desktop is told why (no background capture).
 */
class MainActivity : AppCompatActivity() {

    companion object {
        private const val TAG = "CompanionMain"
        private const val WATCHDOG_INTERVAL_MS = 10_000L
        /** Stop the camera if no stream is open and no request arrived for this long (desktop gone). */
        private const val IDLE_CAMERA_TIMEOUT_MS = 60_000L
    }

    private lateinit var viewFinder: PreviewView
    private lateinit var viewFinderCover: View
    private lateinit var liveBanner: TextView
    private lateinit var pairingCard: LinearLayout
    private lateinit var txtPairingPin: TextView
    private lateinit var txtIdentity: TextView
    private lateinit var txtState: TextView
    private lateinit var txtDetails: TextView
    private lateinit var txtError: TextView
    private lateinit var stateDot: View
    private lateinit var btnPermission: Button

    private lateinit var tracker: SessionTracker
    private lateinit var pairing: PairingManager
    private lateinit var frames: FrameBuffer
    private lateinit var camera: CompanionCamera
    private var server: CompanionServer? = null
    private lateinit var versionName: String
    private var versionCode = 0

    private val main = Handler(Looper.getMainLooper())
    @Volatile private var lastActivityAt = System.currentTimeMillis()
    private var permissionAskedThisLaunch = false

    private val permissionLauncher = registerForActivityResult(ActivityResultContracts.RequestPermission()) { granted ->
        if (granted) {
            if (tracker.state == SessionState.PERMISSION_REQUIRED) {
                tracker.set(if (pairing.isPaired()) SessionState.CONNECTED else SessionState.WAITING_FOR_DESKTOP)
            }
        } else {
            tracker.set(SessionState.PERMISSION_REQUIRED, getString(R.string.guidance_permission))
        }
    }

    private val watchdog = object : Runnable {
        override fun run() {
            val idleFor = System.currentTimeMillis() - lastActivityAt
            if (tracker.isCameraActive() && camera.streamClients.get() == 0 && idleFor > IDLE_CAMERA_TIMEOUT_MS) {
                Log.i(TAG, "No desktop activity for ${idleFor / 1000}s; stopping camera")
                camera.stop()
            }
            render()
            main.postDelayed(this, WATCHDOG_INTERVAL_MS)
        }
    }

    override fun onCreate(savedInstanceState: Bundle?) {
        super.onCreate(savedInstanceState)
        setContentView(R.layout.activity_main)

        viewFinder = findViewById(R.id.viewFinder)
        viewFinderCover = findViewById(R.id.viewFinderCover)
        liveBanner = findViewById(R.id.liveBanner)
        pairingCard = findViewById(R.id.pairingCard)
        txtPairingPin = findViewById(R.id.txtPairingPin)
        txtIdentity = findViewById(R.id.txtAppIdentity)
        txtState = findViewById(R.id.txtState)
        txtDetails = findViewById(R.id.txtDetails)
        txtError = findViewById(R.id.txtError)
        stateDot = findViewById(R.id.stateDot)
        btnPermission = findViewById(R.id.btnGrantPermission)

        val info = packageManager.getPackageInfo(packageName, 0)
        versionName = info.versionName ?: "?"
        versionCode = PackageInfoCompat.getLongVersionCode(info).toInt()
        txtIdentity.text = "AndroScrn Companion $versionName (build $versionCode)"

        tracker = SessionTracker { _, _ -> runOnUiThread { render() } }
        pairing = PairingManager()
        frames = FrameBuffer()
        camera = CompanionCamera(this, this, tracker, frames) { viewFinder }

        val router = Router(
            device = DeviceInfo(versionName, versionCode, Build.MODEL, Build.PRODUCT, Build.VERSION.RELEASE, Build.VERSION.SDK_INT),
            pairing = pairing,
            camera = camera,
            tracker = tracker,
            streamClients = { camera.streamClients.get() },
            onPairingRequested = { pin -> runOnUiThread { showPairingCard(pin) } },
            onActivity = { lastActivityAt = System.currentTimeMillis() }
        )
        try {
            server = CompanionServer(router, frames, camera.streamClients, { runOnUiThread { render() } }).also { it.start() }
        } catch (e: Exception) {
            Log.e(TAG, "Control server failed to start", e)
            tracker.set(SessionState.ERROR, "Control socket could not start: ${e.message}. Close other copies of the app and reopen it.")
        }

        btnPermission.setOnClickListener { requestOrOpenSettings() }

        if (!camera.permissionGranted()) {
            tracker.set(SessionState.PERMISSION_REQUIRED, getString(R.string.guidance_permission))
            permissionAskedThisLaunch = true
            permissionLauncher.launch(Manifest.permission.CAMERA)
        }
        render()
    }

    override fun onResume() {
        super.onResume()
        // Permission may have been granted from system settings while we were away.
        val idle = if (pairing.isPaired()) SessionState.CONNECTED else SessionState.WAITING_FOR_DESKTOP
        if (tracker.state == SessionState.PERMISSION_REQUIRED && camera.permissionGranted()) {
            tracker.set(idle)
        }
        // Back on screen after the camera was stopped for being in the background: that reason no longer applies.
        if (tracker.state == SessionState.CAMERA_UNAVAILABLE && tracker.lastError == getString(R.string.guidance_background)) {
            tracker.set(idle)
        }
        main.post(watchdog)
    }

    override fun onPause() {
        super.onPause()
        main.removeCallbacks(watchdog)
    }

    override fun onStop() {
        super.onStop()
        if (tracker.isCameraActive()) {
            camera.stop()
            tracker.set(SessionState.CAMERA_UNAVAILABLE, getString(R.string.guidance_background))
        }
    }

    override fun onDestroy() {
        super.onDestroy()
        server?.stop()
        camera.shutdown()
    }

    private fun requestOrOpenSettings() {
        if (!permissionAskedThisLaunch || shouldShowRequestPermissionRationale(Manifest.permission.CAMERA)) {
            permissionAskedThisLaunch = true
            permissionLauncher.launch(Manifest.permission.CAMERA)
        } else {
            // Android will not show the dialog again after repeated denials; send the user to settings instead
            // of looping on a prompt that never appears.
            startActivity(Intent(Settings.ACTION_APPLICATION_DETAILS_SETTINGS, Uri.fromParts("package", packageName, null)))
        }
    }

    private fun showPairingCard(pin: String) {
        txtPairingPin.text = "${pin.substring(0, 3)} ${pin.substring(3)}"
        pairingCard.visibility = View.VISIBLE
        main.postDelayed({ pairingCard.visibility = View.GONE }, PairingManager.PIN_TTL_MS)
    }

    private fun render() {
        if (isFinishing || isDestroyed) return
        val state = tracker.state
        if (state == SessionState.CONNECTED || state == SessionState.STREAMING) pairingCard.visibility = View.GONE

        val (label, color) = when (state) {
            SessionState.WAITING_FOR_DESKTOP -> R.string.state_waiting to R.color.muted_text
            SessionState.PAIRING -> R.string.state_pairing to R.color.amber_warning
            SessionState.CONNECTED -> R.string.state_connected to R.color.accent_blue
            SessionState.PERMISSION_REQUIRED -> R.string.state_permission to R.color.amber_warning
            SessionState.CAMERA_UNAVAILABLE -> R.string.state_unavailable to R.color.crimson_live
            SessionState.STARTING_CAMERA -> R.string.state_starting to R.color.amber_warning
            SessionState.STREAMING -> R.string.state_streaming to R.color.emerald_green
            SessionState.STOPPING -> R.string.state_stopping to R.color.amber_warning
            SessionState.ERROR -> R.string.state_error to R.color.crimson_live
        }
        txtState.setText(label)
        stateDot.setBackgroundColor(ContextCompat.getColor(this, color))

        val cam = camera.status()
        val clients = camera.streamClients.get()
        txtDetails.text = buildString {
            append("Desktop:    ").append(if (pairing.isPaired()) "paired" else "not paired").append('\n')
            append("Permission: ").append(if (camera.permissionGranted()) "granted" else "not granted").append('\n')
            append("Camera:     ")
            if (cam.active) append("${cam.cameraId ?: "?"} (${cam.facing}) ${cam.frameWidth}x${cam.frameHeight}") else append("off")
            append('\n')
            append("Viewers:    ").append(clients).append('\n')
            append("Channel:    adb localabstract:${Protocol.SOCKET_NAME} (protocol v${Protocol.VERSION})")
        }

        val error = tracker.lastError
        txtError.visibility = if (error != null) View.VISIBLE else View.GONE
        txtError.text = error ?: ""

        val needsPermission = !camera.permissionGranted()
        btnPermission.visibility = if (needsPermission) View.VISIBLE else View.GONE
        btnPermission.setText(
            if (permissionAskedThisLaunch && !shouldShowRequestPermissionRationale(Manifest.permission.CAMERA)) R.string.open_settings
            else R.string.grant_permission
        )

        val live = state == SessionState.STREAMING && clients > 0
        liveBanner.visibility = if (live) View.VISIBLE else View.GONE
        // PreviewView keeps its last image after the camera is released; hide it so a frozen frame is never
        // mistaken for a live camera.
        viewFinderCover.visibility = if (cam.active) View.GONE else View.VISIBLE
        if (cam.active) window.addFlags(WindowManager.LayoutParams.FLAG_KEEP_SCREEN_ON)
        else window.clearFlags(WindowManager.LayoutParams.FLAG_KEEP_SCREEN_ON)
    }
}
