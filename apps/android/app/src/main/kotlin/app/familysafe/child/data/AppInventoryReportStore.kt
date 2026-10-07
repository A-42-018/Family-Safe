package app.familysafe.child.data

import app.familysafe.child.domain.AppInventoryReport
import app.familysafe.child.domain.AppInventoryReportCodec
import kotlinx.coroutines.flow.MutableStateFlow
import kotlinx.coroutines.flow.StateFlow
import kotlinx.coroutines.flow.asStateFlow

/**
 * The last app list the server acknowledged (and when), as shown on the Device status screen so the child sees
 * exactly which apps the parent can see. Kept as one string in [SecureStore] so a restart cannot leave half a
 * report. Unreadable, broken or tampered storage reads as "nothing sent yet" — the screen then says so.
 */
class AppInventoryReportStore(private val store: SecureStore) {
    private val _report = MutableStateFlow(read())
    val report: StateFlow<AppInventoryReport?> = _report.asStateFlow()

    fun record(report: AppInventoryReport) {
        _report.value = report
        try {
            store.put(KEY_REPORT, AppInventoryReportCodec.encode(report))
        } catch (_: Exception) {
            // The in-memory value is still right for this process.
        }
    }

    /** New enrollment or lost connection: a list sent to another pairing must not be shown as shared now. */
    fun clear() {
        _report.value = null
        try {
            store.remove(KEY_REPORT)
        } catch (_: Exception) {
            // Nothing more to do; the flow already says "nothing sent".
        }
    }

    private fun read(): AppInventoryReport? = try {
        AppInventoryReportCodec.decode(store.get(KEY_REPORT))
    } catch (_: Exception) {
        null
    }

    private companion object {
        const val KEY_REPORT = "app_inventory_report"
    }
}
