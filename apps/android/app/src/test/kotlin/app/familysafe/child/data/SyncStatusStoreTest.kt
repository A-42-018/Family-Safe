package app.familysafe.child.data

import app.familysafe.child.testutil.MapSecureStore
import org.junit.jupiter.api.Assertions.assertEquals
import org.junit.jupiter.api.Assertions.assertFalse
import org.junit.jupiter.api.Assertions.assertNull
import org.junit.jupiter.api.Assertions.assertTrue
import org.junit.jupiter.api.Test

class SyncStatusStoreTest {
    @Test
    fun `starts as never`() {
        val store = SyncStatusStore(MapSecureStore())
        assertNull(store.status.value.lastSyncEpochMillis)
        assertFalse(store.status.value.hasSynced)
    }

    @Test
    fun `records and survives a restart`() {
        val backing = MapSecureStore()
        SyncStatusStore(backing).recordSuccess(1_700_000_000_000L)
        val reopened = SyncStatusStore(backing)
        assertEquals(1_700_000_000_000L, reopened.status.value.lastSyncEpochMillis)
        assertTrue(reopened.status.value.hasSynced)
    }

    @Test
    fun `clear forgets it in memory and in storage`() {
        val backing = MapSecureStore()
        val store = SyncStatusStore(backing)
        store.recordSuccess(5L)
        store.clear()
        assertNull(store.status.value.lastSyncEpochMillis)
        assertNull(SyncStatusStore(backing).status.value.lastSyncEpochMillis)
    }

    @Test
    fun `junk in storage reads as never`() {
        val backing = MapSecureStore().apply { map["last_sync_at"] = "yesterday" }
        assertNull(SyncStatusStore(backing).status.value.lastSyncEpochMillis)
        backing.map["last_sync_at"] = "-4"
        assertNull(SyncStatusStore(backing).status.value.lastSyncEpochMillis)
    }

    @Test
    fun `broken storage never throws and still reports this process's value`() {
        val backing = MapSecureStore().apply {
            failGet = true
            failPut = { true }
        }
        val store = SyncStatusStore(backing)
        assertNull(store.status.value.lastSyncEpochMillis)
        store.recordSuccess(9L)
        assertEquals(9L, store.status.value.lastSyncEpochMillis)
        store.clear()
        assertNull(store.status.value.lastSyncEpochMillis)
    }
}
