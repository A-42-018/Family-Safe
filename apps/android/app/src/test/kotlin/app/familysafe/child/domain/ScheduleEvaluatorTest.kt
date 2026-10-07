package app.familysafe.child.domain

import java.time.Instant
import java.time.LocalDate
import java.time.LocalDateTime
import java.time.ZoneId
import org.junit.jupiter.api.Assertions.assertEquals
import org.junit.jupiter.api.Assertions.assertFalse
import org.junit.jupiter.api.Assertions.assertNull
import org.junit.jupiter.api.Assertions.assertTrue
import org.junit.jupiter.api.Test

class ScheduleEvaluatorTest {
    private val utc = ZoneId.of("UTC")
    private val newYork = ZoneId.of("America/New_York")
    private val dhaka = ZoneId.of("Asia/Dhaka")

    private var counter = 0

    private fun window(type: String, days: List<Int>, start: String, end: String): ScheduleWindow {
        counter++
        val id = "00000000-0000-4000-8000-%012d".format(counter)
        return ScheduleWindow.validated(id, "Window $counter", type, days, start, end)!!
    }

    /** Wall-clock `yyyy-MM-ddTHH:mm` in [zone] as an instant. */
    private fun at(zone: ZoneId, local: String): Instant = LocalDateTime.parse(local).atZone(zone).toInstant()

    private fun types(state: ScheduleState) = state.active.map { it.window.type }

    // 2026-10-05 is a Monday.

    @Test
    fun `an empty list is never quiet and has no boundary`() {
        val state = ScheduleEvaluator.evaluate(emptyList(), utc, at(utc, "2026-10-05T12:00"))
        assertFalse(state.isQuiet)
        assertTrue(state.active.isEmpty())
        assertNull(state.nextBoundary)
    }

    @Test
    fun `a same-day window is half open on both ends`() {
        val school = window("SCHOOL", listOf(1), "08:00", "15:00")
        fun state(t: String) = ScheduleEvaluator.evaluate(listOf(school), utc, at(utc, "2026-10-05T$t"))

        assertFalse(state("07:59").isQuiet)
        assertEquals(at(utc, "2026-10-05T08:00"), state("07:59").nextBoundary)
        assertTrue(state("08:00").isQuiet) // the start minute is inside
        assertEquals(at(utc, "2026-10-05T15:00"), state("08:00").nextBoundary)
        assertTrue(state("14:59").isQuiet)
        assertFalse(state("15:00").isQuiet) // the end minute is outside
        assertEquals(at(utc, "2026-10-12T08:00"), state("15:00").nextBoundary)
    }

    @Test
    fun `a window only runs on its listed days`() {
        val school = window("SCHOOL", listOf(1, 3), "08:00", "15:00")
        assertTrue(ScheduleEvaluator.evaluate(listOf(school), utc, at(utc, "2026-10-05T09:00")).isQuiet) // Monday
        assertFalse(ScheduleEvaluator.evaluate(listOf(school), utc, at(utc, "2026-10-06T09:00")).isQuiet) // Tuesday
        assertTrue(ScheduleEvaluator.evaluate(listOf(school), utc, at(utc, "2026-10-07T09:00")).isQuiet) // Wednesday
    }

    @Test
    fun `an overnight window crosses midnight and belongs to the day it starts on`() {
        val bed = window("BEDTIME", listOf(1), "22:00", "07:00")
        fun state(t: String) = ScheduleEvaluator.evaluate(listOf(bed), utc, at(utc, t))

        assertFalse(state("2026-10-05T21:59").isQuiet)
        assertTrue(state("2026-10-05T22:00").isQuiet)
        assertTrue(state("2026-10-05T23:59").isQuiet)
        val afterMidnight = state("2026-10-06T00:00")
        assertTrue(afterMidnight.isQuiet)
        assertEquals(LocalDate.parse("2026-10-05"), afterMidnight.active.single().startDate)
        assertTrue(state("2026-10-06T06:59").isQuiet)
        assertFalse(state("2026-10-06T07:00").isQuiet)
        // Tuesday evening is not Monday's window.
        assertFalse(state("2026-10-06T23:00").isQuiet)
    }

