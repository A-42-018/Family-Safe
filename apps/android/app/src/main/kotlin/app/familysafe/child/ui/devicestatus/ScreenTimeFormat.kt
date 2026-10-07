package app.familysafe.child.ui.devicestatus

import app.familysafe.child.domain.ScreenTimeConfig
import java.time.DayOfWeek
import java.time.format.TextStyle
import java.util.Locale

/** One line of the weekly plan: [dayName] null = "every day". [minutes] null = no limit. */
class DayLimitLine(val dayName: String?, val minutes: Int?) {
    override fun equals(other: Any?): Boolean =
        other is DayLimitLine && other.dayName == dayName && other.minutes == minutes

    override fun hashCode(): Int = 31 * (dayName?.hashCode() ?: 0) + (minutes ?: -1)

    override fun toString(): String = "DayLimitLine"
}

/** Pure rules for the "rules from your parent" list, so the Compose code only prints what this returns. */
object ScreenTimeFormat {
    /** No per-day overrides: one "every day" line. Otherwise seven lines Monday to Sunday with the effective limit. */
    fun plan(config: ScreenTimeConfig, locale: Locale = Locale.getDefault()): List<DayLimitLine> {
        if (config.dayOverrides.isEmpty()) return listOf(DayLimitLine(null, config.dailyLimitMinutes))
        return (1..ScreenTimeConfig.ISO_WEEKDAYS).map { day ->
            DayLimitLine(DayOfWeek.of(day).getDisplayName(TextStyle.FULL, locale), config.limitFor(day))
        }
    }
}
