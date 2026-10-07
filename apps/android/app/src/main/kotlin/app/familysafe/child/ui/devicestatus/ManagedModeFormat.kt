package app.familysafe.child.ui.devicestatus

import app.familysafe.child.R
import app.familysafe.child.domain.SuspendReason

/** Plain-words helpers for managed mode, so the Compose code only looks the text up. */
object ManagedModeFormat {
    fun reasonText(reason: SuspendReason): Int = when (reason) {
        SuspendReason.APP_BLOCKED -> R.string.managed_reason_blocked
        SuspendReason.APP_LIMIT -> R.string.managed_reason_app_limit
        SuspendReason.DAILY_LIMIT -> R.string.managed_reason_daily_limit
        SuspendReason.SCHEDULE -> R.string.managed_reason_schedule
    }
}