    @Test
    fun `a Sunday overnight window wraps into Monday`() {
        val bed = window("BEDTIME", listOf(7), "23:00", "06:00")
        val state = ScheduleEvaluator.evaluate(listOf(bed), utc, at(utc, "2026-10-05T05:00")) // Monday morning
        assertTrue(state.isQuiet)
        assertEquals(LocalDate.parse("2026-10-04"), state.active.single().startDate) // Sunday
        assertEquals(at(utc, "2026-10-05T06:00"), state.nextBoundary)
        assertFalse(ScheduleEvaluator.evaluate(listOf(bed), utc, at(utc, "2026-10-06T05:00")).isQuiet)
    }

    @Test
    fun `back-to-back windows hand over at the shared minute`() {
        val a = window("CUSTOM", listOf(1), "08:00", "10:00")
        val b = window("CUSTOM", listOf(1), "10:00", "12:00")
        assertNotNull(ScheduleList.validated(listOf(a, b)))
        val before = ScheduleEvaluator.evaluate(listOf(a, b), utc, at(utc, "2026-10-05T09:59"))
        assertEquals(listOf(a), before.active.map { it.window })
        assertEquals(at(utc, "2026-10-05T10:00"), before.nextBoundary)
        val handover = ScheduleEvaluator.evaluate(listOf(a, b), utc, at(utc, "2026-10-05T10:00"))
        assertEquals(listOf(b), handover.active.map { it.window })
    }

    @Test
    fun `windows of different types can be active together and are ordered by type`() {
        val custom = window("CUSTOM", listOf(2), "06:00", "09:00")
        val bed = window("BEDTIME", listOf(1), "22:00", "07:00")
        assertNotNull(ScheduleList.validated(listOf(custom, bed))) // different types may overlap
        val state = ScheduleEvaluator.evaluate(listOf(custom, bed), utc, at(utc, "2026-10-06T06:30"))
        assertEquals(listOf(ScheduleType.BEDTIME, ScheduleType.CUSTOM), types(state))
        assertEquals(at(utc, "2026-10-06T07:00"), state.nextBoundary) // the earlier of the two ends
    }

    @Test
    fun `the next boundary can be days away`() {
        val school = window("SCHOOL", listOf(1), "08:00", "15:00")
        val state = ScheduleEvaluator.evaluate(listOf(school), utc, at(utc, "2026-10-07T12:00")) // Wednesday
        assertFalse(state.isQuiet)
        assertEquals(at(utc, "2026-10-12T08:00"), state.nextBoundary)
    }

    @Test
    fun `the date changing while a window runs keeps the same window and start date`() {
        val bed = window("BEDTIME", listOf(1), "22:00", "07:00")
        val late = Instant.parse("2026-10-05T23:59:30Z")
        val early = Instant.parse("2026-10-06T00:00:30Z")
        assertEquals(
            LocalDate.parse("2026-10-05"),
            ScheduleEvaluator.evaluate(listOf(bed), utc, late).active.single().startDate,
        )
        assertEquals(
            LocalDate.parse("2026-10-05"),
            ScheduleEvaluator.evaluate(listOf(bed), utc, early).active.single().startDate,
        )
    }

    @Test
    fun `the same instant reads differently in another zone`() {
        val school = window("SCHOOL", listOf(1), "08:00", "15:00")
        val instant = Instant.parse("2026-10-05T03:00:00Z") // Monday 03:00 UTC = Monday 09:00 in Dhaka
        assertFalse(ScheduleEvaluator.evaluate(listOf(school), utc, instant).isQuiet)
        assertTrue(ScheduleEvaluator.evaluate(listOf(school), dhaka, instant).isQuiet)
    }

    @Test
    fun `the zone is the parent's when it is known, otherwise the device's`() {
        assertEquals(dhaka, ScheduleEvaluator.zoneFor("Asia/Dhaka", utc))
        assertEquals(utc, ScheduleEvaluator.zoneFor(null, utc))
        assertEquals(newYork, ScheduleEvaluator.zoneFor(null, newYork))
        assertEquals(utc, ScheduleEvaluator.zoneFor("Mars/Olympus_Mons", utc))
        assertEquals(utc, ScheduleEvaluator.zoneFor("EST", utc))
        assertEquals(utc, ScheduleEvaluator.zoneFor("", utc))
    }

