package app.familysafe.child.domain

import java.time.Instant
import java.time.ZoneId
import org.junit.jupiter.api.Assertions.assertEquals
import org.junit.jupiter.api.Assertions.assertFalse
import org.junit.jupiter.api.Assertions.assertNotEquals
import org.junit.jupiter.api.Assertions.assertNull
import org.junit.jupiter.api.Assertions.assertTrue
import org.junit.jupiter.api.Test

class ScreenTimeEnforcementTest {
    private val utc = ZoneId.of("UTC")

    // Thursday 2026-10-01 12:00 UTC (ISO weekday 4).
    private val noon = Instant.parse("2026-10-01T12:00:00Z").toEpochMilli()
    private val hour = 3_600_000L

    private fun config(limit: Int? = 60, overrides: Map<Int, Int> = emptyMap()) =
        ScreenTimeConfig.validated(5, limit, overrides)!!

    private fun cached(config: ScreenTimeConfig = config(), validatedAt: Long = noon) =
        CachedScreenTimeConfig(config, validatedAt)

    private class FakeSource(var events: List<UsageEvent> = emptyList(), var failure: Exception? = null) :
        UsageEventsSource {
        val windows = mutableListOf<Pair<Long, Long>>()

        override fun events(windowStartMillis: Long, windowEndMillis: Long): List<UsageEvent> {
            windows += windowStartMillis to windowEndMillis
            failure?.let { throw it }
            return events
        }
    }

    /** Screen on since [hoursBeforeNoon] hours before noon, still on at noon. */
    private fun screenOn(hoursBeforeNoon: Int) =
        listOf(UsageEvent(UsageEventKind.SCREEN_ON, null, noon - hoursBeforeNoon * hour))

    private fun evaluate(
        cache: CachedScreenTimeConfig?,
        access: UsageAccess = UsageAccess.GRANTED,
        source: FakeSource = FakeSource(),
        now: Long = noon,
        zone: ZoneId = utc,
    ) = LimitStatusEvaluator.evaluate(cache, access, source, now, zone)

    // --- warn window ---

    @Test
    fun `warn starts ten minutes before a 60 minute limit, as in the prompt example`() {
        assertEquals(50, ScreenTimeRuleEngine.warnStartMinutes(60))
    }

    @Test
    fun `the warn window is a sixth of the limit, between one and ten minutes`() {
        assertEquals(110, ScreenTimeRuleEngine.warnStartMinutes(120))
        assertEquals(1_430, ScreenTimeRuleEngine.warnStartMinutes(1_440))
        assertEquals(25, ScreenTimeRuleEngine.warnStartMinutes(30))
        assertEquals(9, ScreenTimeRuleEngine.warnStartMinutes(10))
        assertEquals(4, ScreenTimeRuleEngine.warnStartMinutes(5))
        assertEquals(1, ScreenTimeRuleEngine.warnStartMinutes(2))
    }

    @Test
    fun `tiny limits never start warning before the first minute`() {
        assertEquals(1, ScreenTimeRuleEngine.warnStartMinutes(1))
        assertEquals(1, ScreenTimeRuleEngine.warnStartMinutes(0))
    }

    // --- ALLOW / WARN / LIMIT ---

    private fun level(used: Int, limit: Int = 60) =
        ScreenTimeRuleEngine.evaluate(config(limit), "2026-10-01", 4, used)!!.level

    @Test
    fun `60 minute limit - 0 to 49 allow, 50 to 59 warn, 60 and more limit`() {
        listOf(0, 1, 30, 49).forEach { assertEquals(LimitLevel.ALLOW, level(it), "used $it") }
        listOf(50, 55, 59).forEach { assertEquals(LimitLevel.WARN, level(it), "used $it") }
        listOf(60, 61, 300, 1_440).forEach { assertEquals(LimitLevel.LIMIT, level(it), "used $it") }
    }

    @Test
    fun `a limit of zero is reached before any minute is used`() {
        val e = ScreenTimeRuleEngine.evaluate(config(0), "2026-10-01", 4, 0)!!
        assertEquals(LimitLevel.LIMIT, e.level)
        assertTrue(e.noScreenTimeToday)
        assertEquals(0, e.remainingMinutes)
    }

    @Test
    fun `a one minute limit goes from allow straight to limit`() {
        assertEquals(LimitLevel.ALLOW, level(0, limit = 1))
        assertEquals(LimitLevel.LIMIT, level(1, limit = 1))
    }

    @Test
    fun `no limit for the weekday means no evaluation`() {
        assertNull(ScreenTimeRuleEngine.evaluate(config(limit = null), "2026-10-01", 4, 500))
        assertNull(ScreenTimeRuleEngine.evaluate(config(limit = null, overrides = mapOf(6 to 90)), "2026-10-01", 5, 5))
    }

