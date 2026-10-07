package app.familysafe.child.domain

import org.junit.jupiter.api.Assertions.assertEquals
import org.junit.jupiter.api.Assertions.assertFalse
import org.junit.jupiter.api.Assertions.assertNotNull
import org.junit.jupiter.api.Assertions.assertNull
import org.junit.jupiter.api.Assertions.assertTrue
import org.junit.jupiter.api.Test

class ScheduleWindowTest {
    private val id1 = "00000000-0000-4000-8000-000000000001"
    private val id2 = "00000000-0000-4000-8000-000000000002"

    private fun make(
        id: String = id1,
        name: String = "Bedtime",
        type: String = "BEDTIME",
        days: List<Int> = listOf(1, 2),
        start: String = "22:00",
        end: String = "07:00",
    ) = ScheduleWindow.validated(id, name, type, days, start, end)

    @Test
    fun `a contract-valid window is accepted and read back`() {
        val w = make()!!
        assertEquals(ScheduleType.BEDTIME, w.type)
        assertEquals(22 * 60, w.startMinute)
        assertEquals(7 * 60, w.endMinute)
        assertTrue(w.isOvernight)
        assertEquals(9 * 60, w.lengthMinutes)
    }

    @Test
    fun `an uppercase id is normalised to lowercase`() {
        assertEquals(id1, make(id = id1.uppercase())!!.id)
    }

    @Test
    fun `everything off-contract is rejected`() {
        assertNull(make(id = "not-a-uuid"))
        assertNull(make(name = ""))
        assertNull(make(name = " padded"))
        assertNull(make(name = "padded "))
        assertNull(make(name = "bad\u0007name"))
        assertNull(make(name = "x".repeat(ScheduleLimits.NAME_MAX + 1)))
        assertNotNull(make(name = "x".repeat(ScheduleLimits.NAME_MAX)))
        assertNull(make(type = "bedtime"))
        assertNull(make(type = "NAP"))
        assertNull(make(days = emptyList()))
        assertNull(make(days = listOf(0, 1)))
        assertNull(make(days = listOf(1, 8)))
        assertNull(make(days = listOf(2, 1)))
        assertNull(make(days = listOf(1, 1)))
        assertNull(make(days = listOf(1, 2, 3, 4, 5, 6, 7, 7)))
        assertNull(make(start = "24:00"))
        assertNull(make(start = "7:00"))
        assertNull(make(end = "07:60"))
        assertNull(make(end = "07:00:00"))
        assertNull(make(start = "07:00", end = "07:00"))
    }

    @Test
    fun `a day-length window is allowed`() {
        assertEquals(ScheduleLimits.MINUTES_PER_DAY - 1, make(start = "00:00", end = "23:59")!!.lengthMinutes)
        assertEquals(ScheduleLimits.MINUTES_PER_DAY - 1, make(start = "00:01", end = "00:00")!!.lengthMinutes)
    }

    @Test
    fun `week ranges match the contract helper including the Sunday wrap`() {
        val sundayNight = make(days = listOf(7), start = "23:00", end = "06:00")!!
        assertEquals(listOf(6 * 1440 + 23 * 60 to 10_080, 0 to 6 * 60), sundayNight.weekRanges())
        val monday = make(days = listOf(1), start = "08:00", end = "15:00")!!
        assertEquals(listOf(8 * 60 to 15 * 60), monday.weekRanges())
    }

    @Test
    fun `overlap is half open`() {
        val a = make(days = listOf(1), start = "08:00", end = "10:00")!!
        val b = make(id = id2, days = listOf(1), start = "10:00", end = "12:00")!!
        val c = make(id = id2, days = listOf(1), start = "09:59", end = "12:00")!!
        assertFalse(a.overlaps(b))
        assertTrue(a.overlaps(c))
        val night = make(days = listOf(1), start = "22:00", end = "07:00")!!
        val tuesdayMorning = make(id = id2, days = listOf(2), start = "06:00", end = "08:00")!!
        assertTrue(night.overlaps(tuesdayMorning))
        val sundayWrap = make(days = listOf(7), start = "23:00", end = "06:00")!!
        val mondayEarly = make(id = id2, days = listOf(1), start = "05:00", end = "07:00")!!
        assertTrue(sundayWrap.overlaps(mondayEarly))
    }

    @Test
    fun `the list rejects same-type overlap, duplicate ids and too many windows`() {
        val a = make(days = listOf(1), start = "08:00", end = "10:00", type = "CUSTOM")!!
        val overlapSame = make(id = id2, days = listOf(1), start = "09:00", end = "11:00", type = "CUSTOM")!!
        val overlapOther = make(id = id2, days = listOf(1), start = "09:00", end = "11:00", type = "SCHOOL")!!
        assertNull(ScheduleList.validated(listOf(a, overlapSame)))
        assertNotNull(ScheduleList.validated(listOf(a, overlapOther)))
        assertNull(ScheduleList.validated(listOf(a, a)))
        assertEquals(emptyList<ScheduleWindow>(), ScheduleList.validated(emptyList()))

        val many = (1..ScheduleLimits.MAX).map { i ->
            ScheduleWindow.validated(
                "00000000-0000-4000-8000-%012d".format(i),
                "W$i",
                "CUSTOM",
                listOf(1),
                "00:00",
                "00:01",
            )!!
        }
        // Same type and identical times overlap, so only different days keep a full list legal: use one per minute.
        assertNull(ScheduleList.validated(many))
        val spread = (0 until ScheduleLimits.MAX).map { i ->
            val start = "%02d:00".format(i)
            val end = "%02d:30".format(i)
            ScheduleWindow.validated(
                "00000000-0000-4000-8000-%012d".format(i + 1),
                "W$i",
                "CUSTOM",
                listOf(1),
                start,
                end,
            )!!
        }
        assertNotNull(ScheduleList.validated(spread))
        val extra = ScheduleWindow.validated(id2, "Extra", "CUSTOM", listOf(2), "08:00", "09:00")!!
        assertNull(ScheduleList.validated(spread + extra))
    }

    @Test
    fun `toString never prints the parent-typed name or id`() {
        val w = make(name = "Secret nickname")!!
        assertFalse(w.toString().contains("Secret"))
        assertFalse(w.toString().contains(id1))
    }
}
