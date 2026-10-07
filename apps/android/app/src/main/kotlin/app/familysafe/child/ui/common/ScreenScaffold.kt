package app.familysafe.child.ui.common

import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.PaddingValues
import androidx.compose.foundation.layout.Spacer
import androidx.compose.foundation.layout.height
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.rememberScrollState
import androidx.compose.foundation.verticalScroll
import androidx.compose.material3.ExperimentalMaterial3Api
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.Scaffold
import androidx.compose.material3.Text
import androidx.compose.material3.TextButton
import androidx.compose.material3.TopAppBar
import androidx.compose.runtime.Composable
import androidx.compose.ui.Modifier
import androidx.compose.ui.res.stringResource
import androidx.compose.ui.semantics.heading
import androidx.compose.ui.semantics.semantics
import androidx.compose.ui.unit.dp
import app.familysafe.child.R
import app.familysafe.child.domain.DeviceAuthState

@OptIn(ExperimentalMaterial3Api::class)
@Composable
fun ScreenScaffold(title: String, onBack: (() -> Unit)?, content: @Composable (PaddingValues) -> Unit) {
    Scaffold(
        topBar = {
            TopAppBar(
                title = { Text(title, modifier = Modifier.semantics { heading() }) },
                navigationIcon = {
                    if (onBack != null) TextButton(onClick = onBack) { Text(stringResource(R.string.action_back)) }
                },
            )
        },
    ) { padding -> content(padding) }
}

/** Scrollable column with standard padding; the common body of every stub screen. */
@Composable
fun ScreenBody(padding: PaddingValues, content: @Composable () -> Unit) {
    Column(
        modifier = Modifier.padding(padding).padding(16.dp).verticalScroll(rememberScrollState()),
        verticalArrangement = Arrangement.spacedBy(12.dp),
    ) {
        content()
        Spacer(Modifier.height(8.dp))
        Text(stringResource(R.string.transparency_note), style = MaterialTheme.typography.bodySmall)
    }
}

/** Shown instead of the plain "not enrolled" text when the connection was lost or ended. */
@Composable
fun DisconnectedNotice(auth: DeviceAuthState) {
    Text(stringResource(R.string.disconnected_title), style = MaterialTheme.typography.titleMedium)
    Text(
        stringResource(
            when (auth) {
                DeviceAuthState.Expired -> R.string.disconnected_body_expired
                DeviceAuthState.Uncertain -> R.string.disconnected_body_uncertain
                else -> R.string.disconnected_body_revoked
            },
        ),
        style = MaterialTheme.typography.bodyMedium,
    )
    Text(stringResource(R.string.disconnected_next_step), style = MaterialTheme.typography.bodyMedium)
}

@Composable
fun NotEnrolledNotice() {
    Text(stringResource(R.string.not_enrolled_title), style = MaterialTheme.typography.titleMedium)
    Text(stringResource(R.string.not_enrolled_body), style = MaterialTheme.typography.bodyMedium)
}
