package app.familysafe.child.data

import app.familysafe.child.domain.UsageAccess
import app.familysafe.child.domain.UsageAccessProbe
import kotlinx.coroutines.flow.MutableStateFlow
import kotlinx.coroutines.flow.StateFlow
import kotlinx.coroutines.flow.asStateFlow

/**
 * The latest Usage Access reading, for the Permissions screen. Memory only: the OS is the source of truth and is
 * re-read on every app resume (no prompt), so the screen is right when the child comes back from settings.
 */
class UsageAccessStore(private val probe: UsageAccessProbe) {
    private val _state = MutableStateFlow(UsageAccess.UNKNOWN)
    val state: StateFlow<UsageAccess> = _state.asStateFlow()

    /** Reads the OS again and returns the new value. A failing probe reads as [UsageAccess.UNKNOWN]. */
    fun refresh(): UsageAccess {
        val now = try {
            probe.state()
        } catch (_: Exception) {
            UsageAccess.UNKNOWN
        }
        _state.value = now
        return now
    }
}
