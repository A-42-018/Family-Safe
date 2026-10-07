package app.familysafe.child.ui.limit

import androidx.activity.compose.BackHandler
import androidx.compose.material3.Button
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.Text
import androidx.compose.runtime.Composable
import androidx.compose.ui.res.stringResource
import app.familysafe.child.R
import app.familysafe.child.domain.ActiveWindow
import app.familysafe.child.ui.common.ScreenBody
import app.familysafe.child.ui.common.ScreenScaffold
import app.familysafe.child.ui.devicestatus.ScheduleFormat

/**
 * Full-screen notice shown on top of the app while one of the parent's schedules is in force. It names the window,
 * says when it ends and, plainly, that this app cannot lock the phone. The child can put it away (button or Back);
 * it comes back on the next day or when the parent changes that window.
 */
@Composable
fun QuietTimeScreen(active: ActiveWindow, onDismiss: () -> Unit) {
    BackHandler(onBack = onDismiss)
    val window = active.window
    ScreenScaffold(stringResource(ScheduleFormat.typeTitle(window.type)), onBack = null) { padding ->
        ScreenBody(padding) {
            Text(
                stringResource(
                    R.string.quiet_body,
                    window.name,
                    ScheduleFormat.clock(window.startMinute),
                    ScheduleFormat.clock(window.endMinute),
                ),
                style = MaterialTheme.typography.bodyLarge,
            )
            Text(stringResource(R.string.quiet_cannot_lock), style = MaterialTheme.typography.bodyMedium)
            Button(onClick = onDismiss) { Text(stringResource(R.string.quiet_dismiss)) }
        }
    }
}
