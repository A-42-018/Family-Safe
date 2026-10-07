package app.familysafe.child.work

import app.familysafe.child.data.LimitStatusStore
import app.familysafe.child.domain.CachedScreenTimeConfig
import app.familysafe.child.domain.LimitInactiveReason
import app.familysafe.child.domain.LimitLevel
import app.familysafe.child.domain.LimitStatus
import app.familysafe.child.domain.ScreenTimeConfig
import app.familysafe.child.domain.UsageAccess
import app.familysafe.child.domain.UsageAccessProbe
import app.familysafe.child.domain.UsageEvent
import app.familysafe.child.domain.UsageEventKind
import app.familysafe.child.domain.UsageEventsSource
import java.time.Instant
import java.time.ZoneId
import org.junit.jupiter.api.Assertions.assertEquals
import org.junit.jupiter.api.Assertions.assertTrue
import org.junit.jupiter.api.Test

class LimitCheckRunnerTest {
    private val noon = Instant.parse("2026-10-01T12:00:00Z").toEpochMilli()

    private class Probe(var access: UsageAccess = UsageAccess.GRANTED) : UsageAccessProbe {
        var calls = 0

        override fun state(): UsageAccess {
            calls++
            return access
        }
    }

    private class Source(val events: List<UsageEvent>) : UsageEventsSource {
        var calls = 0

        override fun events(windowStartMillis: Long, windowEndMillis: Long): List<UsageEvent> {
            calls++
            return events
        }
    }

    private fun cache(limit: Int?) =
        CachedScreenTimeConfig(ScreenTimeConfig.validated(2, limit, emptyMap(), null, false)!!, noon)

    private val twoHours = listOf(UsageEvent(UsageEventKind.SCREEN_ON, null, noon - 2 * 3_600_000L))

    private val store = LimitStatusStore()

    private fun runner(rules: () -> CachedScreenTimeConfig?, probe: Probe, source: Source) =
        LimitCheckRunner(rules, probe, source, store, { noon }, { ZoneId.of("UTC") })

    @Test
    fun `without rules neither the switch nor the usage is read`() {
        val probe = Probe()
        val source = Source(twoHours)
        val result = runner({ null }, probe, source).check() as LimitStatus.Inactive
        assertEquals(LimitInactiveReason.NO_RULES, result.reason)
        assertEquals(0, probe.calls)
        assertEquals(0, source.calls)
        assertEquals(result, store.status.value)
    }

    @Test
    fun `with a limit and usage access it publishes today's evaluation`() {
        val result = runner({ cache(60) }, Probe(), Source(twoHours)).check() as LimitStatus.Active
        assertEquals(LimitLevel.LIMIT, result.evaluation.level)
        assertEquals(120, result.evaluation.usedMinutes)
        assertEquals(result, store.status.value)
    }

    @Test
    fun `it reads the current rules on every check`() {
        var current: CachedScreenTimeConfig? = cache(60)
        val runner = runner({ current }, Probe(), Source(twoHours))
        assertEquals(LimitLevel.LIMIT, (runner.check() as LimitStatus.Active).evaluation.level)
        current = cache(240)
        assertEquals(LimitLevel.ALLOW, (runner.check() as LimitStatus.Active).evaluation.level)
        current = null
        assertTrue(runner.check() is LimitStatus.Inactive)
        assertTrue(store.status.value is LimitStatus.Inactive)
    }

    @Test
    fun `usage access off is published as such and no events are read`() {
        val source = Source(twoHours)
        val result = runner({ cache(60) }, Probe(UsageAccess.NOT_GRANTED), source).check() as LimitStatus.Inactive
        assertEquals(LimitInactiveReason.NO_USAGE_ACCESS, result.reason)
        assertEquals(0, source.calls)
    }
}
