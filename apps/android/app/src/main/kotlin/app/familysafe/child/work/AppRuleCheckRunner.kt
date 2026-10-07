package app.familysafe.child.work

import app.familysafe.child.data.AppAttemptStore
import app.familysafe.child.data.AppRuleStatusStore
import app.familysafe.child.domain.AppAttemptDetector
import app.familysafe.child.domain.AppRuleInactiveReason
import app.familysafe.child.domain.AppRuleStatus
import app.familysafe.child.domain.AppRuleStatusEvaluator
import app.familysafe.child.domain.CachedScreenTimeConfig
import app.familysafe.child.domain.UsageAccess
import app.familysafe.child.domain.UsageAccessProbe
import app.familysafe.child.domain.UsageEventsSource
import java.time.ZoneId

/**
 * One on-device app-rule check: read the cached rules, ask whether Usage Access is on, read today's local usage
 * events (only when an app rule exists and access is on), publish the result, and count blocked apps that were
 * opened since the last check as attempts for the outbox. Nothing is sent from here: when new attempts were queued
 * [onNewAttempts] is called so the caller can schedule the upload. Blocking (one `queryEvents` call), so callers
 * run it off the main thread.
 */
class AppRuleCheckRunner(
    private val rules: () -> CachedScreenTimeConfig?,
    private val access: UsageAccessProbe,
    private val source: UsageEventsSource,
    private val status: AppRuleStatusStore,
    private val attempts: AppAttemptStore,
    private val onNewAttempts: () -> Unit = {},
    private val clock: () -> Long = { System.currentTimeMillis() },
    private val zone: () -> ZoneId = { ZoneId.systemDefault() },
) {
    fun check(): AppRuleStatus {
        val cached = rules()
        val now = clock()
        val reading = AppRuleStatusEvaluator.read(
            cached = cached,
            // No rules means no reading at all: Usage Access is not even asked about.
            access = if (cached == null) UsageAccess.UNKNOWN else access.state(),
            source = source,
            nowEpochMillis = now,
            zone = zone(),
            scanFromEpochMillis = AppAttemptDetector.scanFrom(attempts.snapshot(), now),
        )
        status.record(reading.status)
        val config = reading.config
        val current = reading.status
        if (current is AppRuleStatus.Active && config != null) {
            val before = attempts.snapshot().pending.size
            val after = attempts.update {
                AppAttemptDetector.detect(it, config.version, config.blockedPackages, reading.events, now)
            }
            if (after.pending.size > before) onNewAttempts()
        } else if (current is AppRuleStatus.Inactive && current.reason in NOTHING_APPLIES) {
            // Nothing applies right now, so nothing that happens meanwhile may be counted later.
            attempts.update { AppAttemptDetector.advance(it, now) }
        }
        return current
    }

    private companion object {
        val NOTHING_APPLIES = setOf(AppRuleInactiveReason.RULES_EXPIRED, AppRuleInactiveReason.NO_APP_RULES)
    }
}
