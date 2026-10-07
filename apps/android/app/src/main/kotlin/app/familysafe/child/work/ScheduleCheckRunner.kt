package app.familysafe.child.work

import app.familysafe.child.data.ScheduleStatusStore
import app.familysafe.child.domain.CachedScreenTimeConfig
import app.familysafe.child.domain.ScheduleStatus
import app.familysafe.child.domain.ScheduleStatusEvaluator
import java.time.ZoneId

/**
 * One on-device schedule check: read the cached rules and the clock, publish the result. Pure computation: no file,
 * no network, nothing is sent. The phone's zone is read on every call, so a time-zone or date change is picked up by
 * the next resume, the next foreground tick or the next boundary job.
 */
class ScheduleCheckRunner(
    private val rules: () -> CachedScreenTimeConfig?,
    private val status: ScheduleStatusStore,
    private val clock: () -> Long = { System.currentTimeMillis() },
    private val zone: () -> ZoneId = { ZoneId.systemDefault() },
) {
    fun check(): ScheduleStatus {
        val result = ScheduleStatusEvaluator.read(rules(), clock(), zone())
        status.record(result)
        return result
    }
}
