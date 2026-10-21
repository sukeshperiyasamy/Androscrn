package com.androscrn.companion.tools

import android.net.LocalSocket
import android.net.LocalSocketAddress
import com.androscrn.companion.protocol.Protocol

/**
 * Debug-build-only probe for verifying the control socket's UID gate on a device.
 * Run it under different UIDs with app_process, e.g.
 *   CLASSPATH=<base.apk> app_process /system/bin com.androscrn.companion.tools.SocketProbe            (shell uid)
 *   run-as com.androscrn.companion sh -c 'CLASSPATH=<base.apk> app_process /system/bin ...'           (app uid)
 * Prints the first response line, or that the server closed the connection without answering.
 */
object SocketProbe {
    @JvmStatic
    fun main(args: Array<String>) {
        val uid = android.os.Process.myUid()
        val socket = LocalSocket()
        try {
            socket.connect(LocalSocketAddress(Protocol.SOCKET_NAME, LocalSocketAddress.Namespace.ABSTRACT))
            socket.soTimeout = 3000
            socket.outputStream.write("GET /api/v1/status HTTP/1.1\r\nHost: probe\r\n\r\n".toByteArray())
            socket.outputStream.flush()
            val buf = ByteArray(256)
            val n = try { socket.inputStream.read(buf) } catch (e: Exception) { -1 }
            if (n <= 0) println("uid=$uid RESULT=REJECTED (connection closed without a response)")
            else println("uid=$uid RESULT=ANSWERED ${String(buf, 0, n).lineSequence().first()}")
        } catch (e: Exception) {
            println("uid=$uid RESULT=CONNECT_FAILED ${e.message}")
        } finally {
            try { socket.close() } catch (_: Exception) {}
        }
    }
}