    // US clocks: spring forward 2026-03-08 02:00 -> 03:00; fall back 2026-11-01 02:00 -> 01:00.

    @Test
    fun `spring forward shortens an overnight window and it still ends at the wall-clock time`() {
        val bed = window("BEDTIME", listOf(6), "22:00", "07:00") // Saturday night into Sunday 2026-03-08
        fun state(utcText: String) = ScheduleEvaluator.evaluate(listOf(bed), newYork, Instant.parse(utcText))
        assertFalse(state("2026-03-08T02:59:59Z").isQuiet) // Saturday 21:59 EST
        assertTrue(state("2026-03-08T03:00:00Z").isQuiet) // Saturday 22:00 EST
        assertTrue(state("2026-03-08T10:59:59Z").isQuiet) // Sunday 06:59 EDT
        assertFalse(state("2026-03-08T11:00:00Z").isQuiet) // Sunday 07:00 EDT
        assertEquals(Instant.parse("2026-03-08T11:00:00Z"), state("2026-03-08T03:00:00Z").nextBoundary)
    }

    @Test
    fun `a window that disappears inside the spring forward gap is skipped for that day only`() {
        val gap = window("CUSTOM", listOf(7), "02:30", "03:30") // Sunday 2026-03-08: 02:30 does not exist
        val onDay = ScheduleEvaluator.evaluate(listOf(gap), newYork, Instant.parse("2026-03-08T07:30:00Z"))
        assertFalse(onDay.isQuiet)
        assertEquals(at(newYork, "2026-03-15T02:30"), onDay.nextBoundary) // next Sunday it works again
        val nextWeek = ScheduleEvaluator.evaluate(listOf(gap), newYork, at(newYork, "2026-03-15T03:00"))
        assertTrue(nextWeek.isQuiet)
    }

    @Test
    fun `fall back lengthens an overnight window and ends at the wall-clock time`() {
        val bed = window("BEDTIME", listOf(6), "22:00", "07:00") // Saturday night into Sunday 2026-11-01
        fun state(utcText: String) = ScheduleEvaluator.evaluate(listOf(bed), newYork, Instant.parse(utcText))
        assertFalse(state("2026-11-01T01:59:59Z").isQuiet) // Saturday 21:59 EDT
        assertTrue(state("2026-11-01T02:00:00Z").isQuiet) // Saturday 22:00 EDT
        assertTrue(state("2026-11-01T11:59:59Z").isQuiet) // Sunday 06:59 EST
        assertFalse(state("2026-11-01T12:00:00Z").isQuiet) // Sunday 07:00 EST
    }

    @Test
    fun `an ambiguous start takes the earlier offset so the repeated hour is covered`() {
        val night = window("CUSTOM", listOf(7), "01:30", "02:30") // Sunday 2026-11-01, 01:30 happens twice
        fun state(utcText: String) = ScheduleEvaluator.evaluate(listOf(night), newYork, Instant.parse(utcText))
        assertFalse(state("2026-11-01T05:29:59Z").isQuiet)
        assertTrue(state("2026-11-01T05:30:00Z").isQuiet) // 01:30 EDT
        assertTrue(state("2026-11-01T06:45:00Z").isQuiet) // 01:45 EST, the second pass
        assertTrue(state("2026-11-01T07:29:59Z").isQuiet) // 02:29 EST
        assertFalse(state("2026-11-01T07:30:00Z").isQuiet) // 02:30 EST
    }

    @Test
    fun `evaluation is deterministic for the same input`() {
        val list =
            listOf(
                window("BEDTIME", listOf(1, 2, 3, 4, 5, 6, 7), "21:00", "07:00"),
                window("SCHOOL", listOf(1, 2), "08:00", "15:00"),
            )
        val now = Instant.parse("2026-10-05T10:00:00Z")
        assertEquals(ScheduleEvaluator.evaluate(list, utc, now), ScheduleEvaluator.evaluate(list, utc, now))
    }

    private fun assertNotNull(value: Any?) = org.junit.jupiter.api.Assertions.assertNotNull(value)
}
