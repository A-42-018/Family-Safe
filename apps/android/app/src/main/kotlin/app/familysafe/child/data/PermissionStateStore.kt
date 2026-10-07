package app.familysafe.child.data

import app.familysafe.child.domain.PermissionObservation
import app.familysafe.child.domain.PermissionSnapshot
import app.familysafe.child.domain.PermissionSyncReport
import app.familysafe.child.domain.PermissionSyncReportCodec
import kotlinx.coroutines.flow.MutableStateFlow
import kotlinx.coroutines.flow.StateFlow
import kotlinx.coroutines.flow.asStateFlow

/**
 * What the Permissions screen shows: the latest OS reading (memory only, re-read on every resume) and the last
 * state the server acknowledged (one string in [SecureStore], so a restart cannot leave half a report).
 * Unreadable, broken or tampered storage reads as "nothing shared yet" — the screen then says so.
 */
class PermissionStateStore(private val store: SecureStore) {
    private var current: PermissionObservation? = null
    private var report: PermissionSyncReport? = read()
    private val _snapshot = MutableStateFlow(PermissionSnapshot.of(current, report))
    val snapshot: StateFlow<PermissionSnapshot> = _snapshot.asStateFlow()

    @Synchronized
    fun lastReport(): PermissionSyncReport? = report

    /** A fresh OS reading (not necessarily shared yet). */
    @Synchronized
    fun observe(observation: PermissionObservation) {
        current = observation
        publish()
    }

    /** The server acknowledged exactly [acknowledged]; persisted before it is shown as shared. */
    @Synchronized
    fun recordAcknowledged(acknowledged: PermissionSyncReport) {
        report = acknowledged
        try {
            store.put(KEY_REPORT, PermissionSyncReportCodec.encode(acknowledged))
        } catch (_: Exception) {
            // The in-memory value is still right for this process.
        }
        publish()
    }

    /** New enrollment or lost connection: states sent to another pairing must not be shown as shared now. */
    @Synchronized
    fun clearReport() {
        report = null
        try {
            store.remove(KEY_REPORT)
        } catch (_: Exception) {
            // Nothing more to do; the flow already says "not shared".
        }
        publish()
    }

    private fun publish() {
        _snapshot.value = PermissionSnapshot.of(current, report)
    }

    private fun read(): PermissionSyncReport? = try {
        PermissionSyncReportCodec.decode(store.get(KEY_REPORT))
    } catch (_: Exception) {
        null
    }

    private companion object {
        const val KEY_REPORT = "permission_sync_report"
    }
}
