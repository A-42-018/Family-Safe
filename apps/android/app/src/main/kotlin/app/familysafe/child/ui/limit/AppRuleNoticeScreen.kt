package app.familysafe.child.ui.limit

import androidx.activity.compose.BackHandler
import androidx.compose.material3.Button
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.Text
import androidx.compose.runtime.Composable
import androidx.compose.ui.res.stringResource
import app.familysafe.child.R
import app.familysafe.child.domain.AppRuleLevel
import app.familysafe.child.domain.AppRuleNotice
import app.familysafe.child.ui.common.ScreenBody
import app.familysafe.child.ui.common.ScreenScaffold
import app.familysafe.child.ui.common.minutesText

/**
 * Full-screen notice shown on top of this app when a restricted app was opened today and has reached its rule.
 * It names the app, says what the rule is and, plainly, that this app cannot close the other app. The child can put
 * it away (button or Back); it comes back on a new day or when the parent changes the rule.
 */
@Composable
fun AppRuleNoticeScreen(notice: AppRuleNotice, appLabel: String, onDismiss: () -> Unit) {
    BackHandler(onBack = onDismiss)
    val blocked = notice.level == AppRuleLevel.BLOCKED
    ScreenScaffold(
        stringResource(if (blocked) R.string.app_rule_notice_title_blocked else R.string.app_rule_notice_title_limit),
        onBack = null,
    ) { padding ->
        ScreenBody(padding) {
            Text(
                text = when {
                    blocked -> stringResource(R.string.app_rule_notice_body_blocked, appLabel)
                    notice.limitMinutes == 0 -> stringResource(R.string.app_rule_notice_body_none, appLabel)
                    else -> stringResource(
                        R.string.app_rule_notice_body_limit,
                        appLabel,
                        minutesText(notice.limitMinutes ?: 0),
                        minutesText(notice.usedMinutes),
                    )
                },
                style = MaterialTheme.typography.bodyLarge,
            )
            if (blocked) {
                Text(stringResource(R.string.app_rule_notice_reported), style = MaterialTheme.typography.bodyMedium)
            }
            Text(
                stringResource(R.string.app_rule_notice_cannot_close, appLabel),
                style = MaterialTheme.typography.bodyMedium,
            )
            Button(onClick = onDismiss) { Text(stringResource(R.string.app_rule_notice_dismiss)) }
        }
    }
}
