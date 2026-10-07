package app.familysafe.child.ui.enrollment

import androidx.lifecycle.ViewModel
import app.familysafe.child.data.EnrollmentRepository
import app.familysafe.child.domain.DeviceInfo
import app.familysafe.child.domain.DeviceInfoProvider
import app.familysafe.child.domain.EnrollmentResult
import kotlinx.coroutines.CoroutineScope
import kotlinx.coroutines.flow.MutableStateFlow
import kotlinx.coroutines.flow.StateFlow
import kotlinx.coroutines.flow.asStateFlow
import kotlinx.coroutines.flow.update
import kotlinx.coroutines.launch

/**
 * The redeem call runs in [appScope] (application lifetime), NOT in `viewModelScope`: if the child leaves the screen
 * while the request is in flight, cancelling it could spend the pairing code on the server without ever saving the
 * credentials. The repository saves them regardless, then [onEnrolled] refreshes the app-wide state.
 */
class EnrollmentViewModel(
    private val repository: EnrollmentRepository,
    deviceInfoProvider: DeviceInfoProvider,
    private val appScope: CoroutineScope,
    private val onEnrolled: () -> Unit,
) : ViewModel() {
    private val deviceInfo: DeviceInfo = deviceInfoProvider.current()

    private val _state = MutableStateFlow(EnrollmentUiState(deviceName = deviceInfo.name))
    val state: StateFlow<EnrollmentUiState> = _state.asStateFlow()

    /** What a parent will be able to see after pairing; shown before the child presses Connect. */
    val sharedDeviceInfo: DeviceInfo get() = deviceInfo

    fun onCodeChange(raw: String) = _state.update { it.withCodeInput(raw) }

    fun onDeviceNameChange(raw: String) = _state.update { it.withDeviceName(raw) }

    fun onConnect() {
        val current = _state.value
        if (current.submitting) return
        current.validationFailure()?.let { problem ->
            _state.update { it.copy(failure = problem) }
            return
        }
        _state.update { it.submitting() }
        val code = current.codeText
        val device = deviceInfo.copy(name = current.deviceName)
        appScope.launch {
            val result = repository.enroll(code, device)
            if (result is EnrollmentResult.Enrolled) onEnrolled()
            _state.update { it.finished(result) }
        }
    }
}
