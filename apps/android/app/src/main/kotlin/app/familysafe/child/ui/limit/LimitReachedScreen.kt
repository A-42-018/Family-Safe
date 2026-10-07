package app.familysafe.child.ui.limit

import androidx.activity.compose.BackHandler
import androidx.compose.material3.Button
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.Text
import androidx.compose.runtime.Composable
import androidx.compose.ui.res.stringResource
import app.familysafe.child.R
import app.familysafe.child.domain.ScreenTimeEvaluation
import app.familysafe.child.ui.common.ScreenBody
import app.familysafe.child.ui.common.ScreenScaffold
import app.familysafe.child.ui.common.minutesText

/**
 * Full-screen notice shown on top of the app when today's limit is reached. It says what the limit is, what was
 * used and, plainly, that this app cannot lock the phone. The child can put it away (button or Back); it comes back
 * on the next day or when the parent changes the limit and it is reached again.
 */
@Composable
fun LimitReachedScreen(evaluation: ScreenTimeEvaluation, onDismiss: () -> Unit) {
    BackHandler(onBack = onDismiss)
    ScreenScaffold(stringResource(R.string.limit_reached_title), onBack = null) { padding ->
        ScreenBody(padding) {
            Text(
                text = if (evaluation.noScreenTimeToday) {
                    stringResource(R.string.limit_reached_body_none)
                } else {
                    stringResource(
                        R.string.limit_reached_body,
                        minutesText(evaluation.limitMinutes),
                        minutesText(evaluation.usedMinutes),
                    )
                },
                style = MaterialTheme.typography.bodyLarge,
            )
            Text(stringResource(R.string.limit_reached_cannot_lock), style = MaterialTheme.typography.bodyMedium)
            Text(stringResource(R.string.limit_reached_parent_told), style = MaterialTheme.typography.bodyMedium)
            Button(onClick = onDismiss) { Text(stringResource(R.string.limit_reached_dismiss)) }
        }
    }
}
