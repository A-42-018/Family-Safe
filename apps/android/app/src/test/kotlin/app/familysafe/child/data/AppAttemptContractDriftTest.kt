package app.familysafe.child.data

import app.familysafe.child.domain.AppAttemptBatch
import app.familysafe.child.domain.AppInventoryLimits
import app.familysafe.child.domain.AppRuleLimits
import app.familysafe.child.testutil.RepoFiles
import org.junit.jupiter.api.Assertions.assertEquals
import org.junit.jupiter.api.Assertions.assertFalse
import org.junit.jupiter.api.Assertions.assertTrue
import org.junit.jupiter.api.Test

/** Fails when the Android wire format and `device-app-events.ts` (and its Edge mirror) drift. */
class AppAttemptContractDriftTest {
    private val ts = RepoFiles.read("packages/contracts/src/device-app-events.ts")
    private val configTs = RepoFiles.read("packages/contracts/src/device-config.ts")
    private val edge = RepoFiles.read("supabase/functions/_shared/device-app-events.ts")
    private val edgeIndex = RepoFiles.read("supabase/functions/device-app-events/index.ts")
    private val kt = "apps/android/app/src/main/kotlin/app/familysafe/child"
    private val dtoSource = RepoFiles.read("$kt/data/AppAttemptDtos.kt")

    private fun objectKeys(source: String, name: String): Set<String> {
        val start = source.indexOf("export const $name")
        check(start >= 0) { "schema $name not found" }
        val open = source.indexOf(".object({", start)
        check(open >= 0) { "object body of $name not found" }
        val topLevel = StringBuilder()
        var depth = 0
        var quote: Char? = null
        var i = source.indexOf('{', open)
        while (i < source.length) {
            val c = source[i]
            when {
                quote != null -> if (c == quote) quote = null
                c == '"' || c == '\'' || c == '`' -> quote = c
                c == '{' || c == '(' || c == '[' -> depth++
                c == '}' || c == ')' || c == ']' -> {
                    depth--
                    if (depth == 0) break
                }
                depth == 1 -> topLevel.append(c)
            }
            i++
        }
        return Regex("""([a-z_]+)\s*:""").findAll(topLevel).map { it.groupValues[1] }.toSet()
    }

    private fun serialNames(className: String): Set<String> {
        val start = dtoSource.indexOf("class $className")
        check(start >= 0) { "class $className not found" }
        val lineEnd = dtoSource.indexOf('\n', start)
        val firstLine = dtoSource.substring(start, lineEnd).trimEnd()
        val end = if (firstLine.endsWith(") {") || firstLine.endsWith(")")) {
            lineEnd // single-line class header
        } else {
            dtoSource.indexOf("\n) {", start).let { if (it < 0) dtoSource.indexOf("\n)", start) else it }
        }
        return Regex("""@SerialName\("([a-z_]+)"\)""").findAll(dtoSource.substring(start, end))
            .map { it.groupValues[1] }.toSet()
    }

    private fun number(source: String, name: String): Long =
        Regex("""\b$name\s*=\s*([\d_]+)""").find(source)!!.groupValues[1].replace("_", "").toLong()

    @Test
    fun `event DTO has exactly the keys of appEventSchema and none is nullable`() {
        assertEquals(setOf("type", "package_name", "occurred_at"), objectKeys(ts, "appEventSchema"))
        assertEquals(objectKeys(ts, "appEventSchema"), serialNames("AppEventDto"))
        assertFalse(dtoSource.substring(dtoSource.indexOf("class AppEventDto")).substringBefore("}\n\n").contains("?"))
    }

    @Test
    fun `request DTO has exactly the one key of the request schema`() {
        assertEquals(setOf("events"), objectKeys(ts, "deviceAppEventsRequestSchema"))
        assertEquals(setOf("events"), serialNames("AppEventsRequestDto"))
    }

    @Test
    fun `both schemas are strict`() {
        for (name in listOf("appEventSchema", "deviceAppEventsRequestSchema")) {
            val body = ts.substring(ts.indexOf("export const $name")).substringBefore("export type")
            assertTrue(body.contains(".strict()"), name)
        }
    }

