package app.familysafe.child.ui.syncstatus

import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.Text
import androidx.compose.runtime.Composable
import androidx.compose.ui.res.stringResource
import app.familysafe.child.R
import app.familysafe.child.domain.DeviceAuthState
import app.familysafe.child.domain.SyncStatus
import app.familysafe.child.ui.common.DisconnectedNotice
import app.familysafe.child.ui.common.ScreenBody
import app.familysafe.child.ui.common.ScreenScaffold
import java.text.DateFormat
import java.util.Date

@Composable
fun SyncStatusScreen(isEnrolled: Boolean, auth: DeviceAuthState, sync: SyncStatus, onBack: () -> Unit) {
    ScreenScaffold(stringResource(R.string.title_sync_status), onBack) { padding ->
        ScreenBody(padding) {
            if (!isEnrolled && auth.isDisconnected) DisconnectedNotice(auth)
            Text(
                stringResource(if (isEnrolled) R.string.sync_status_body_enrolled else R.string.sync_status_body),
                style = MaterialTheme.typography.bodyMedium,
            )
            if (isEnrolled) {
                Text(stringResource(R.string.sync_status_what_is_sent), style = MaterialTheme.typography.bodyMedium)
                Text(stringResource(R.string.sync_status_permissions_sent), style = MaterialTheme.typography.bodyMedium)
            }
            Text(lastSyncText(isEnrolled, sync), style = MaterialTheme.typography.labelLarge)
        }
    }
}

@Composable
private fun lastSyncText(isEnrolled: Boolean, sync: SyncStatus): String {
    val millis = sync.lastSyncEpochMillis
    return if (isEnrolled && millis != null) {
        stringResource(
            R.string.sync_status_last_sync_at,
            DateFormat.getDateTimeInstance(DateFormat.MEDIUM, DateFormat.SHORT).format(Date(millis)),
        )
    } else {
        stringResource(R.string.sync_status_last_sync)
    }
}
