package app.familysafe.child.ui.devicestatus

import app.familysafe.child.R
import app.familysafe.child.domain.AppRuleInactiveReason
import app.familysafe.child.domain.AppRuleLevel

/** Which plain-words line goes with an app-rule state, so the Compose code only looks the text up. */
object AppRuleStatusFormat {
    fun inactiveMessage(reason: AppRuleInactiveReason): Int = when (reason) {
        AppRuleInactiveReason.NO_RULES -> R.string.app_rules_inactive_no_rules
        AppRuleInactiveReason.RULES_EXPIRED -> R.string.app_rules_inactive_expired
        AppRuleInactiveReason.NO_APP_RULES -> R.string.app_rules_inactive_none
        AppRuleInactiveReason.NO_USAGE_ACCESS -> R.string.app_rules_inactive_no_usage_access
        AppRuleInactiveReason.CANNOT_READ_USAGE -> R.string.app_rules_inactive_cannot_read
    }

    fun levelMessage(level: AppRuleLevel): Int = when (level) {
        AppRuleLevel.ALLOW -> R.string.app_rules_level_allow
        AppRuleLevel.WARN -> R.string.app_rules_level_warn
        AppRuleLevel.LIMIT -> R.string.app_rules_level_limit
        AppRuleLevel.BLOCKED -> R.string.app_rules_level_blocked
    }
}
