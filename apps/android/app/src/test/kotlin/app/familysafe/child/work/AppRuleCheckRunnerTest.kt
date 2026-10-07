package app.familysafe.child.work

import app.familysafe.child.data.AppAttemptStore
import app.familysafe.child.data.AppRuleStatusStore
import app.familysafe.child.domain.AppAttempt
import app.familysafe.child.domain.AppRule
import app.familysafe.child.domain.AppRuleInactiveReason
import app.familysafe.child.domain.AppRuleLevel
import app.familysafe.child.domain.AppRuleStatus
import app.familysafe.child.domain.CachedScreenTimeConfig
import app.familysafe.child.domain.ScreenTimeConfig
import app.familysafe.child.domain.ScreenTimeLimits
import app.familysafe.child.domain.UsageAccess
import app.familysafe.child.domain.UsageAccessProbe
import app.familysafe.child.domain.UsageEvent
import app.familysafe.child.domain.UsageEventKind
import app.familysafe.child.domain.UsageEventsSource
import app.familysafe.child.testutil.MapSecureStore
import java.time.Instant
import java.time.ZoneId
import org.junit.jupiter.api.Assertions.assertEquals
import org.junit.jupiter.api.Assertions.assertInstanceOf
import org.junit.jupiter.api.Assertions.assertNull
import org.junit.jupiter.api.Assertions.assertTrue
import org.junit.jupiter.api.Test

class AppRuleCheckRunnerTest {
    private val noon = Instant.parse("2026-10-01T12:00:00Z").toEpochMilli()
    private val minute = 60_000L

    private class Probe(var access: UsageAccess = UsageAccess.GRANTED) : UsageAccessProbe {
        var calls = 0

        override fun state(): UsageAccess {
            calls++
            return access
        }
    }

    private class Source(var events: List<UsageEvent> = emptyList()) : UsageEventsSource {
        var calls = 0

        override fun events(windowStartMillis: Long, windowEndMillis: Long): List<UsageEvent> {
            calls++
            return events
        }
    }

    private fun cache(vararg rules: AppRule, version: Int = 2, validatedAt: Long = noon) = CachedScreenTimeConfig(
        ScreenTimeConfig.validated(version, null, emptyMap(), null, false, rules.toList())!!,
        validatedAt,
    )

    private fun blocked(pkg: String) = AppRule.validated(pkg, true, null)!!
    private fun limited(pkg: String, minutes: Int) = AppRule.validated(pkg, false, minutes)!!
    private fun open(pkg: String, at: Long) = UsageEvent(UsageEventKind.FOREGROUND, pkg, at)

    private val status = AppRuleStatusStore()
    private val attempts = AppAttemptStore(MapSecureStore())
    private var notified = 0
    private var now = noon

    private fun runner(rules: () -> CachedScreenTimeConfig?, probe: Probe, source: Source) = AppRuleCheckRunner(
        rules, probe, source, status, attempts, { notified++ }, { now }, { ZoneId.of("UTC") },
    )

    @Test
    fun `without rules neither the switch nor the usage is read`() {
        val probe = Probe()
        val source = Source()
        val result = runner({ null }, probe, source).check() as AppRuleStatus.Inactive
        assertEquals(AppRuleInactiveReason.NO_RULES, result.reason)
        assertEquals(0, probe.calls)
        assertEquals(0, source.calls)
        assertEquals(result, status.status.value)
    }

    @Test
    fun `rules without an app rule read nothing and only move the watermark`() {
        val source = Source()
        val result = runner({ cache() }, Probe(), source).check() as AppRuleStatus.Inactive
        assertEquals(AppRuleInactiveReason.NO_APP_RULES, result.reason)
        assertEquals(0, source.calls)
        assertEquals(noon, attempts.snapshot().watermarkMillis)
    }

    @Test
    fun `expired rules move the watermark so nothing in between is counted later`() {
        val expired = cache(blocked("com.example.game"), validatedAt = noon - ScreenTimeLimits.EXPIRY_MILLIS - 1)
        val result = runner({ expired }, Probe(), Source()).check() as AppRuleStatus.Inactive
        assertEquals(AppRuleInactiveReason.RULES_EXPIRED, result.reason)
        assertEquals(noon, attempts.snapshot().watermarkMillis)
    }

    @Test
    fun `usage access off is an explicit reason and the watermark is not touched`() {
        val result = runner({ cache(blocked("com.example.game")) }, Probe(UsageAccess.NOT_GRANTED), Source()).check()
        assertEquals(AppRuleInactiveReason.NO_USAGE_ACCESS, (result as AppRuleStatus.Inactive).reason)
        assertNull(attempts.snapshot().watermarkMillis)
        assertEquals(0, notified)
    }

    @Test
    fun `the first check after a rule version only sets the starting point`() {
        val events = listOf(open("com.example.game", noon - 5 * minute))
        val result = runner({ cache(blocked("com.example.game")) }, Probe(), Source(events)).check()
        assertInstanceOf(AppRuleStatus.Active::class.java, result)
        val state = attempts.snapshot()
        assertEquals(2, state.rulesVersion)
        assertEquals(noon, state.watermarkMillis)
        assertTrue(state.pending.isEmpty())
        assertEquals(0, notified)
    }

    @Test
    fun `a blocked app opened after that is queued once and the caller is told`() {
        val source = Source()
        val runner = runner({ cache(blocked("com.example.game")) }, Probe(), source)
        runner.check() // starting point at noon
        now = noon + 10 * minute
        source.events = listOf(open("com.example.game", noon + 3 * minute))
        val status = runner.check() as AppRuleStatus.Active
        assertEquals(AppRuleLevel.BLOCKED, status.entries.single().level)
        assertEquals(listOf(AppAttempt("com.example.game", noon + 3 * minute)), attempts.snapshot().pending)
        assertEquals(1, notified)
        // the same event on the next tick is not counted again
        now = noon + 11 * minute
        runner.check()
        assertEquals(1, attempts.snapshot().pending.size)
        assertEquals(1, notified)
    }

    @Test
    fun `a limited app is measured but never queued as an attempt`() {
        val source = Source()
        val runner = runner({ cache(limited("com.example.video", 5)) }, Probe(), source)
        runner.check()
        now = noon + 10 * minute
        source.events = listOf(open("com.example.video", noon + minute))
        val status = runner.check() as AppRuleStatus.Active
        assertEquals(AppRuleLevel.LIMIT, status.entries.single().level)
        assertTrue(attempts.snapshot().pending.isEmpty())
        assertEquals(0, notified)
    }

    @Test
    fun `a new rule version does not count an app that was opened before the device knew`() {
        val source = Source()
        var current = cache(blocked("com.example.game"), version = 2)
        val runner = runner({ current }, Probe(), source)
        runner.check()
        now = noon + 10 * minute
        current = cache(blocked("com.example.game"), version = 3, validatedAt = now)
        source.events = listOf(open("com.example.game", noon + 5 * minute))
        runner.check()
        assertTrue(attempts.snapshot().pending.isEmpty())
        assertEquals(3, attempts.snapshot().rulesVersion)
    }

    @Test
    fun `the status is published and the reading never sends anything`() {
        val result = runner({ cache(blocked("com.example.game")) }, Probe(), Source()).check()
        assertEquals(result, status.status.value)
    }
}
