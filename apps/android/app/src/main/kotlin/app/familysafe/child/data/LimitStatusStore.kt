package app.familysafe.child.data

import app.familysafe.child.domain.LimitStatus
import kotlinx.coroutines.flow.MutableStateFlow
import kotlinx.coroutines.flow.StateFlow
import kotlinx.coroutines.flow.asStateFlow

/**
 * The latest limit-check result, in memory only. It is derived on this device from the cached rules and the local
 * usage numbers, and it is never written to storage and never sent anywhere (there is no endpoint for it yet).
 */
class LimitStatusStore {
    private val state = MutableStateFlow<LimitStatus>(LimitStatus.Unchecked)
    val status: StateFlow<LimitStatus> = state.asStateFlow()

    fun record(status: LimitStatus) {
        state.value = status
    }

    fun clear() {
        state.value = LimitStatus.Unchecked
    }
}