    @Test
    fun `the only event type is the one the app sends`() {
        assertTrue(ts.contains("""export const APP_EVENT_TYPES = ["BLOCKED_APP_ATTEMPT"] as const"""))
        assertEquals("BLOCKED_APP_ATTEMPT", AppAttemptWire.EVENT_TYPE)
        assertTrue(edge.contains("BLOCKED_APP_ATTEMPT"))
    }

    @Test
    fun `limits match the contract and the Edge mirror`() {
        for (source in listOf(ts, edge)) {
            assertEquals(AppRuleLimits.EVENTS_MAX.toLong(), number(source, "DEVICE_APP_EVENTS_MAX"))
            assertEquals(AppRuleLimits.EVENT_PAST_SECONDS, number(source, "APP_EVENT_PAST_SECONDS"))
            assertEquals(AppRuleLimits.EVENT_FUTURE_SECONDS, number(source, "APP_EVENT_FUTURE_SECONDS"))
            assertEquals(AppRuleLimits.EVENT_EDGE_MARGIN_SECONDS, number(source, "APP_EVENT_EDGE_MARGIN_SECONDS"))
        }
        assertEquals(AppRuleLimits.MAX_RULES.toLong(), number(configTs, "APP_RULES_MAX"))
        assertTrue(configTs.contains("export const CHILD_APP_PACKAGE = \"${AppRuleLimits.CHILD_APP_PACKAGE}\""))
    }

    @Test
    fun `the de-duplication window is the one the database applies`() {
        val migration = RepoFiles.root().resolve("supabase/migrations/20260930001700_app_rules.sql").readText()
        assertTrue(
            migration.contains("${AppRuleLimits.ATTEMPT_DEDUPE_SECONDS} seconds") ||
                migration.contains("interval '5 minutes'") || migration.contains("300"),
        )
        assertEquals(300L, AppRuleLimits.ATTEMPT_DEDUPE_SECONDS)
    }

    @Test
    fun `the package pattern is the contract's`() {
        val appsTs = RepoFiles.read("packages/contracts/src/device-apps.ts")
        val source = Regex("""PACKAGE_NAME_PATTERN\s*=\s*/(.+)/;""").find(appsTs)!!.groupValues[1]
        assertEquals(source, AppInventoryLimits.PACKAGE_PATTERN)
    }

    @Test
    fun `the wire time is the UTC pattern the contract accepts`() {
        val pattern = Regex("""^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}Z$""")
        assertTrue(pattern.matches(AppAttemptBatch.wireTime(1_790_000_000_123L)))
        assertTrue(ts.contains("APP_EVENT_TIME_PATTERN"))
    }

    @Test
    fun `the endpoint exists and the repository uses it`() {
        assertEquals("device-app-events", AppAttemptRepository.ENDPOINT)
        assertTrue(RepoFiles.root().resolve("supabase/functions/device-app-events/index.ts").exists())
        assertTrue(edgeIndex.contains("device_record_app_attempts"))
    }

    @Test
    fun `no attempt file logs, sets a credential header, or reaches for identifiers or labels`() {
        val files = listOf(
            "data/AppAttemptDtos.kt", "data/AppAttemptHttpMapper.kt", "data/AppAttemptRepository.kt",
            "data/AppAttemptStore.kt", "data/AppRuleStatusStore.kt", "work/AppAttemptRunner.kt",
            "work/AppAttemptWorker.kt", "work/AppRuleCheckRunner.kt", "domain/AppRules.kt",
            "domain/AppRuleEnforcement.kt",
        )
        val banned = Regex(
            """Log\.|println|Timber|printStackTrace|bearerAuth|Authorization|ANDROID_ID|getSerial|IMEI|""" +
                """AdvertisingId|Settings\.Secure|loadLabel|getInstalledApplications""",
        )
        files.forEach { assertFalse(banned.containsMatchIn(RepoFiles.read("$kt/$it")), "$it must stay silent") }
    }
}
