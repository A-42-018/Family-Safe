package app.familysafe.child.domain

import java.time.Instant
import java.time.ZoneId
import org.junit.jupiter.api.Assertions.assertEquals
import org.junit.jupiter.api.Assertions.assertFalse
import org.junit.jupiter.api.Assertions.assertInstanceOf
import org.junit.jupiter.api.Assertions.assertNull
import org.junit.jupiter.api.Assertions.assertTrue
import org.junit.jupiter.api.Test

class ScheduleStatusTest {
    private val utc = ZoneId.of("UTC")
    private val dhaka = ZoneId.of("Asia/Dhaka")

    private fun window(i: Int, type: String, days: List<Int>, start: String, end: String) =
        ScheduleWindow.validated("00000000-0000-4000-8000-%012d".format(i), "W$i", type, days, start, end)!!

    private val bed = window(1, "BEDTIME", listOf(1), "22:00", "07:00")
    private val school = window(2, "SCHOOL", listOf(1, 2), "08:00", "15:00")

    private fun cached(
        schedules: List<ScheduleWindow> = listOf(bed, school),
        timezone: String? = null,
        validatedAt: Long = 0L,
    ) = CachedScreenTimeConfig(
        ScreenTimeConfig.validated(1, null, emptyMap(), emptyList(), timezone, schedules)!!,
        validatedAt,
    )

    private fun millis(text: String) = Instant.parse(text).toEpochMilli()

    private fun read(c: CachedScreenTimeConfig?, at: String, zone: ZoneId = utc) =
        ScheduleStatusEvaluator.read(c, millis(at), zone)

    @Test
    fun `no rules, expired rules and no schedules are three different inactive states`() {
        val noRules = read(null, "2026-10-05T10:00:00Z") as ScheduleStatus.Inactive
        assertEquals(ScheduleInactiveReason.NO_RULES, noRules.reason)

        val old = cached(validatedAt = 0L)
        val expired = ScheduleStatusEvaluator.read(
            old,
            ScreenTimeLimits.EXPIRY_MILLIS + 1,
            utc,
        ) as ScheduleStatus.Inactive
        assertEquals(ScheduleInactiveReason.RULES_EXPIRED, expired.reason)

        val none = ScheduleStatusEvaluator.read(cached(schedules = emptyList()), 1L, utc) as ScheduleStatus.Inactive
        assertEquals(ScheduleInactiveReason.NO_SCHEDULES, none.reason)
    }

    @Test
    fun `an active window is reported with the next boundary and the zone used`() {
        val at = "2026-10-05T09:00:00Z" // Monday, school time
        val status = read(cached(validatedAt = millis(at)), at) as ScheduleStatus.Active
        assertEquals(2, status.scheduleCount)
        assertTrue(status.isQuiet)
        assertEquals(listOf(ScheduleType.SCHOOL), status.active.map { it.window.type })
        assertEquals(millis("2026-10-05T15:00:00Z"), status.nextBoundaryEpochMillis)
        assertEquals("UTC", status.zoneId)
        assertFalse(status.parentZone)
        assertFalse(status.rulesStale)
    }

    @Test
    fun `between windows nothing is quiet but a boundary is still known`() {
        val at = "2026-10-05T16:00:00Z"
        val status = read(cached(validatedAt = millis(at)), at) as ScheduleStatus.Active
        assertFalse(status.isQuiet)
        assertEquals(millis("2026-10-05T22:00:00Z"), status.nextBoundaryEpochMillis)
    }

    @Test
    fun `the parent's zone wins over the phone's zone and is flagged`() {
        val at = "2026-10-05T03:00:00Z" // 09:00 in Dhaka: school time there, the middle of the night in UTC
        val inDhaka = read(cached(timezone = "Asia/Dhaka", validatedAt = millis(at)), at, utc) as ScheduleStatus.Active
        assertTrue(inDhaka.isQuiet)
        assertEquals("Asia/Dhaka", inDhaka.zoneId)
        assertTrue(inDhaka.parentZone)
        val inPhoneZone = read(cached(validatedAt = millis(at)), at, utc) as ScheduleStatus.Active
        assertFalse(inPhoneZone.isQuiet)
        val phoneIsDhaka = read(cached(validatedAt = millis(at)), at, dhaka) as ScheduleStatus.Active
        assertTrue(phoneIsDhaka.isQuiet)
        assertFalse(phoneIsDhaka.parentZone)
    }

