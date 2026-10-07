package app.familysafe.child.data

import app.familysafe.child.domain.ScheduleStatus
import kotlinx.coroutines.flow.MutableStateFlow
import kotlinx.coroutines.flow.StateFlow
import kotlinx.coroutines.flow.asStateFlow

/**
 * The latest schedule check result, in memory only. It is derived on this device from the cached rules and the
 * clock, and it is never written to storage and never sent anywhere.
 */
class ScheduleStatusStore {
    private val state = MutableStateFlow<ScheduleStatus>(ScheduleStatus.Unchecked)
    val status: StateFlow<ScheduleStatus> = state.asStateFlow()

    fun record(status: ScheduleStatus) {
        state.value = status
    }

    fun clear() {
        state.value = ScheduleStatus.Unchecked
    }
}
