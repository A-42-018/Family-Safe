package app.familysafe.child.ui.enrollment

import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.size
import androidx.compose.foundation.text.KeyboardActions
import androidx.compose.foundation.text.KeyboardOptions
import androidx.compose.material3.Button
import androidx.compose.material3.CircularProgressIndicator
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.OutlinedTextField
import androidx.compose.material3.Text
import androidx.compose.runtime.Composable
import androidx.compose.runtime.getValue
import androidx.compose.ui.Modifier
import androidx.compose.ui.res.stringResource
import androidx.compose.ui.semantics.LiveRegionMode
import androidx.compose.ui.semantics.liveRegion
import androidx.compose.ui.semantics.semantics
import androidx.compose.ui.text.input.ImeAction
import androidx.compose.ui.text.input.KeyboardCapitalization
import androidx.compose.ui.text.input.KeyboardType
import androidx.compose.ui.unit.dp
import androidx.lifecycle.compose.collectAsStateWithLifecycle
import app.familysafe.child.R
import app.familysafe.child.domain.DeviceAuthState
import app.familysafe.child.domain.DeviceInfo
import app.familysafe.child.ui.common.DisconnectedNotice
import app.familysafe.child.ui.common.NotEnrolledNotice
import app.familysafe.child.ui.common.ScreenBody
import app.familysafe.child.ui.common.ScreenScaffold

@Composable
fun EnrollmentScreen(viewModel: EnrollmentViewModel, auth: DeviceAuthState, onBack: () -> Unit) {
    val state by viewModel.state.collectAsStateWithLifecycle()
    EnrollmentContent(
        state = state,
        auth = auth,
        shared = viewModel.sharedDeviceInfo,
        onCodeChange = viewModel::onCodeChange,
        onDeviceNameChange = viewModel::onDeviceNameChange,
        onConnect = viewModel::onConnect,
        onBack = onBack,
    )
}

@Composable
fun EnrollmentContent(
    state: EnrollmentUiState,
    auth: DeviceAuthState,
    shared: DeviceInfo,
    onCodeChange: (String) -> Unit,
    onDeviceNameChange: (String) -> Unit,
    onConnect: () -> Unit,
    onBack: () -> Unit,
) {
    ScreenScaffold(stringResource(R.string.title_enrollment), onBack) { padding ->
        ScreenBody(padding) {
            if (auth.isDisconnected) DisconnectedNotice(auth) else NotEnrolledNotice()
            Text(stringResource(R.string.enrollment_body), style = MaterialTheme.typography.bodyMedium)

            OutlinedTextField(
                value = state.codeText,
                onValueChange = onCodeChange,
                modifier = Modifier.fillMaxWidth(),
                label = { Text(stringResource(R.string.enrollment_code_label)) },
                placeholder = { Text(stringResource(R.string.enrollment_code_placeholder)) },
                singleLine = true,
                enabled = !state.submitting,
                keyboardOptions = KeyboardOptions(
                    capitalization = KeyboardCapitalization.Characters,
                    autoCorrectEnabled = false,
                    keyboardType = KeyboardType.Ascii,
                    imeAction = ImeAction.Next,
                ),
            )
            OutlinedTextField(
                value = state.deviceName,
                onValueChange = onDeviceNameChange,
                modifier = Modifier.fillMaxWidth(),
                label = { Text(stringResource(R.string.enrollment_name_label)) },
                supportingText = { Text(stringResource(R.string.enrollment_name_hint)) },
                singleLine = true,
                enabled = !state.submitting,
                keyboardOptions = KeyboardOptions(imeAction = ImeAction.Done),
                keyboardActions = KeyboardActions(onDone = { if (state.canSubmit) onConnect() }),
            )

            Text(stringResource(R.string.enrollment_confirm_header), style = MaterialTheme.typography.titleSmall)
            Text(
                stringResource(
                    R.string.enrollment_confirm_shared,
                    shared.manufacturer.orEmpty(),
                    shared.model.orEmpty(),
                    shared.androidVersion.orEmpty(),
                    shared.appVersion.orEmpty(),
                ),
            )
            Text(stringResource(R.string.enrollment_confirm_not_shared))

            Button(onClick = onConnect, enabled = state.canSubmit, modifier = Modifier.fillMaxWidth()) {
                if (state.submitting) {
                    CircularProgressIndicator(strokeWidth = 2.dp, modifier = Modifier.size(20.dp))
                } else {
                    Text(stringResource(R.string.enrollment_connect))
                }
            }

            state.failure?.let { failure ->
                Text(
                    text = stringResource(EnrollmentMessages.of(failure)),
                    color = MaterialTheme.colorScheme.error,
                    modifier = Modifier.semantics { liveRegion = LiveRegionMode.Assertive },
                )
                if (failure.mayNeedParentRevoke) Text(stringResource(R.string.enrollment_error_parent_revoke))
            }
        }
    }
}

@Composable
fun EnrolledScreen(onBack: () -> Unit) {
    ScreenScaffold(stringResource(R.string.title_enrollment), onBack) { padding ->
        ScreenBody(padding) {
            Text(stringResource(R.string.enrolled_title), style = MaterialTheme.typography.titleMedium)
            Text(stringResource(R.string.enrolled_body), style = MaterialTheme.typography.bodyMedium)
            Text(stringResource(R.string.enrolled_removal), style = MaterialTheme.typography.bodyMedium)
        }
    }
}
