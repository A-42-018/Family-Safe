package app.familysafe.child.ui.devicestatus

import app.familysafe.child.domain.BedtimeWindow
import app.familysafe.child.domain.ScreenTimeConfig
import java.util.Locale
import org.junit.jupiter.api.Assertions.assertEquals
import org.junit.jupiter.api.Test

class ScreenTimeFormatTest {
    private fun config(limit: Int?, overrides: Map<Int, Int> = emptyMap()) =
        ScreenTimeConfig.validated(2, limit, overrides, null, false)!!

    @Test
    fun `without overrides there is one every-day line`() {
        assertEquals(listOf(DayLimitLine(null, 90)), ScreenTimeFormat.plan(config(90), Locale.ENGLISH))
        assertEquals(listOf(DayLimitLine(null, null)), ScreenTimeFormat.plan(config(null), Locale.ENGLISH))
        assertEquals(listOf(DayLimitLine(null, 0)), ScreenTimeFormat.plan(config(0), Locale.ENGLISH))
    }

    @Test
    fun `with overrides there are seven lines Monday to Sunday carrying the effective limit`() {
        val lines = ScreenTimeFormat.plan(config(60, mapOf(6 to 180, 7 to 0)), Locale.ENGLISH)
        assertEquals(
            listOf(
                DayLimitLine("Monday", 60),
                DayLimitLine("Tuesday", 60),
                DayLimitLine("Wednesday", 60),
                DayLimitLine("Thursday", 60),
                DayLimitLine("Friday", 60),
                DayLimitLine("Saturday", 180),
                DayLimitLine("Sunday", 0),
            ),
            lines,
        )
    }

    @Test
    fun `a default of none with one override shows no limit on the other days`() {
        val lines = ScreenTimeFormat.plan(config(null, mapOf(2 to 45)), Locale.ENGLISH)
        assertEquals(DayLimitLine("Monday", null), lines[0])
        assertEquals(DayLimitLine("Tuesday", 45), lines[1])
        assertEquals(7, lines.size)
    }

    @Test
    fun `bedtime window is not part of the day plan`() {
        val withBedtime = ScreenTimeConfig.validated(2, 60, emptyMap(), BedtimeWindow("21:00", "07:00"), true)!!
        assertEquals(listOf(DayLimitLine(null, 60)), ScreenTimeFormat.plan(withBedtime, Locale.ENGLISH))
    }
}
