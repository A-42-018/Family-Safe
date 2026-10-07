package app.familysafe.child.data

import app.familysafe.child.domain.PermissionKey
import app.familysafe.child.testutil.MapSecureStore
import org.junit.jupiter.api.Assertions.assertEquals
import org.junit.jupiter.api.Assertions.assertFalse
import org.junit.jupiter.api.Assertions.assertTrue
import org.junit.jupiter.api.Test

class PermissionHistoryStoreTest {
    @Test
    fun `starts empty`() {
        val history = PermissionHistoryStore(MapSecureStore())
        for (key in PermissionKey.entries) {
            assertFalse(history.everGranted(key))
            assertFalse(history.wasRequested(key))
        }
    }

    @Test
    fun `remembers grants and requests across a restart in one key`() {
        val backing = MapSecureStore()
        val history = PermissionHistoryStore(backing)
        history.markGranted(listOf(PermissionKey.CAMERA, PermissionKey.LOCATION))
        history.markRequested(PermissionKey.MICROPHONE)
        val reopened = PermissionHistoryStore(backing)
        assertTrue(reopened.everGranted(PermissionKey.CAMERA))
        assertTrue(reopened.everGranted(PermissionKey.LOCATION))
        assertFalse(reopened.everGranted(PermissionKey.MICROPHONE))
        assertTrue(reopened.wasRequested(PermissionKey.MICROPHONE))
        assertEquals(setOf("permission_history"), backing.putKeys.toSet())
    }

    @Test
    fun `writes only when something is new`() {
        val backing = MapSecureStore()
        val history = PermissionHistoryStore(backing)
        history.markGranted(listOf(PermissionKey.CAMERA))
        history.markGranted(listOf(PermissionKey.CAMERA))
        history.markGranted(emptyList())
        history.markRequested(PermissionKey.CONTACTS)
        history.markRequested(PermissionKey.CONTACTS)
        assertEquals(2, backing.putKeys.size)
    }

    @Test
    fun `keys that are never shared are not recorded`() {
        val backing = MapSecureStore()
        val history = PermissionHistoryStore(backing)
        history.markGranted(listOf(PermissionKey.USAGE_ACCESS, PermissionKey.NOTIFICATIONS))
        history.markRequested(PermissionKey.APP_LIST)
        assertTrue(backing.putKeys.isEmpty())
        assertFalse(history.everGranted(PermissionKey.USAGE_ACCESS))
        assertFalse(history.wasRequested(PermissionKey.APP_LIST))
    }

    @Test
    fun `junk or unreadable storage reads as no history`() {
        val backing = MapSecureStore()
        for (junk in listOf("", "g:camera", "x:camera;r:", "g:camera;r:;extra", "g:nope;r:alsonope")) {
            backing.map["permission_history"] = junk
            val history = PermissionHistoryStore(backing)
            for (key in PermissionKey.entries) assertFalse(history.everGranted(key), junk)
        }
        backing.failGet = true
        assertFalse(PermissionHistoryStore(backing).everGranted(PermissionKey.CAMERA))
    }

    @Test
    fun `a failed write keeps the value for this process`() {
        val backing = MapSecureStore().apply { failPut = { true } }
        val history = PermissionHistoryStore(backing)
        history.markGranted(listOf(PermissionKey.CAMERA))
        assertTrue(history.everGranted(PermissionKey.CAMERA))
    }
}
