package app.familysafe.child.ui.common

import androidx.compose.runtime.Composable
import androidx.compose.ui.res.stringResource
import app.familysafe.child.R
import app.familysafe.child.domain.UsageDisplay

/** `45` -> "45 min", `125` -> "2 h 5 min". Shared by the rules list, today's limit and the limit-reached screen. */
@Composable
fun minutesText(totalMinutes: Int): String {
    val (hours, minutes) = UsageDisplay.hoursAndMinutes(totalMinutes)
    return if (hours > 0) {
        stringResource(R.string.rules_minutes_hm, hours, minutes)
    } else {
        stringResource(R.string.rules_minutes_m, minutes)
    }
}
