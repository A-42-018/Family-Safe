package app.familysafe.child.data

import app.familysafe.child.domain.AppRuleStatus
import kotlinx.coroutines.flow.MutableStateFlow
import kotlinx.coroutines.flow.StateFlow
import kotlinx.coroutines.flow.asStateFlow

/**
 * The latest app-rule check result, in memory only. It is derived on this device from the cached rules and the
 * local usage numbers, and it is never written to storage and never sent anywhere (only the separate attempt
 * outbox, which holds package names and times of blocked apps that were opened, leaves the device).
 */
class AppRuleStatusStore {
    private val state = MutableStateFlow<AppRuleStatus>(AppRuleStatus.Unchecked)
    val status: StateFlow<AppRuleStatus> = state.asStateFlow()

    fun record(status: AppRuleStatus) {
        state.value = status
    }

    fun clear() {
        state.value = AppRuleStatus.Unchecked
    }
}
