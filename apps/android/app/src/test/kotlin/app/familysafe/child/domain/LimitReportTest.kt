package app.familysafe.child.domain

import java.time.Instant
import org.junit.jupiter.api.Assertions.assertEquals
import org.junit.jupiter.api.Assertions.assertFalse
import org.junit.jupiter.api.Assertions.assertNull
import org.junit.jupiter.api.Assertions.assertSame
import org.junit.jupiter.api.Assertions.assertTrue
import org.junit.jupiter.api.Test

class LimitReportTest {
    private val now = Instant.parse("2026-10-05T12:00:00Z").toEpochMilli()
    private val hour = 3_600_000L

    private fun active(level: LimitLevel, day: String = "2026-10-05", checkedAt: Long = now) = LimitStatus.Active(
        ScreenTimeEvaluation(level, day, 1, 60, 60),
        rulesStale = false,
        checkedAtEpochMillis = checkedAt,
    )

    @Test
    fun `only a reached limit is queued, once per day`() {
        val empty = LimitReportState()
        for (level in listOf(
            LimitLevel.ALLOW,
            LimitLevel.WARN,
        )) assertSame(empty, LimitReportPlanner.queue(empty, active(level), now))
        val queued = LimitReportPlanner.queue(empty, active(LimitLevel.LIMIT), now)
        assertEquals(PendingLimitReport("2026-10-05", now), queued.pending)
        // Seen again while pending: unchanged. After it was sent: not queued again.
        assertSame(queued, LimitReportPlanner.queue(queued, active(LimitLevel.LIMIT), now + 60_000))
        val sent = LimitReportPlanner.done(queued, "2026-10-05")
        assertSame(sent, LimitReportPlanner.queue(sent, active(LimitLevel.LIMIT), now + 120_000))
        assertNull(sent.pending)
        assertEquals("2026-10-05", sent.lastReportedDay)
    }

    @Test
    fun `an unchecked, inactive or malformed status queues nothing`() {
        val empty = LimitReportState()
        assertSame(empty, LimitReportPlanner.queue(empty, LimitStatus.Unchecked, now))
        assertSame(empty, LimitReportPlanner.queue(empty, LimitStatus.Inactive(LimitInactiveReason.NO_RULES, now), now))
        assertSame(empty, LimitReportPlanner.queue(empty, active(LimitLevel.LIMIT, day = "2026-02-30"), now))
        assertSame(empty, LimitReportPlanner.queue(empty, active(LimitLevel.LIMIT, day = "today"), now))
    }

    @Test
    fun `a new day replaces an unsent report of an older day and keeps the last reported day`() {
        val first = LimitReportPlanner.queue(
            LimitReportState("2026-10-03", null),
            active(LimitLevel.LIMIT, "2026-10-04"),
            now - 24 * hour,
        )
        val second = LimitReportPlanner.queue(first, active(LimitLevel.LIMIT, "2026-10-05"), now)
        assertEquals("2026-10-05", second.pending?.day)
        assertEquals("2026-10-03", second.lastReportedDay)
    }

    @Test
    fun `the report time is the check time, never in the future or older than the server window`() {
        val future = LimitReportPlanner.queue(LimitReportState(), active(LimitLevel.LIMIT, checkedAt = now + hour), now)
        assertEquals(now, future.pending?.occurredAtEpochMillis)
        val ancient = LimitReportPlanner.queue(
            LimitReportState(),
            active(LimitLevel.LIMIT, checkedAt = now - 40 * hour),
            now,
        )
        assertEquals(now - LimitReportLimits.MAX_AGE_MILLIS, ancient.pending?.occurredAtEpochMillis)
    }

    @Test
    fun `a pending report is usable only inside the server window`() {
        val state = LimitReportState(null, PendingLimitReport("2026-10-05", now))
        assertEquals(state.pending, LimitReportPlanner.usable(state, now))
        assertEquals(state.pending, LimitReportPlanner.usable(state, now + LimitReportLimits.MAX_AGE_MILLIS))
        assertNull(LimitReportPlanner.usable(state, now + LimitReportLimits.MAX_AGE_MILLIS + 1))
        assertNull(LimitReportPlanner.usable(state, now - 1)) // clock moved back: not in the server's window
        assertNull(LimitReportPlanner.usable(LimitReportState(), now))
    }

    @Test
    fun `done keeps a pending report of another day`() {
        val state = LimitReportState(null, PendingLimitReport("2026-10-05", now))
        val after = LimitReportPlanner.done(state, "2026-10-04")
        assertEquals("2026-10-04", after.lastReportedDay)
        assertEquals(state.pending, after.pending)
    }

    @Test
    fun `the codec round trips every shape and writes the documented string`() {
        for (state in listOf(
            LimitReportState(),
            LimitReportState("2026-10-04", null),
            LimitReportState(null, PendingLimitReport("2026-10-05", 1_790_000_000_000L)),
            LimitReportState("2026-10-04", PendingLimitReport("2026-10-05", 1_790_000_000_000L)),
        )) {
            assertEquals(state, LimitReportStateCodec.decode(LimitReportStateCodec.encode(state)))
        }
        assertEquals(
            "v1;2026-10-04;2026-10-05;1790000000000",
            LimitReportStateCodec.encode(
                LimitReportState("2026-10-04", PendingLimitReport("2026-10-05", 1_790_000_000_000L)),
            ),
        )
        assertEquals("v1;;;", LimitReportStateCodec.encode(LimitReportState()))
    }

    @Test
    fun `the codec rejects junk`() {
        for (text in listOf(
            null, "", "v1", "v2;;;", "v1;x;;", "v1;2026-02-30;;", "v1;;2026-10-05;", "v1;;;123", "v1;;2026-10-05;abc",
            "v1;;2026-10-05;0",
            "v1;;2026-10-05;-5", "v1;;;;", "v1;2026-10-04;2026-10-05;1;extra", "1;2;3;4",
        )) {
            assertNull(LimitReportStateCodec.decode(text), text.toString())
        }
    }

    @Test
    fun `toString never leaks the day, the time or the status`() {
        assertEquals("PendingLimitReport", PendingLimitReport("2026-10-05", now).toString())
        assertEquals("LimitReportState", LimitReportState("2026-10-05", null).toString())
        assertFalse(LimitReportState().equals(LimitReportState("2026-10-05")))
        assertTrue(LimitReportState("a").hashCode() != LimitReportState("b").hashCode())
    }
}
