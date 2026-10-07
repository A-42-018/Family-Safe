package app.familysafe.child.data

import app.familysafe.child.domain.AppInventoryLimits
import app.familysafe.child.domain.UsageLimits
import app.familysafe.child.testutil.RepoFiles
import java.io.File
import org.junit.jupiter.api.Assertions.assertEquals
import org.junit.jupiter.api.Assertions.assertFalse
import org.junit.jupiter.api.Assertions.assertTrue
import org.junit.jupiter.api.Test

/** Fails when the Android wire format and `packages/contracts/src/device-usage.ts` (and its Edge mirror) drift. */
class UsageContractDriftTest {
    private val ts = RepoFiles.read("packages/contracts/src/device-usage.ts")
    private val appsTs = RepoFiles.read("packages/contracts/src/device-apps.ts")
    private val edge = RepoFiles.read("supabase/functions/_shared/device-usage.ts")
    private val kt = "apps/android/app/src/main/kotlin/app/familysafe/child"
    private val dtoSource = RepoFiles.read("$kt/data/UsageDtos.kt")

    /** Keys written directly inside `export const <name> = z.object({ ... })` (nested objects are skipped). */
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
        val end = dtoSource.indexOf("\n)", start)
        return Regex("""@SerialName\("([a-z_]+)"\)""").findAll(dtoSource.substring(start, end))
            .map { it.groupValues[1] }.toSet()
    }

    private fun number(source: String, name: String): Long =
        Regex("""\b$name\s*=\s*(\d+)""").find(source)!!.groupValues[1].toLong()

    @Test
    fun `app DTO has exactly the three keys of appUsageSchema`() {
        val contract = objectKeys(ts, "appUsageSchema")
        assertEquals(setOf("package_name", "foreground_minutes", "launch_count"), contract)
        assertEquals(contract, serialNames("UsageAppDto"))
        assertEquals(contract, objectKeys(edge, "AppUsageSchema"))
    }

    @Test
    fun `request DTO has exactly the four keys of deviceUsageRequestSchema`() {
        val contract = objectKeys(ts, "deviceUsageRequestSchema")
        assertEquals(setOf("day", "total_screen_minutes", "unlock_count", "apps"), contract)
        assertEquals(contract, serialNames("UsageRequestDto"))
        assertEquals(contract, objectKeys(edge, "DeviceUsageSchema"))
    }

    @Test
    fun `both schemas are strict, so no extra key may ever be sent`() {
        assertEquals(2, Regex("""\.strict\(\)""").findAll(ts).count())
        assertEquals(2, Regex("""\.strict\(\)""").findAll(edge).count())
    }

    @Test
    fun `nothing is nullable, in the contract, the mirror and the DTOs`() {
        assertFalse(ts.contains(".nullable()"))
        assertFalse(edge.contains(".nullable()"))
        val dtoNullable = Regex("""val (\w+): [A-Za-z<>]+\?""").findAll(dtoSource).toList()
        assertTrue(dtoNullable.isEmpty())
    }

    @Test
    fun `the encoder keeps explicit nulls like the other uploads`() {
        assertTrue(dtoSource.contains("explicitNulls = true"))
        assertFalse(dtoSource.contains("explicitNulls = false"))
    }

    @Test
    fun `response DTO covers the fields the app reads from deviceUsageResponseSchema`() {
        val contract = objectKeys(ts, "deviceUsageResponseSchema")
        assertEquals(setOf("server_time", "next_interval_seconds"), contract)
        assertEquals(contract, serialNames("UsageDataDto"))
    }

    @Test
    fun `limits and interval match the contract and the Edge mirror`() {
        for (source in listOf(ts, edge)) {
            assertEquals(number(source, "DEVICE_USAGE_MAX_APPS"), UsageLimits.MAX_APPS.toLong())
            assertEquals(number(source, "DEVICE_USAGE_MAX_MINUTES"), UsageLimits.MAX_MINUTES.toLong())
            assertEquals(number(source, "DEVICE_USAGE_MAX_COUNT"), UsageLimits.MAX_COUNT.toLong())
            assertEquals(number(source, "DEVICE_USAGE_INTERVAL_SECONDS"), UsageLimits.INTERVAL_HOURS * 3600)
            val packageMax = Regex("""package_name: z\.string\(\)\.max\((\d+)\)""").find(source)!!.groupValues[1]
            assertEquals(packageMax.toInt(), UsageLimits.PACKAGE_MAX)
        }
        assertEquals(21600L, UsageLimits.INTERVAL_HOURS * 3600)
    }

    @Test
    fun `the day window accepts what the app sends, today and yesterday`() {
        for (source in listOf(ts, edge)) {
            assertTrue(number(source, "DEVICE_USAGE_PAST_DAYS") >= 1)
            assertTrue(number(source, "DEVICE_USAGE_FUTURE_DAYS") >= 1)
        }
    }

    @Test
    fun `the package pattern is the same text in Kotlin, the contracts and the mirror`() {
        assertTrue(ts.contains("import { PACKAGE_NAME_PATTERN } from \"./device-apps\""))
        val sanitizer = RepoFiles.read("$kt/domain/UsageStats.kt")
        assertTrue(sanitizer.contains("Regex(AppInventoryLimits.PACKAGE_PATTERN)"))
        for (source in listOf(appsTs, edge)) {
            val line = source.lines().first { it.contains("PACKAGE_NAME_PATTERN =") }
            val pattern = line.substringAfter("= /").substringBeforeLast("/;")
            assertEquals(AppInventoryLimits.PACKAGE_PATTERN, pattern)
        }
    }

    @Test
    fun `the endpoint the app calls exists as an Edge Function`() {
        assertEquals("device-usage", UsageRepository.ENDPOINT)
        assertTrue(File(RepoFiles.root(), "supabase/functions/${UsageRepository.ENDPOINT}/handler.ts").exists())
    }

    @Test
    fun `the WorkManager period equals the contract interval and the job names are fixed`() {
        val scheduler = RepoFiles.read("$kt/work/WorkScheduler.kt")
        assertTrue(
            scheduler.contains("PeriodicWorkRequestBuilder<UsageWorker>(UsageLimits.INTERVAL_HOURS, TimeUnit.HOURS)"),
        )
        assertTrue(scheduler.contains("const val USAGE_WORK = \"usage\""))
        assertTrue(scheduler.contains("const val USAGE_NOW_WORK = \"usage-now\""))
    }

    @Test
    fun `the manifest and the merged-manifest allow-list agree on Usage Access`() {
        val manifest = RepoFiles.read("apps/android/app/src/main/AndroidManifest.xml")
        val gradle = RepoFiles.read("apps/android/app/build.gradle.kts")
        val declared = RepoFiles.declaredPermissions(manifest)
        assertEquals(
            setOf("INTERNET", "ACCESS_NETWORK_STATE", "RECEIVE_BOOT_COMPLETED", "PACKAGE_USAGE_STATS"),
            declared,
        )
        assertTrue(gradle.contains("\"android.permission.PACKAGE_USAGE_STATS\""))
        val allowList = Regex("\"android\\.permission\\.(\\w+)\"").findAll(gradle)
            .map { it.groupValues[1] }.toSet()
        assertTrue(declared.all { it in allowList })
        val ignored = Regex("PACKAGE_USAGE_STATS\"\\s*tools:ignore=\"ProtectedPermissions\"")
        assertEquals(1, ignored.findAll(manifest).count())
    }

    @Test
    fun `usage code adds no credential header, no logging and no identifier or content APIs`() {
        val files = listOf(
            "data/UsageRepository.kt",
            "data/UsageHttpMapper.kt",
            "data/UsageDtos.kt",
            "data/UsageReportStore.kt",
            "data/UsageAccessStore.kt",
            "data/AndroidUsageStatsSource.kt",
            "domain/UsageStats.kt",
            "domain/UsageDisplay.kt",
            "work/UsageRunner.kt",
            "work/UsageWorker.kt",
            "ui/permissions/UsageAccessSettings.kt",
        )
        val logCall = Regex("""\b(Log\.[a-z]\(|println\(|Timber\.|printStackTrace\()""")
        val banned = listOf(
            "QUERY_ALL_PACKAGES", "ANDROID_ID", "IMEI", "getSerial", "Build.SERIAL", "AdvertisingId",
            "getLastKnownLocation", "getInstalledPackages", "getInstalledApplications", "AccessibilityService",
            "NotificationListenerService", "BroadcastReceiver", "queryUsageStats", "queryAndAggregateUsageStats",
            "queryEventsForSelf", "className", "shortcutId", "notificationChannelId", "getExtras", "appStandbyBucket",
            "setMode(", "appops", "pm grant",
        )
        for (name in files) {
            val source = RepoFiles.read("$kt/$name")
            assertFalse(source.contains("bearerAuth(") || source.contains("Authorization"), name)
            assertFalse(logCall.containsMatchIn(source), name)
            for (word in banned) {
                assertFalse(source.contains(word), "$name uses $word")
            }
        }
    }

    @Test
    fun `only the Android source touches UsageStatsManager and it keeps five event types`() {
        val source = RepoFiles.read("$kt/data/AndroidUsageStatsSource.kt")
        assertTrue(source.contains("UsageStatsManager"))
        assertTrue(source.contains("queryEvents"))
        for (type in listOf(
            "ACTIVITY_RESUMED",
            "ACTIVITY_PAUSED",
            "SCREEN_INTERACTIVE",
            "SCREEN_NON_INTERACTIVE",
            "KEYGUARD_HIDDEN",
        )) {
            assertTrue(source.contains("UsageEvents.Event.$type"), type)
        }
        assertTrue(source.contains("event.packageName"))
        assertTrue(source.contains("event.timeStamp"))
        val others = File(RepoFiles.root(), kt).walkTopDown()
            .filter { it.isFile && it.extension == "kt" && it.name != "AndroidUsageStatsSource.kt" }
            .filter { it.readText().contains("UsageStatsManager") }
            .map { it.name }
            .toList()
        assertEquals(emptyList<String>(), others)
    }

    @Test
    fun `the app only opens the settings page and never grants Usage Access itself`() {
        val settings = RepoFiles.read("$kt/ui/permissions/UsageAccessSettings.kt")
        assertTrue(settings.contains("Settings.ACTION_USAGE_ACCESS_SETTINGS"))
        assertFalse(settings.contains("ACTION_MANAGE_OVERLAY_PERMISSION"))
        assertFalse(settings.contains("requestPermissions"))
        val probe = RepoFiles.read("$kt/data/AndroidUsageStatsSource.kt")
        assertTrue(probe.contains("unsafeCheckOpNoThrow"))
        assertFalse(probe.contains("setMode"))
    }
}