    @Test
    fun `a weekday override replaces the default, zero included`() {
        val c = config(limit = 120, overrides = mapOf(4 to 30, 5 to 0))
        assertEquals(30, ScreenTimeRuleEngine.evaluate(c, "d", 4, 10)!!.limitMinutes)
        assertEquals(0, ScreenTimeRuleEngine.evaluate(c, "d", 5, 0)!!.limitMinutes)
        assertEquals(120, ScreenTimeRuleEngine.evaluate(c, "d", 1, 10)!!.limitMinutes)
    }

    @Test
    fun `negative usage reads as zero and remaining never goes below zero`() {
        val low = ScreenTimeRuleEngine.evaluate(config(60), "d", 4, -5)!!
        assertEquals(0, low.usedMinutes)
        assertEquals(60, low.remainingMinutes)
        val over = ScreenTimeRuleEngine.evaluate(config(60), "d", 4, 200)!!
        assertEquals(0, over.remainingMinutes)
    }

    @Test
    fun `evaluations compare by value and print only the level`() {
        val a = ScreenTimeEvaluation(LimitLevel.WARN, "2026-10-01", 4, 55, 60)
        assertEquals(a, ScreenTimeEvaluation(LimitLevel.WARN, "2026-10-01", 4, 55, 60))
        assertNotEquals(a, ScreenTimeEvaluation(LimitLevel.WARN, "2026-10-01", 4, 56, 60))
        assertEquals("ScreenTimeEvaluation(WARN)", a.toString())
        assertFalse(LimitStatus.Active(a, false, 1L).toString().contains("55"))
        assertFalse(LimitStatus.Inactive(LimitInactiveReason.NO_RULES, 123456L).toString().contains("123456"))
    }

    // --- weekday on the device clock ---

    @Test
    fun `the weekday follows the device time zone, not UTC`() {
        val lateThursdayUtc = Instant.parse("2026-10-01T22:30:00Z").toEpochMilli()
        assertEquals(4, LocalWeekday.iso(lateThursdayUtc, utc))
        assertEquals(5, LocalWeekday.iso(lateThursdayUtc, ZoneId.of("Asia/Dhaka")))
        assertEquals(4, LocalWeekday.iso(lateThursdayUtc, ZoneId.of("America/Los_Angeles")))
        assertEquals(7, LocalWeekday.iso(Instant.parse("2026-10-04T00:00:00Z").toEpochMilli(), utc))
        assertEquals(1, LocalWeekday.iso(Instant.parse("2026-10-05T00:00:00Z").toEpochMilli(), utc))
    }

    // --- the evaluator: which reason, and what is (not) read ---

    @Test
    fun `no rules - nothing is read`() {
        val source = FakeSource()
        val status = evaluate(null, source = source) as LimitStatus.Inactive
        assertEquals(LimitInactiveReason.NO_RULES, status.reason)
        assertTrue(source.windows.isEmpty())
    }

    @Test
    fun `rules not confirmed for over a week are not applied`() {
        val source = FakeSource(screenOn(5))
        val old = cached(validatedAt = noon - ScreenTimeLimits.EXPIRY_MILLIS - 1)
        val status = evaluate(old, source = source) as LimitStatus.Inactive
        assertEquals(LimitInactiveReason.RULES_EXPIRED, status.reason)
        assertTrue(source.windows.isEmpty())
    }

    @Test
    fun `rules exactly at the expiry boundary are still applied`() {
        val edge = cached(validatedAt = noon - ScreenTimeLimits.EXPIRY_MILLIS)
        assertTrue(evaluate(edge, source = FakeSource(screenOn(1))) is LimitStatus.Active)
    }

    @Test
    fun `a revived cache is applied again after a later confirmation`() {
        val config = config(60)
        val expired = evaluate(CachedScreenTimeConfig(config, noon - ScreenTimeLimits.EXPIRY_MILLIS - 5))
        assertTrue(expired is LimitStatus.Inactive)
        val revived = evaluate(CachedScreenTimeConfig(config, noon), source = FakeSource(screenOn(1)))
        assertTrue(revived is LimitStatus.Active)
    }

    @Test
    fun `no limit today - nothing is read and usage access is not needed`() {
        val source = FakeSource(screenOn(5))
        val c = cached(config(limit = null, overrides = mapOf(6 to 60)))
        val status = evaluate(c, access = UsageAccess.NOT_GRANTED, source = source) as LimitStatus.Inactive
        assertEquals(LimitInactiveReason.NO_LIMIT_TODAY, status.reason)
        assertTrue(source.windows.isEmpty())
    }

    @Test
    fun `a limit without usage access is reported as such and nothing is read`() {
        listOf(UsageAccess.NOT_GRANTED, UsageAccess.UNKNOWN).forEach { access ->
            val source = FakeSource(screenOn(5))
            val status = evaluate(cached(), access = access, source = source) as LimitStatus.Inactive
            assertEquals(LimitInactiveReason.NO_USAGE_ACCESS, status.reason)
            assertTrue(source.windows.isEmpty())
        }
    }

