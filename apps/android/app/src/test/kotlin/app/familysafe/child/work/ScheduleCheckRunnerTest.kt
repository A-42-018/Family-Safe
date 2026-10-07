package app.familysafe.child.work

import app.familysafe.child.data.ScheduleStatusStore
import app.familysafe.child.domain.CachedScreenTimeConfig
import app.familysafe.child.domain.ScheduleInactiveReason
import app.familysafe.child.domain.ScheduleStatus
import app.familysafe.child.domain.ScheduleWindow
import app.familysafe.child.domain.ScreenTimeConfig
import java.time.Instant
import java.time.ZoneId
import org.junit.jupiter.api.Assertions.assertEquals
import org.junit.jupiter.api.Assertions.assertTrue
import org.junit.jupiter.api.Test

class ScheduleCheckRunnerTest {
    private val bed = ScheduleWindow.validated(
        "00000000-0000-4000-8000-000000000001",
        "Night",
        "BEDTIME",
        listOf(1),
        "22:00",
        "07:00",
    )!!
    private var cache: CachedScreenTimeConfig? = null
    private var now = Instant.parse("2026-10-05T23:00:00Z").toEpochMilli()
    private var zone = ZoneId.of("UTC")
    private val store = ScheduleStatusStore()
    private val runner = ScheduleCheckRunner({ cache }, store, { now }, { zone })

    private fun withSchedules() {
        cache = CachedScreenTimeConfig(
            ScreenTimeConfig.validated(1, null, emptyMap(), emptyList(), null, listOf(bed))!!,
            now,
        )
    }

    @Test
    fun `starts unchecked and records every check`() {
        assertEquals(ScheduleStatus.Unchecked, store.status.value)
        val result = runner.check()
        assertEquals(result, store.status.value)
        assertEquals(ScheduleInactiveReason.NO_RULES, (result as ScheduleStatus.Inactive).reason)
    }

    @Test
    fun `the clock and the zone are read on every check, so a change is picked up`() {
        withSchedules()
        assertTrue((runner.check() as ScheduleStatus.Active).isQuiet) // Monday 23:00 UTC
        now = Instant.parse("2026-10-06T08:00:00Z").toEpochMilli() // after 07:00
        cache = CachedScreenTimeConfig(cache!!.config, now)
        assertTrue(!(runner.check() as ScheduleStatus.Active).isQuiet)
        zone = ZoneId.of("America/Los_Angeles") // 01:00 Tuesday there: still inside Monday's window
        assertTrue((runner.check() as ScheduleStatus.Active).isQuiet)
    }

    @Test
    fun `losing the rules clears the quiet state`() {
        withSchedules()
        assertTrue((runner.check() as ScheduleStatus.Active).isQuiet)
        cache = null
        assertEquals(ScheduleInactiveReason.NO_RULES, (runner.check() as ScheduleStatus.Inactive).reason)
    }

    @Test
    fun `the store can be cleared`() {
        withSchedules()
        runner.check()
        store.clear()
        assertEquals(ScheduleStatus.Unchecked, store.status.value)
    }
}
