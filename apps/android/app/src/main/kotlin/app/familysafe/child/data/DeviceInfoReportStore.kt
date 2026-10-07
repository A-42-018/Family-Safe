package app.familysafe.child.data

import app.familysafe.child.domain.DeviceInfoReport
import app.familysafe.child.domain.DeviceInfoReportCodec
import kotlinx.coroutines.flow.MutableStateFlow
import kotlinx.coroutines.flow.StateFlow
import kotlinx.coroutines.flow.asStateFlow

/**
 * The last device details the server acknowledged (and when), as shown on the Device status screen so the child
 * sees exactly what was shared. Kept as one string in [SecureStore] so a restart cannot leave half a report.
 * Unreadable, broken or tampered storage reads as "nothing sent yet" — the screen then says so.
 */
class DeviceInfoReportStore(private val store: SecureStore) {
    private val _report = MutableStateFlow(read())
    val report: StateFlow<DeviceInfoReport?> = _report.asStateFlow()

    fun record(report: DeviceInfoReport) {
        _report.value = report
        try {
            store.put(KEY_REPORT, DeviceInfoReportCodec.encode(report))
        } catch (_: Exception) {
            // The in-memory value is still right for this process.
        }
    }

    /** New enrollment or lost connection: details sent to another pairing must not be shown as shared now. */
    fun clear() {
        _report.value = null
        try {
            store.remove(KEY_REPORT)
        } catch (_: Exception) {
            // Nothing more to do; the flow already says "nothing sent".
        }
    }

    private fun read(): DeviceInfoReport? = try {
        DeviceInfoReportCodec.decode(store.get(KEY_REPORT))
    } catch (_: Exception) {
        null
    }

    private companion object {
        const val KEY_REPORT = "device_info_report"
    }
}