    @Test
    fun `an unreadable usage source is reported as cannot read, never as allowed`() {
        val source = FakeSource(failure = SecurityException("no access"))
        val status = evaluate(cached(), source = source) as LimitStatus.Inactive
        assertEquals(LimitInactiveReason.CANNOT_READ_USAGE, status.reason)
    }

    @Test
    fun `measures today from local midnight until now`() {
        val source = FakeSource(screenOn(2))
        val status = evaluate(cached(config(180)), source = source) as LimitStatus.Active
        assertEquals(listOf(Instant.parse("2026-10-01T00:00:00Z").toEpochMilli() to noon), source.windows)
        assertEquals(120, status.evaluation.usedMinutes)
        assertEquals("2026-10-01", status.evaluation.day)
        assertEquals(4, status.evaluation.isoWeekday)
        assertEquals(noon, status.checkedAtEpochMillis)
    }

    @Test
    fun `120 minutes against a 60 minute limit is limit, against 180 it is allow`() {
        val over = evaluate(cached(config(60)), source = FakeSource(screenOn(2))) as LimitStatus.Active
        assertEquals(LimitLevel.LIMIT, over.evaluation.level)
        val under = evaluate(cached(config(180)), source = FakeSource(screenOn(2))) as LimitStatus.Active
        assertEquals(LimitLevel.ALLOW, under.evaluation.level)
        assertEquals(60, under.evaluation.remainingMinutes)
    }

    @Test
    fun `today's override wins over the default limit`() {
        val c = cached(config(limit = 240, overrides = mapOf(4 to 30)))
        val status = evaluate(c, source = FakeSource(screenOn(2))) as LimitStatus.Active
        assertEquals(30, status.evaluation.limitMinutes)
        assertEquals(LimitLevel.LIMIT, status.evaluation.level)
    }

    @Test
    fun `the local day and weekday come from the time zone`() {
        val now = Instant.parse("2026-10-01T22:30:00Z").toEpochMilli()
        val dhaka = ZoneId.of("Asia/Dhaka")
        val c = cached(config(limit = 60, overrides = mapOf(5 to 0)), validatedAt = now)
        val source = FakeSource()
        val status = evaluate(c, source = source, now = now, zone = dhaka) as LimitStatus.Active
        assertEquals("2026-10-02", status.evaluation.day)
        assertEquals(5, status.evaluation.isoWeekday)
        assertEquals(0, status.evaluation.limitMinutes)
        assertEquals(Instant.parse("2026-10-01T18:00:00Z").toEpochMilli(), source.windows.single().first)
    }

    @Test
    fun `rules are flagged stale after 18 hours but still applied`() {
        val edge = noon - ScreenTimeLimits.STALE_MILLIS
        val fresh = evaluate(cached(validatedAt = edge), source = FakeSource(screenOn(1)))
        assertFalse((fresh as LimitStatus.Active).rulesStale)
        val stale = evaluate(cached(validatedAt = edge - 1), source = FakeSource(screenOn(1)))
        assertTrue((stale as LimitStatus.Active).rulesStale)
    }

    @Test
    fun `a confirmation time in the future counts as fresh`() {
        val status = evaluate(cached(validatedAt = noon + 10 * hour), source = FakeSource(screenOn(1)))
        assertFalse((status as LimitStatus.Active).rulesStale)
    }

    // --- the full-screen notice ---

    private fun active(level: LimitLevel, day: String = "2026-10-01", limit: Int = 60): LimitStatus.Active {
        val used = when (level) {
            LimitLevel.ALLOW -> 1
            LimitLevel.WARN -> limit - 1
            LimitLevel.LIMIT -> limit
        }
        return LimitStatus.Active(ScreenTimeEvaluation(level, day, 4, used, limit), false, 1L)
    }

    @Test
    fun `the full-screen notice shows only at limit`() {
        assertTrue(LimitNotice.showsFullScreen(active(LimitLevel.LIMIT), null))
        assertFalse(LimitNotice.showsFullScreen(active(LimitLevel.WARN), null))
        assertFalse(LimitNotice.showsFullScreen(active(LimitLevel.ALLOW), null))
        assertFalse(LimitNotice.showsFullScreen(LimitStatus.Unchecked, null))
        assertFalse(LimitNotice.showsFullScreen(LimitStatus.Inactive(LimitInactiveReason.NO_RULES, 1L), null))
    }

    @Test
    fun `dismissing hides it for that day and limit only`() {
        val shown = active(LimitLevel.LIMIT)
        val key = LimitNotice.dismissKey(shown.evaluation)
        assertFalse(LimitNotice.showsFullScreen(shown, key))
        assertTrue(LimitNotice.showsFullScreen(active(LimitLevel.LIMIT, day = "2026-10-02"), key))
        assertTrue(LimitNotice.showsFullScreen(active(LimitLevel.LIMIT, limit = 45), key))
    }
}
