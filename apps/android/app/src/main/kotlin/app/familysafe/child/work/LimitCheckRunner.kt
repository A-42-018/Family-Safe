package app.familysafe.child.work

import app.familysafe.child.data.LimitStatusStore
import app.familysafe.child.domain.CachedScreenTimeConfig
import app.familysafe.child.domain.LimitStatus
import app.familysafe.child.domain.LimitStatusEvaluator
import app.familysafe.child.domain.UsageAccess
import app.familysafe.child.domain.UsageAccessProbe
import app.familysafe.child.domain.UsageEventsSource
import java.time.ZoneId

/**
 * One on-device limit check: read the cached rules, ask whether Usage Access is on, read today's local usage events
 * (only when a limit applies today and access is on), publish the result. Nothing is sent over the network and
 * nothing is stored; the result lives in [LimitStatusStore] for the screens and is handed to [onStatus] (which may
 * queue the one-line "limit reached" report, see `LimitReportRunner`). Blocking (one `queryEvents` call), so
 * callers run it off the main thread.
 */
class LimitCheckRunner(
    private val rules: () -> CachedScreenTimeConfig?,
    private val access: UsageAccessProbe,
    private val source: UsageEventsSource,
    private val status: LimitStatusStore,
    private val clock: () -> Long = { System.currentTimeMillis() },
    private val zone: () -> ZoneId = { ZoneId.systemDefault() },
    private val onStatus: (LimitStatus) -> Unit = {},
) {
    fun check(): LimitStatus {
        val cached = rules()
        val result = LimitStatusEvaluator.evaluate(
            cached = cached,
            // No rules means no reading at all: Usage Access is not even asked about.
            access = if (cached == null) UsageAccess.UNKNOWN else access.state(),
            source = source,
            nowEpochMillis = clock(),
            zone = zone(),
        )
        status.record(result)
        onStatus(result)
        return result
    }
}
