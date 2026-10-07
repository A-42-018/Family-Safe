package app.familysafe.child.data

import app.familysafe.child.domain.EnrollmentState
import app.familysafe.child.testutil.MapSecureStore
import org.junit.jupiter.api.Assertions.assertEquals
import org.junit.jupiter.api.Assertions.assertFalse
import org.junit.jupiter.api.Assertions.assertNull
import org.junit.jupiter.api.Assertions.assertThrows
import org.junit.jupiter.api.Assertions.assertTrue
import org.junit.jupiter.api.Test

class CredentialStoreTest {
    private val backing = MapSecureStore()
    private val store = CredentialStore(backing)
    private val creds = DeviceCredentials("11111111-2222-3333-4444-555555555555", "T".repeat(43), 1_900_000_000_000L)

    @Test
    fun `round trips and reports enrolled`() {
        store.save(creds)
        val loaded = store.load()!!
        assertEquals(creds.deviceId, loaded.deviceId)
        assertEquals(creds.refreshToken, loaded.refreshToken)
        assertEquals(creds.refreshExpiresAtEpochMillis, loaded.refreshExpiresAtEpochMillis)
        assertEquals(EnrollmentState.Enrolled(creds.deviceId), store.state())
    }

    @Test
    fun `empty store is not enrolled`() {
        assertNull(store.load())
        assertEquals(EnrollmentState.NotEnrolled, store.state())
    }

    @Test
    fun `device id is written last`() {
        store.save(creds)
        assertEquals("device_id", backing.putKeys.last())
    }

    @Test
    fun `a partial write reads as absent and is cleaned up`() {
        backing.put("device_refresh_token", "x".repeat(43)) // crash before device_id
        assertNull(store.load())
        assertTrue(backing.map.isEmpty())
    }

    @Test
    fun `device id without a token reads as absent`() {
        backing.put("device_id", creds.deviceId)
        assertEquals(EnrollmentState.NotEnrolled, store.state())
        assertTrue(backing.map.isEmpty())
    }

    @Test
    fun `corrupt expiry reads as absent`() {
        store.save(creds)
        backing.map["device_refresh_expires_at"] = "not-a-number"
        assertNull(store.load())
    }

    @Test
    fun `failure while saving leaves nothing behind`() {
        backing.failPut = { it == "device_id" }
        assertThrows(IllegalStateException::class.java) { store.save(creds) }
        assertTrue(backing.map.isEmpty())
    }

    @Test
    fun `clear removes everything`() {
        store.save(creds)
        store.clear()
        assertNull(store.load())
    }

    @Test
    fun `writable probe leaves no trace and reflects failures`() {
        assertTrue(store.isWritable())
        assertTrue(backing.map.isEmpty())
        backing.failPut = { true }
        assertFalse(store.isWritable())
    }

    @Test
    fun `credentials never print secrets`() {
        assertFalse(creds.toString().contains("TTTT"))
    }
}
