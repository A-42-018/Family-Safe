package app.familysafe.child.domain

import java.net.URLDecoder

/**
 * Pairing-code rules. Mirrors `packages/contracts/src/enrollment.ts` and `supabase/functions/_shared/enrollment.ts`
 * (a JVM test reads the contracts file and fails on drift). The code is a credential: never log it, never persist it.
 */
object PairingCode {
    /** Crockford base32 (no I, L, O, U). */
    const val ALPHABET = "0123456789ABCDEFGHJKMNPQRSTVWXYZ"
    const val LENGTH = 16
    const val QR_SCHEME = "familysafe://enroll"

    /** Upper bound the server accepts before validation; also bounds what we keep in memory. */
    const val MAX_INPUT = 64

    /** Uppercase, drop whitespace and hyphens, apply Crockford aliases (O to 0, I/L to 1). Does not validate. */
    fun normalize(input: String): String = buildString {
        for (ch in input.uppercase()) {
            when {
                ch.isWhitespace() || ch == '-' -> Unit
                ch == 'O' -> append('0')
                ch == 'I' || ch == 'L' -> append('1')
                else -> append(ch)
            }
        }
    }

    fun isValid(normalized: String): Boolean = normalized.length == LENGTH && normalized.all { it in ALPHABET }

    /** `XXXX-XXXX-XXXX-XXXX` for display. */
    fun format(code: String): String = code.chunked(4).joinToString("-")

    /** Extracts a valid, normalized code from `familysafe://enroll?c=<code>`, or null. */
    fun fromQrPayload(payload: String): String? {
        val trimmed = payload.trim()
        if (!trimmed.startsWith("$QR_SCHEME?")) return null
        val query = trimmed.substring(QR_SCHEME.length + 1)
        val raw = query.split('&')
            .firstOrNull { it.substringBefore('=') == "c" && '=' in it }
            ?.substringAfter('=') ?: return null
        val decoded = try {
            URLDecoder.decode(raw, "UTF-8")
        } catch (_: IllegalArgumentException) {
            return null
        }
        return normalize(decoded).takeIf(::isValid)
    }

    /**
     * Turns whatever the child typed or pasted into normalized text (not necessarily valid yet).
     * A pasted `familysafe://enroll?c=…` payload is unwrapped. Output length is bounded.
     */
    fun sanitizeTyped(raw: String): String {
        val bounded = raw.take(MAX_INPUT * 4)
        if (bounded.trim().startsWith(QR_SCHEME)) return fromQrPayload(bounded).orEmpty()
        return normalize(bounded).take(MAX_INPUT)
    }
}
