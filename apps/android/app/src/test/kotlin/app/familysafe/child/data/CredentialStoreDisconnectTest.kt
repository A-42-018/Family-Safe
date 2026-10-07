package app.familysafe.child.data

import app.familysafe.child.domain.DeviceAuthState
import app.familysafe.child.testutil.MapSecureStore
import org.junit.jupiter.api.Assertions.assertEquals
import org.junit.jupiter.api.Assertions.assertFalse
import org.junit.jupiter.api.Assertions.assertNull
import org.junit.jupiter.api.Assertions.assertThrows
import org.junit.jupiter.api.Test

class CredentialStoreDisconnectTest {
    private val store = MapSecureStore()
    private val creds = CredentialStore(store)
    private val saved = DeviceCredentials("11111111-2222-3333-4444-555555555555", "S".repeat(43), 5L)

    @Test
    fun `remembers a disconnect reason and clear keeps it`() {
        creds.save(saved)
        creds.clear()
        creds.markDisconnected(DeviceAuthState.Revoked)
        assertEquals(DeviceAuthState.Revoked, creds.disconnectReason())
        creds.clear()
        assertEquals(DeviceAuthState.Revoked, creds.disconnectReason())
        assertNull(creds.load())
        assertEquals(DeviceAuthState.Revoked, creds.disconnectReason())
    }

    @Test
    fun `saving credentials forgets the reason`() {
        creds.markDisconnected(DeviceAuthState.Expired)
        creds.save(saved)
        assertNull(creds.disconnectReason())
    }

    @Test
    fun `only disconnected states can be stored and unknown text reads as nothing`() {
        assertThrows(IllegalArgumentException::class.java) { creds.markDisconnected(DeviceAuthState.Connected) }
        assertThrows(IllegalArgumentException::class.java) { creds.markDisconnected(DeviceAuthState.Unknown) }
        store.put("disconnect_reason", "Connected")
        assertNull(creds.disconnectReason())
        store.put("disconnect_reason", "garbage")
        assertNull(creds.disconnectReason())
    }

    @Test
    fun `the reason is not a secret and the marker holds no token`() {
        creds.save(saved)
        creds.clear()
        creds.markDisconnected(DeviceAuthState.Uncertain)
        assertFalse(store.map.values.any { it.contains("SSSS") })
    }
}
