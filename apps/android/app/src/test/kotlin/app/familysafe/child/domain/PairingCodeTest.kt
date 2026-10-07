package app.familysafe.child.domain

import app.familysafe.child.testutil.RepoFiles
import app.familysafe.child.testutil.VALID_CODE
import org.junit.jupiter.api.Assertions.assertEquals
import org.junit.jupiter.api.Assertions.assertFalse
import org.junit.jupiter.api.Assertions.assertNull
import org.junit.jupiter.api.Assertions.assertTrue
import org.junit.jupiter.api.Test

class PairingCodeTest {
    @Test
    fun `normalize uppercases drops separators and applies Crockford aliases`() {
        assertEquals(VALID_CODE, PairingCode.normalize("0123-4567 89ab\tcdef"))
        assertEquals("001111", PairingCode.normalize("oOiIlL"))
    }

    @Test
    fun `isValid needs exactly 16 symbols from the alphabet`() {
        assertTrue(PairingCode.isValid(VALID_CODE))
        assertFalse(PairingCode.isValid(VALID_CODE.dropLast(1)))
        assertFalse(PairingCode.isValid(VALID_CODE + "0"))
        assertFalse(PairingCode.isValid("0123456789ABCDEU")) // U is not Crockford
        assertFalse(PairingCode.isValid("0123456789abcdef")) // must be normalized first
        assertFalse(PairingCode.isValid(""))
    }

    @Test
    fun `format groups in fours`() {
        assertEquals("0123-4567-89AB-CDEF", PairingCode.format(VALID_CODE))
        assertEquals("0123-45", PairingCode.format("012345"))
        assertEquals("", PairingCode.format(""))
    }

    @Test
    fun `QR payload is parsed and normalized`() {
        assertEquals(VALID_CODE, PairingCode.fromQrPayload("familysafe://enroll?c=$VALID_CODE"))
        assertEquals(VALID_CODE, PairingCode.fromQrPayload("  familysafe://enroll?c=0123%2D4567%2D89ab%2Dcdef "))
        assertEquals(VALID_CODE, PairingCode.fromQrPayload("familysafe://enroll?x=1&c=$VALID_CODE&y=2"))
    }

    @Test
    fun `QR payload rejects anything else`() {
        assertNull(PairingCode.fromQrPayload("https://enroll?c=$VALID_CODE"))
        assertNull(PairingCode.fromQrPayload("familysafe://enroll.evil?c=$VALID_CODE"))
        assertNull(PairingCode.fromQrPayload("familysafe://enroll?code=$VALID_CODE"))
        assertNull(PairingCode.fromQrPayload("familysafe://enroll?c="))
        assertNull(PairingCode.fromQrPayload("familysafe://enroll?c"))
        assertNull(PairingCode.fromQrPayload("familysafe://enroll?c=TOOSHORT"))
        assertNull(PairingCode.fromQrPayload("familysafe://enroll?c=%zz"))
    }

    @Test
    fun `first c parameter wins`() {
        assertNull(PairingCode.fromQrPayload("familysafe://enroll?c=BAD&c=$VALID_CODE"))
    }

    @Test
    fun `typed input is sanitized and bounded`() {
        assertEquals(VALID_CODE, PairingCode.sanitizeTyped("0123-4567-89ab-cdef"))
        assertEquals(VALID_CODE, PairingCode.sanitizeTyped("familysafe://enroll?c=$VALID_CODE"))
        assertEquals("", PairingCode.sanitizeTyped("familysafe://enroll?c=nope"))
        assertEquals(PairingCode.MAX_INPUT, PairingCode.sanitizeTyped("A".repeat(10_000)).length)
    }

    @Test
    fun `constants match the contracts file`() {
        val ts = RepoFiles.read("packages/contracts/src/enrollment.ts")
        fun grab(regex: String) = Regex(regex).find(ts)?.groupValues?.get(1) ?: error("missing $regex")
        assertEquals(PairingCode.ALPHABET, grab("""PAIRING_ALPHABET = "([^"]+)""""))
        assertEquals(PairingCode.LENGTH, grab("""PAIRING_CODE_LENGTH = (\d+)""").toInt())
        assertEquals(PairingCode.QR_SCHEME, grab("""QR_SCHEME = "([^"]+)""""))
        assertEquals(PairingCode.MAX_INPUT, grab("""\.max\((\d+)\)\s*\.transform\(normalizePairingCode\)""").toInt())
    }

    @Test
    fun `constants match the Edge mirror`() {
        val ts = RepoFiles.read("supabase/functions/_shared/enrollment.ts")
        assertTrue(ts.contains("PAIRING_ALPHABET = \"${PairingCode.ALPHABET}\""))
        assertTrue(ts.contains("PAIRING_CODE_LENGTH = ${PairingCode.LENGTH}"))
    }
}
