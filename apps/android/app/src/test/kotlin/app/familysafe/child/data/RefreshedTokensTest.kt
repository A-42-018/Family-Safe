package app.familysafe.child.data

import org.junit.jupiter.api.Assertions.assertEquals
import org.junit.jupiter.api.Assertions.assertFalse
import org.junit.jupiter.api.Assertions.assertNotNull
import org.junit.jupiter.api.Assertions.assertNull
import org.junit.jupiter.api.Test

class RefreshedTokensTest {
    private val id = "AAAAAAAA-2222-3333-4444-555555555555"
    private val refresh = "R".repeat(43)

    private fun parse(
        deviceId: String = id,
        type: String = "Bearer",
        access: String = "aaa.bbb.ccc",
        expiresIn: Int = 900,
        refreshToken: String = refresh,
        expiresAt: String = "2026-10-30T12:00:00.000Z",
    ) = RefreshedTokens.parse(deviceId, type, access, expiresIn, refreshToken, expiresAt)

    @Test
    fun `accepts a well-formed answer and lowercases the device id`() {
        val t = parse()!!
        assertEquals(id.lowercase(), t.deviceId)
        assertEquals(900, t.accessExpiresInSeconds)
        assertEquals(1_793_361_600_000L, t.refreshExpiresAtEpochMillis)
    }

    @Test
    fun `rejects fields that break the contract`() {
        assertNull(parse(deviceId = "not-a-uuid"))
        assertNull(parse(type = "Basic"))
        assertNull(parse(access = "no-dots"))
        assertNull(parse(access = "a.b.c".padEnd(5000, 'x')))
        assertNull(parse(expiresIn = 0))
        assertNull(parse(expiresIn = 100_000))
        assertNull(parse(refreshToken = "short"))
        assertNull(parse(refreshToken = "!".repeat(43)))
        assertNull(parse(expiresAt = "tomorrow"))
    }

    @Test
    fun `a 43 character base64url refresh token is accepted`() {
        assertNotNull(parse(refreshToken = "a-_9".repeat(10) + "abc"))
    }

    @Test
    fun `never prints token material`() {
        val t = parse()!!
        assertFalse(t.toString().contains("aaa"))
        assertFalse(t.toString().contains("RRR"))
        assertFalse(RefreshOutcome.Success(t).toString().contains("aaa"))
    }
}
