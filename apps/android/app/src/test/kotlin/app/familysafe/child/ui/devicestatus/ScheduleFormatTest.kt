package app.familysafe.child.ui.devicestatus

import app.familysafe.child.domain.ScheduleInactiveReason
import app.familysafe.child.domain.ScheduleType
import java.util.Locale
import org.junit.jupiter.api.Assertions.assertEquals
import org.junit.jupiter.api.Assertions.assertFalse
import org.junit.jupiter.api.Assertions.assertNotEquals
import org.junit.jupiter.api.Assertions.assertTrue
import org.junit.jupiter.api.Test

class ScheduleFormatTest {
    @Test
    fun `clock is 24-hour with ASCII digits in any locale`() {
        val saved = Locale.getDefault()
        try {
            Locale.setDefault(Locale.forLanguageTag("bn-BD-u-nu-beng"))
            assertEquals("21:05", ScheduleFormat.clock(21 * 60 + 5))
            assertEquals("00:00", ScheduleFormat.clock(0))
            assertEquals("23:59", ScheduleFormat.clock(23 * 60 + 59))
        } finally {
            Locale.setDefault(saved)
        }
    }

    @Test
    fun `days are short names in the given language and in the order given`() {
        assertEquals("Mon, Tue, Sun", ScheduleFormat.daysText(listOf(1, 2, 7), Locale.ENGLISH))
        assertEquals("lun., mar.", ScheduleFormat.daysText(listOf(1, 2), Locale.FRENCH))
    }

    @Test
    fun `only seven days is every day`() {
        assertTrue(ScheduleFormat.isEveryDay(listOf(1, 2, 3, 4, 5, 6, 7)))
        assertFalse(ScheduleFormat.isEveryDay(listOf(1, 2, 3, 4, 5, 6)))
    }

    @Test
    fun `every type and every inactive reason has its own text`() {
        assertEquals(3, ScheduleType.entries.map { ScheduleFormat.typeTitle(it) }.toSet().size)
        assertEquals(
            ScheduleInactiveReason.entries.size,
            ScheduleInactiveReason.entries.map { ScheduleFormat.inactiveMessage(it) }.toSet().size,
        )
        assertNotEquals(
            ScheduleFormat.typeTitle(ScheduleType.BEDTIME),
            ScheduleFormat.typeTitle(ScheduleType.SCHOOL),
        )
    }
}
