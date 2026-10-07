package app.familysafe.child.config

import org.junit.jupiter.api.Assertions.assertEquals
import org.junit.jupiter.api.Assertions.assertFalse
import org.junit.jupiter.api.Assertions.assertTrue
import org.junit.jupiter.api.Test

class ApiBaseUrlTest {
    private fun ok(raw: String, loopback: Boolean) = ApiBaseUrl.parse(raw, loopback).getOrThrow()

    private fun bad(raw: String, loopback: Boolean) = assertTrue(ApiBaseUrl.parse(raw, loopback).isFailure, raw)

    @Test
    fun `accepts https and trims a trailing slash`() {
        assertEquals("https://abc.supabase.co/functions/v1", ok(" https://abc.supabase.co/functions/v1/ ", false).value)
    }

    @Test
    fun `builds endpoint urls`() {
        assertEquals("https://x.co/functions/v1/enrollment-redeem", ok("https://x.co/functions/v1", false).endpoint("enrollment-redeem"))
    }

    @Test
    fun `rejects unsafe endpoint names`() {
        val url = ok("https://x.co/functions/v1", false)
        listOf("../x", "a/b", "A", "", "a b").forEach {
            assertTrue(runCatching { url.endpoint(it) }.isFailure, it)
        }
    }

    @Test
    fun `cleartext only for emulator loopback and only when allowed`() {
        assertEquals("http://10.0.2.2:54321/functions/v1", ok("http://10.0.2.2:54321/functions/v1", true).value)
        ok("http://localhost:54321/functions/v1", true)
        ok("http://127.0.0.1:54321/functions/v1", true)
        bad("http://10.0.2.2:54321/functions/v1", false)
        bad("http://example.com/functions/v1", true)
        bad("http://10.0.2.2.evil.com/functions/v1", true)
    }

    @Test
    fun `rejects malformed values`() {
        listOf(
            "", "   ", "abc.supabase.co", "ftp://x.co", "https://", "https:///path",
            "https://user:pw@x.co", "https://x.co/a?b=1", "https://x.co/#f", "https://x .co",
        ).forEach { bad(it, true) }
    }

    @Test
    fun `toString never reveals the url`() {
        assertFalse(ok("https://secret-ref.supabase.co/functions/v1", false).toString().contains("secret-ref"))
    }
}
