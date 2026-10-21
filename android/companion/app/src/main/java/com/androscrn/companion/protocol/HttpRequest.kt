package com.androscrn.companion.protocol

import java.io.ByteArrayOutputStream
import java.io.InputStream

/** Minimal HTTP/1.1 request, enough for the companion's small JSON API. */
data class HttpRequest(
    val method: String,
    val path: String,
    val query: Map<String, String>,
    val headers: Map<String, String>,
    val body: ByteArray
)

class HttpParseException(val status: Int, message: String) : Exception(message)

/**
 * Bounded HTTP/1.1 request parser. Every limit is enforced while reading so a misbehaving client can never
 * make the companion buffer more than [MAX_HEADER_BYTES] + [MAX_BODY_BYTES].
 */
object HttpRequestParser {
    const val MAX_HEADER_BYTES = 8 * 1024
    const val MAX_BODY_BYTES = 16 * 1024
    private val METHODS = setOf("GET", "POST")

    fun parse(input: InputStream): HttpRequest {
        val head = readHead(input)
        val lines = head.split("\r\n")
        val requestLine = lines.first().split(" ")
        if (requestLine.size != 3 || !requestLine[2].startsWith("HTTP/1.")) {
            throw HttpParseException(400, "Malformed request line")
        }
        val method = requestLine[0]
        if (method !in METHODS) throw HttpParseException(405, "Method not allowed")

        val target = requestLine[1]
        if (!target.startsWith("/")) throw HttpParseException(400, "Malformed request target")
        val path = target.substringBefore('?')
        val query = parseQuery(target.substringAfter('?', ""))

        val headers = HashMap<String, String>()
        for (line in lines.drop(1)) {
            if (line.isEmpty()) continue
            val idx = line.indexOf(':')
            if (idx <= 0) throw HttpParseException(400, "Malformed header")
            headers[line.substring(0, idx).trim().lowercase()] = line.substring(idx + 1).trim()
        }

        if (headers["transfer-encoding"] != null) throw HttpParseException(501, "Transfer-Encoding not supported")
        val length = headers["content-length"]?.let {
            it.toIntOrNull() ?: throw HttpParseException(400, "Invalid Content-Length")
        } ?: 0
        if (length < 0) throw HttpParseException(400, "Invalid Content-Length")
        if (length > MAX_BODY_BYTES) throw HttpParseException(413, "Request body too large")

        val body = ByteArray(length)
        var read = 0
        while (read < length) {
            val n = input.read(body, read, length - read)
            if (n < 0) throw HttpParseException(400, "Truncated request body")
            read += n
        }
        return HttpRequest(method, path, query, headers, body)
    }

    private fun readHead(input: InputStream): String {
        val out = ByteArrayOutputStream()
        var matched = 0 // progress through \r\n\r\n
        while (true) {
            val b = input.read()
            if (b < 0) throw HttpParseException(400, if (out.size() == 0) "Empty request" else "Truncated request headers")
            out.write(b)
            if (out.size() > MAX_HEADER_BYTES) throw HttpParseException(431, "Request headers too large")
            matched = when {
                (matched == 0 || matched == 2) && b == '\r'.code -> matched + 1
                (matched == 1 || matched == 3) && b == '\n'.code -> matched + 1
                b == '\r'.code -> 1
                else -> 0
            }
            if (matched == 4) break
        }
        val bytes = out.toByteArray()
        return String(bytes, 0, bytes.size - 4, Charsets.ISO_8859_1)
    }

    private fun parseQuery(raw: String): Map<String, String> {
        if (raw.isEmpty()) return emptyMap()
        val result = HashMap<String, String>()
        for (pair in raw.split('&')) {
            if (pair.isEmpty()) continue
            val key = decode(pair.substringBefore('='))
            val value = decode(pair.substringAfter('=', ""))
            result[key] = value
        }
        return result
    }

    private fun decode(s: String): String = try {
        java.net.URLDecoder.decode(s, "UTF-8")
    } catch (e: IllegalArgumentException) {
        throw HttpParseException(400, "Malformed query string")
    }
}
