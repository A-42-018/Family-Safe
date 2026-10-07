package app.familysafe.child.ui.devicestatus

import app.familysafe.child.R
import app.familysafe.child.domain.ScheduleInactiveReason
import app.familysafe.child.domain.ScheduleLimits
import app.familysafe.child.domain.ScheduleType
import java.time.DayOfWeek
import java.time.format.TextStyle
import java.util.Locale

/** Plain-words helpers for schedules, so the Compose code only looks the text up. */
object ScheduleFormat {
    fun typeTitle(type: ScheduleType): Int = when (type) {
        ScheduleType.BEDTIME -> R.string.schedule_type_bedtime
        ScheduleType.SCHOOL -> R.string.schedule_type_school
        ScheduleType.CUSTOM -> R.string.schedule_type_custom
    }

    fun inactiveMessage(reason: ScheduleInactiveReason): Int = when (reason) {
        ScheduleInactiveReason.NO_RULES -> R.string.schedules_inactive_no_rules
        ScheduleInactiveReason.RULES_EXPIRED -> R.string.schedules_inactive_expired
        ScheduleInactiveReason.NO_SCHEDULES -> R.string.schedules_inactive_none
    }

    fun isEveryDay(days: List<Int>): Boolean = days.size == ScheduleLimits.ISO_WEEKDAYS

    /** `Mon, Tue` in the phone's language; days are the ascending ISO weekdays the window starts on. */
    fun daysText(days: List<Int>, locale: Locale = Locale.getDefault()): String =
        days.joinToString(", ") { DayOfWeek.of(it).getDisplayName(TextStyle.SHORT, locale) }

    /** `21:30`, always 24-hour and ASCII digits so it matches what the parent typed. */
    fun clock(minuteOfDay: Int): String = String.format(Locale.ROOT, "%02d:%02d", minuteOfDay / 60, minuteOfDay % 60)
}
