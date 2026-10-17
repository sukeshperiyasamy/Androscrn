package com.androscrn.companion

import android.Manifest
import android.content.pm.PackageManager
import android.os.Bundle
import android.view.View
import android.widget.Button
import android.widget.LinearLayout
import android.widget.TextView
import android.widget.Toast
import androidx.activity.result.contract.ActivityResultContracts
import androidx.appcompat.app.AppCompatActivity
import androidx.camera.view.PreviewView
import androidx.cardview.widget.CardView
import androidx.core.content.ContextCompat
import com.androscrn.companion.camera.CameraManager
import com.androscrn.companion.security.PairingManager
import com.androscrn.companion.server.CompanionHttpServer

/**
 * Main Android Companion Activity:
 * - Viewfinder with CameraX
 * - Embedded HTTP server for localhost ADB port-forwarding (127.0.0.1:8080)
 * - Anti-covert surveillance live banner
 * - Challenge-response PIN pairing modal
 * - Dynamic zoom, lens flipping, and torch controls
 */
class MainActivity : AppCompatActivity() {

    private lateinit var viewFinder: PreviewView
    private lateinit var liveBanner: LinearLayout
    private lateinit var pairingCard: CardView
    private lateinit var txtPairingPin: TextView
    private lateinit var txtPairingExpiry: TextView
    private lateinit var txtCameraFacing: TextView
    private lateinit var txtZoomRatio: TextView
    private lateinit var txtTorchState: TextView
    private lateinit var permissionOverlay: LinearLayout

    private lateinit var cameraManager: CameraManager
    private lateinit var pairingManager: PairingManager
    private var httpServer: CompanionHttpServer? = null

    private val requestPermissionLauncher = registerForActivityResult(
        ActivityResultContracts.RequestPermission()
    ) { isGranted: Boolean ->
        if (isGranted) {
            permissionOverlay.visibility = View.GONE
            initializeCameraAndServer()
        } else {
            permissionOverlay.visibility = View.VISIBLE
            Toast.makeText(this, "Camera permission denied.", Toast.LENGTH_LONG).show()
        }
    }

    override fun onCreate(savedInstanceState: Bundle?) {
        super.onCreate(savedInstanceState)
        setContentView(R.layout.activity_main)

        // Initialize UI Views
        viewFinder = findViewById(R.id.viewFinder)
        liveBanner = findViewById(R.id.liveBanner)
        pairingCard = findViewById(R.id.pairingCard)
        txtPairingPin = findViewById(R.id.txtPairingPin)
        txtPairingExpiry = findViewById(R.id.txtPairingExpiry)
        txtCameraFacing = findViewById(R.id.txtCameraFacing)
        txtZoomRatio = findViewById(R.id.txtZoomRatio)
        txtTorchState = findViewById(R.id.txtTorchState)
        permissionOverlay = findViewById(R.id.permissionOverlay)

        findViewById<Button>(R.id.btnGrantPermission).setOnClickListener {
            checkCameraPermission()
        }

        findViewById<Button>(R.id.btnFlipCamera).setOnClickListener {
            cameraManager.flipCamera(viewFinder)
            updateTelemetryDisplay()
        }

        findViewById<Button>(R.id.btnToggleTorch).setOnClickListener {
            cameraManager.toggleTorch()
            updateTelemetryDisplay()
        }

        findViewById<Button>(R.id.btnLocalSnapshot).setOnClickListener {
            cameraManager.takePhoto(
                onSuccess = { id, size ->
                    runOnUiThread {
                        Toast.makeText(this, "Photo saved: ${size / 1024} KB", Toast.LENGTH_SHORT).show()
                    }
                },
                onError = { err ->
                    runOnUiThread {
                        Toast.makeText(this, "Photo error: $err", Toast.LENGTH_SHORT).show()
                    }
                }
            )
        }

        checkCameraPermission()
    }

    private fun checkCameraPermission() {
        when {
            ContextCompat.checkSelfPermission(this, Manifest.permission.CAMERA) == PackageManager.PERMISSION_GRANTED -> {
                permissionOverlay.visibility = View.GONE
                initializeCameraAndServer()
            }
            else -> {
                permissionOverlay.visibility = View.VISIBLE
                requestPermissionLauncher.launch(Manifest.permission.CAMERA)
            }
        }
    }

    private fun initializeCameraAndServer() {
        pairingManager = PairingManager()
        cameraManager = CameraManager(this, this)

        cameraManager.startCamera(viewFinder) {
            updateTelemetryDisplay()
        }

        // Start embedded HTTP server for localhost ADB port-forwarding
        try {
            httpServer = CompanionHttpServer(
                port = 8080,
                cameraManager = cameraManager,
                pairingManager = pairingManager,
                onPairingRequested = { pin ->
                    runOnUiThread {
                        showPairingCard(pin)
                    }
                },
                onStreamingChanged = { isStreaming ->
                    runOnUiThread {
                        liveBanner.visibility = if (isStreaming) View.VISIBLE else View.GONE
                    }
                }
            )
            httpServer?.start()
        } catch (e: Exception) {
            Toast.makeText(this, "Server start error: ${e.message}", Toast.LENGTH_LONG).show()
        }
    }

    private fun showPairingCard(pin: String) {
        txtPairingPin.text = "${pin.substring(0, 3)} ${pin.substring(3)}"
        pairingCard.visibility = View.VISIBLE

        // Auto hide pairing card after 60s
        pairingCard.postDelayed({
            pairingCard.visibility = View.GONE
        }, 60_000)
    }

    private fun updateTelemetryDisplay() {
        txtCameraFacing.text = "Lens: ${if (cameraManager.currentFacing == 0) "Front" else "Back Main"}"
        txtZoomRatio.text = "Zoom: ${String.format("%.1f", cameraManager.currentZoomRatio)}x"
        txtTorchState.text = "Torch: ${if (cameraManager.isTorchOn) "On" else "Off"}"
    }

    override fun onDestroy() {
        super.onDestroy()
        httpServer?.stop()
        cameraManager.shutdown()
    }
}
