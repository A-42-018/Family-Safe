package app.familysafe.child.data

import app.familysafe.child.domain.AppRuleLimits
import app.familysafe.child.domain.LimitReportLimits
import app.familysafe.child.testutil.RepoFiles
import org.junit.jupiter.api.Assertions.assertEquals
import org.junit.jupiter.api.Assertions.assertFalse
import org.junit.jupiter.api.Assertions.assertTrue
import org.junit.jupiter.api.Test

/** Fails when the Android wire format and `device-limit-events.ts` (and its Edge mirror and SQL) drift apart. */
class LimitReportContractDriftTest {
    private val ts = RepoFiles.read("packages/contracts/src/device-limit-events.ts")
    private val edge = RepoFiles.read("supabase/functions/_shared/device-limit-events.ts")
    private val kt = "apps/android/app/src/main/kotlin/app/familysafe/child"
    private val dtoSource = RepoFiles.read("$kt/data/LimitReportDtos.kt")

    private fun serialNames(className: String): Set<String> {
        val start = dtoSource.indexOf("class $className")
        check(start >= 0) { "class $className not found" }
        val end = dtoSource.indexOf("\n) {", start)
        return Regex("""@SerialName\("([a-z_]+)"\)""").findAll(dtoSource.substring(start, end)).map {
            it.groupValues[1]
        }.toSet()
    }

    @Test
    fun `the DTO has exactly the two keys of the request schema and none is nullable`() {
        assertEquals(setOf("day", "occurred_at"), serialNames("LimitReachedRequestDto"))
        for (source in listOf(ts, edge)) {
            val body = source.substringAfter("z\n  .object({").substringBefore("})")
            for (key in listOf("day", "occurred_at")) assertTrue(Regex("""\b$key:\s*z\.""").containsMatchIn(body), key)
            assertTrue(source.contains(".strict()"))
        }
        assertFalse(dtoSource.substringAfter("class LimitReachedRequestDto").substringBefore("\n) {").contains("?"))
    }

    @Test
    fun `the report window stays inside the contract's 24 hours`() {
        assertTrue(LimitReportLimits.MAX_AGE_MILLIS < 24L * 3_600_000L)
        assertTrue(ts.contains("LIMIT_EVENT_PAST_SECONDS = APP_EVENT_PAST_SECONDS"))
        assertEquals(86_400L, AppRuleLimits.EVENT_PAST_SECONDS)
    }

    @Test
    fun `the endpoint exists and the repository uses it`() {
        assertEquals("device-limit-events", LimitReportRepository.ENDPOINT)
        assertTrue(RepoFiles.root().resolve("supabase/functions/device-limit-events/index.ts").exists())
        assertTrue(
            RepoFiles.read("supabase/functions/device-limit-events/index.ts").contains("device_record_limit_reached"),
        )
    }

    @Test
    fun `no limit-report file logs, sets a credential header, or reaches for usage numbers, labels or identifiers`() {
        val files = listOf(
            "domain/LimitReport.kt",
            "data/LimitReportDtos.kt",
            "data/LimitReportHttpMapper.kt",
            "data/LimitReportRepository.kt",
            "data/LimitReportStore.kt",
            "work/LimitReportRunner.kt",
            "work/LimitReportWorker.kt",
        )
        val banned = Regex(
            """Log\.|println|Timber|printStackTrace|bearerAuth|Authorization|ANDROID_ID|getSerial|IMEI|""" +
                """AdvertisingId|""" +
                """Settings\.Secure|loadLabel|getInstalledApplications|usedMinutes|limitMinutes|packageName""",
        )
        files.forEach { assertFalse(banned.containsMatchIn(RepoFiles.read("$kt/$it")), "$it must stay silent") }
    }

    @Test
    fun `the container queues through the planner and clears on disconnect and when the rules are gone`() {
        val container = RepoFiles.read("$kt/di/AppContainer.kt")
        assertTrue(container.contains("LimitReportPlanner.queue("))
        assertEquals(2, Regex("""limitReportStore\.clear\(\)""").findAll(container).count())
        assertTrue(container.contains("workScheduler.cancelLimitReport()"))
        assertTrue(container.contains("onStatus = { queueLimitReportIfNew(it) }"))
        val scheduler = RepoFiles.read(
            "$kt/work/WorkScheduler.kt",
        ).substringAfter("fun uploadLimitReportNow").substringBefore("fun cancelLimitReport")
        assertTrue(scheduler.contains("networkConstraints()"))
        assertTrue(scheduler.contains("ExistingWorkPolicy.APPEND_OR_REPLACE"))
    }
}
