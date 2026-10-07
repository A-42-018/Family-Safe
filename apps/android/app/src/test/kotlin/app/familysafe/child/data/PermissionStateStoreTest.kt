package app.familysafe.child.data

import app.familysafe.child.domain.PermissionCatalog
import app.familysafe.child.domain.PermissionKey
import app.familysafe.child.domain.PermissionObservation
import app.familysafe.child.domain.PermissionState
import app.familysafe.child.domain.PermissionSyncReport
import app.familysafe.child.testutil.MapSecureStore
import org.junit.jupiter.api.Assertions.assertEquals
import org.junit.jupiter.api.Assertions.assertNull
import org.junit.jupiter.api.Assertions.assertTrue
import org.junit.jupiter.api.Test

class PermissionStateStoreTest {
    private fun observation(state: PermissionState) =
        PermissionObservation.create(PermissionCatalog.SYNCED.associateWith { state })!!

    @Test
    fun `starts with everything not requested and nothing shared`() {
        val snap = PermissionStateStore(MapSecureStore()).snapshot.value
        assertTrue(snap.entries.all { it.state == PermissionState.NOT_REQUESTED })
        assertNull(snap.sharedAtEpochMillis)
    }

    @Test
    fun `observe shows the reading without claiming it was shared`() {
        val store = PermissionStateStore(MapSecureStore())
        store.observe(observation(PermissionState.GRANTED))
        val snap = store.snapshot.value
        assertEquals(PermissionState.GRANTED, snap.entries.first { it.key == PermissionKey.CAMERA }.state)
        assertNull(snap.sharedAtEpochMillis)
        assertNull(store.lastReport())
    }

    @Test
    fun `an acknowledged report survives a restart in one key`() {
        val backing = MapSecureStore()
        PermissionStateStore(backing).recordAcknowledged(PermissionSyncReport(observation(PermissionState.DENIED), 55L))
        assertEquals(listOf("permission_sync_report"), backing.putKeys)
        val reopened = PermissionStateStore(backing)
        assertEquals(55L, reopened.snapshot.value.sharedAtEpochMillis)
        assertEquals(observation(PermissionState.DENIED), reopened.lastReport()!!.observation)
    }

    @Test
    fun `clear forgets the report in memory and in storage but keeps the current reading`() {
        val backing = MapSecureStore()
        val store = PermissionStateStore(backing)
        store.observe(observation(PermissionState.GRANTED))
        store.recordAcknowledged(PermissionSyncReport(observation(PermissionState.GRANTED), 55L))
        store.clearReport()
        assertNull(store.lastReport())
        assertNull(store.snapshot.value.sharedAtEpochMillis)
        assertNull(PermissionStateStore(backing).lastReport())
        val camera = store.snapshot.value.entries.first { it.key == PermissionKey.CAMERA }
        assertEquals(PermissionState.GRANTED, camera.state)
    }

    @Test
    fun `junk or tampered storage reads as nothing shared`() {
        val backing = MapSecureStore()
        for (junk in listOf("yesterday", "5;GRANTED", "0;" + List(8) { "GRANTED" }.joinToString(","))) {
            backing.map["permission_sync_report"] = junk
            assertNull(PermissionStateStore(backing).lastReport(), junk)
        }
        backing.failGet = true
        assertNull(PermissionStateStore(backing).lastReport())
    }

    @Test
    fun `a failed write keeps the acknowledged report for this process`() {
        val backing = MapSecureStore().apply { failPut = { true } }
        val store = PermissionStateStore(backing)
        store.recordAcknowledged(PermissionSyncReport(observation(PermissionState.GRANTED), 5L))
        assertEquals(5L, store.snapshot.value.sharedAtEpochMillis)
    }
}
