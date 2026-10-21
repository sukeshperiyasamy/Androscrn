package com.androscrn.companion.server

import android.net.LocalServerSocket
import android.net.LocalSocket
import android.os.Process
import android.util.Log
import com.androscrn.companion.camera.FrameBuffer
import com.androscrn.companion.protocol.HttpParseException
import com.androscrn.companion.protocol.HttpRequestParser
import com.androscrn.companion.protocol.Protocol
import java.io.BufferedInputStream
import java.io.IOException
import java.io.OutputStream
import java.util.concurrent.Executors
import java.util.concurrent.Semaphore
import java.util.concurrent.atomic.AtomicInteger

/**
 * HTTP/1.1 server on the abstract UNIX socket [Protocol.SOCKET_NAME].
 *
 * Security: the previous server listened on TCP 127.0.0.1:8080, which every app on the phone can reach.
 * This server accepts only peers whose UID is the ADB shell (2000) or root, which is how `adb forward ...
 * localabstract:` connections arrive. Other apps on the phone are rejected before any byte is read.
 */
class CompanionServer(
    private val router: Router,
    private val frames: FrameBuffer,
    private val streamClients: AtomicInteger,
    private val onStreamingChanged: (Boolean) -> Unit,
    private val allowedUids: Set<Int> = setOf(Process.SHELL_UID, Process.ROOT_UID)
) {
    companion object {
        private const val TAG = "CompanionServer"
        private const val MAX_CONNECTIONS = 6
        private const val READ_TIMEOUT_MS = 10_000
        private const val STREAM_FRAME_WAIT_MS = 3_000L
        private const val BOUNDARY = "androscrnframe"
    }

    private val pool = Executors.newCachedThreadPool()
    private val slots = Semaphore(MAX_CONNECTIONS)
    @Volatile private var server: LocalServerSocket? = null
    @Volatile private var running = false
    private var acceptThread: Thread? = null

    fun start() {
        if (running) return
        server = LocalServerSocket(Protocol.SOCKET_NAME)
        running = true
        acceptThread = Thread({ acceptLoop() }, "companion-accept").also { it.start() }
        Log.i(TAG, "Listening on localabstract:${Protocol.SOCKET_NAME}")
    }

    fun stop() {
        running = false
        frames.clear()
        try {
            server?.close()
        } catch (e: IOException) {
            Log.w(TAG, "close failed", e)
        }
        server = null
        pool.shutdownNow()
    }

    private fun acceptLoop() {
        while (running) {
            val socket = try {
                server?.accept() ?: break
            } catch (e: IOException) {
                if (running) Log.w(TAG, "accept failed", e)
                break
            }
            val uid = try {
                socket.peerCredentials.uid
            } catch (e: IOException) {
                -1
            }
            if (uid !in allowedUids) {
                Log.w(TAG, "Rejected connection from uid $uid")
                closeQuietly(socket)
                continue
            }
            if (!slots.tryAcquire()) {
                respondAndClose(socket, RouteResult.Json(503, errorBody("busy", "Too many concurrent connections")))
                continue
            }
            pool.execute {
                try {
                    handle(socket)
                } finally {
                    slots.release()
                }
            }
        }
    }

    private fun handle(socket: LocalSocket) {
        try {
            socket.soTimeout = READ_TIMEOUT_MS
            val request = try {
                HttpRequestParser.parse(BufferedInputStream(socket.inputStream))
            } catch (e: HttpParseException) {
                respondAndClose(socket, RouteResult.Json(e.status, errorBody("bad_request", e.message ?: "Bad request")))
                return
            }
            when (val result = router.route(request)) {
                RouteResult.Stream -> serveStream(socket)
                else -> respondAndClose(socket, result)
            }
        } catch (e: Exception) {
            Log.w(TAG, "Request handling failed", e)
            closeQuietly(socket)
        }
    }

    private fun serveStream(socket: LocalSocket) {
        val out = socket.outputStream
        streamClients.incrementAndGet()
        onStreamingChanged(true)
        try {
            out.write(
                ("HTTP/1.1 200 OK\r\nContent-Type: multipart/x-mixed-replace; boundary=$BOUNDARY\r\n" +
                    "Cache-Control: no-store\r\nConnection: close\r\n\r\n").toByteArray(Charsets.ISO_8859_1)
            )
            var lastSeq = frames.latestSequence() - 1
            while (running) {
                val frame = frames.awaitNewer(lastSeq, STREAM_FRAME_WAIT_MS) ?: run {
                    // No frame: either the camera stopped (buffer cleared) or it is stalled; end the stream so the
                    // desktop reports it instead of showing a frozen image.
                    return
                }
                lastSeq = frame.sequence
                out.write("--$BOUNDARY\r\nContent-Type: image/jpeg\r\nContent-Length: ${frame.jpeg.size}\r\n\r\n".toByteArray(Charsets.ISO_8859_1))
                out.write(frame.jpeg)
                out.write("\r\n".toByteArray(Charsets.ISO_8859_1))
                out.flush()
            }
        } catch (e: IOException) {
            // Desktop closed the stream.
        } finally {
            if (streamClients.decrementAndGet() <= 0) onStreamingChanged(false)
            closeQuietly(socket)
        }
    }

    private fun respondAndClose(socket: LocalSocket, result: RouteResult) {
        try {
            val (status, type, body) = when (result) {
                is RouteResult.Json -> Triple(result.status, "application/json", result.body.toString().toByteArray(Charsets.UTF_8))
                is RouteResult.Binary -> Triple(result.status, result.contentType, result.body)
                RouteResult.Stream -> Triple(500, "application/json", ByteArray(0))
            }
            writeResponse(socket.outputStream, status, type, body)
        } catch (e: IOException) {
            // client went away
        } finally {
            closeQuietly(socket)
        }
    }

    private fun writeResponse(out: OutputStream, status: Int, type: String, body: ByteArray) {
        val head = "HTTP/1.1 $status ${reason(status)}\r\nContent-Type: $type\r\nContent-Length: ${body.size}\r\n" +
            "Cache-Control: no-store\r\nConnection: close\r\n\r\n"
        out.write(head.toByteArray(Charsets.ISO_8859_1))
        out.write(body)
        out.flush()
    }

    private fun errorBody(code: String, message: String) = com.google.gson.JsonObject().apply {
        addProperty("success", false)
        addProperty("code", code)
        addProperty("error", message)
    }

    private fun reason(status: Int) = when (status) {
        200 -> "OK"; 400 -> "Bad Request"; 401 -> "Unauthorized"; 403 -> "Forbidden"; 404 -> "Not Found"
        405 -> "Method Not Allowed"; 409 -> "Conflict"; 413 -> "Payload Too Large"; 429 -> "Too Many Requests"
        431 -> "Request Header Fields Too Large"; 501 -> "Not Implemented"; 503 -> "Service Unavailable"
        504 -> "Gateway Timeout"; else -> "Error"
    }

    private fun closeQuietly(socket: LocalSocket) {
        try {
            socket.close()
        } catch (e: IOException) {
            // ignore
        }
    }
}
