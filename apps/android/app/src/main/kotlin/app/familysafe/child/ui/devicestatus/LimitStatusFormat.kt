package app.familysafe.child.ui.devicestatus

import app.familysafe.child.R
import app.familysafe.child.domain.LimitInactiveReason
import app.familysafe.child.domain.LimitLevel

/** Which plain-words line goes with a limit state, so the Compose code only looks the text up. */
object LimitStatusFormat {
    fun inactiveMessage(reason: LimitInactiveReason): Int = when (reason) {
        LimitInactiveReason.NO_RULES -> R.string.limit_inactive_no_rules
        LimitInactiveReason.RULES_EXPIRED -> R.string.limit_inactive_expired
        LimitInactiveReason.NO_LIMIT_TODAY -> R.string.limit_inactive_no_limit_today
        LimitInactiveReason.NO_USAGE_ACCESS -> R.string.limit_inactive_no_usage_access
        LimitInactiveReason.CANNOT_READ_USAGE -> R.string.limit_inactive_cannot_read
    }

    fun levelMessage(level: LimitLevel): Int = when (level) {
        LimitLevel.ALLOW -> R.string.limit_level_allow
        LimitLevel.WARN -> R.string.limit_level_warn
        LimitLevel.LIMIT -> R.string.limit_level_limit
    }
}