    @Test
    fun `an unknown zone name falls back to the phone's zone and is not flagged as the parent's`() {
        val at = "2026-10-05T03:00:00Z"
        val status = read(
            cached(timezone = "Mars/Olympus", validatedAt = millis(at)),
            at,
            dhaka,
        ) as ScheduleStatus.Active
        assertEquals("Asia/Dhaka", status.zoneId)
        assertFalse(status.parentZone)
    }

    @Test
    fun `stale rules are still applied but flagged`() {
        val validated = millis("2026-10-05T00:00:00Z")
        val at = validated + ScreenTimeLimits.STALE_MILLIS + 1
        val status = ScheduleStatusEvaluator.read(cached(validatedAt = validated), at, utc) as ScheduleStatus.Active
        assertTrue(status.rulesStale)
    }

    @Test
    fun `a notice is pending for an active window until that window and day are put away`() {
        val at = "2026-10-05T09:00:00Z"
        val status = read(cached(validatedAt = millis(at)), at)
        val notice = QuietTimeNotices.pending(status, "")!!
        assertEquals(ScheduleType.SCHOOL, notice.window.type)
        val dismissed = NoticeKeys.add("", QuietTimeNotices.dismissKey(notice))
        assertNull(QuietTimeNotices.pending(status, dismissed))
        // The same window on the next day (Tuesday) is a new notice.
        val tuesday = "2026-10-06T09:00:00Z"
        val next = QuietTimeNotices.pending(read(cached(validatedAt = millis(tuesday)), tuesday), dismissed)!!
        assertEquals(notice.window.id, next.window.id)
    }

    @Test
    fun `an edit of the window times brings the notice back`() {
        val at = "2026-10-05T09:00:00Z"
        val before = QuietTimeNotices.pending(read(cached(validatedAt = millis(at)), at), "")!!
        val dismissed = NoticeKeys.add("", QuietTimeNotices.dismissKey(before))
        val edited = window(2, "SCHOOL", listOf(1, 2), "08:30", "15:00")
        val c = cached(schedules = listOf(bed, edited), validatedAt = millis(at))
        assertTrue(QuietTimeNotices.pending(read(c, at), dismissed) != null)
    }

    @Test
    fun `two windows in force are put away one at a time, bedtime first`() {
        val custom = window(3, "CUSTOM", listOf(2), "06:00", "09:00")
        val at = "2026-10-06T06:30:00Z" // Tuesday: Monday's bedtime still runs, plus the custom window
        val c = cached(schedules = listOf(custom, bed), validatedAt = millis(at))
        val status = read(c, at)
        val first = QuietTimeNotices.pending(status, "")!!
        assertEquals(ScheduleType.BEDTIME, first.window.type)
        val second = QuietTimeNotices.pending(status, NoticeKeys.add("", QuietTimeNotices.dismissKey(first)))!!
        assertEquals(ScheduleType.CUSTOM, second.window.type)
    }

    @Test
    fun `no notice without an active status`() {
        assertNull(QuietTimeNotices.pending(ScheduleStatus.Unchecked, ""))
        assertNull(QuietTimeNotices.pending(read(null, "2026-10-05T09:00:00Z"), ""))
        val at = "2026-10-05T16:00:00Z"
        assertNull(QuietTimeNotices.pending(read(cached(validatedAt = millis(at)), at), ""))
    }

    @Test
    fun `the boundary job waits until just after the next boundary`() {
        val at = "2026-10-05T09:00:00Z"
        val status = read(cached(validatedAt = millis(at)), at)
        assertEquals(
            6 * 3_600_000L + ScheduleBoundary.SLACK_MILLIS,
            ScheduleBoundary.nextDelayMillis(status, millis(at)),
        )
        // A boundary already behind us still waits the slack and never a negative time.
        assertEquals(
            ScheduleBoundary.SLACK_MILLIS,
            ScheduleBoundary.nextDelayMillis(status, millis(at) + 99 * 3_600_000L),
        )
        assertNull(ScheduleBoundary.nextDelayMillis(ScheduleStatus.Unchecked, 0L))
        assertNull(ScheduleBoundary.nextDelayMillis(read(null, at), millis(at)))
    }

    @Test
    fun `toString never leaks names`() {
        val at = "2026-10-05T09:00:00Z"
        val status = read(cached(validatedAt = millis(at)), at)
        assertFalse(status.toString().contains("W2"))
        assertInstanceOf(ScheduleStatus.Active::class.java, status)
    }
}
