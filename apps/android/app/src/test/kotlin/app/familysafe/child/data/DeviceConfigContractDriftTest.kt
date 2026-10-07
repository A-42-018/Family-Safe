package app.familysafe.child.data

import app.familysafe.child.domain.ScheduleLimits
import app.familysafe.child.domain.ScheduleType
import app.familysafe.child.domain.ScreenTimeConfig
import app.familysafe.child.domain.ScreenTimeLimits
import app.familysafe.child.domain.TimezoneName
import app.familysafe.child.testutil.RepoFiles
import java.io.File
import org.junit.jupiter.api.Assertions.assertEquals
import org.junit.jupiter.api.Assertions.assertFalse
import org.junit.jupiter.api.Assertions.assertTrue
import org.junit.jupiter.api.Test

/** Fails when the Android reading of `device-config` drifts from the contracts file or its Edge mirror. */
class DeviceConfigContractDriftTest {
    private val ts = RepoFiles.read("packages/contracts/src/device-config.ts")
    private val edge = RepoFiles.read("supabase/functions/_shared/device-config.ts")
    private val handler = RepoFiles.read("supabase/functions/device-config/handler.ts")
    private val kt = "apps/android/app/src/main/kotlin/app/familysafe/child"
    private val dtoSource = RepoFiles.read("$kt/data/DeviceConfigDtos.kt")

    private fun schemaBody(source: String, name: String): String {
        val start = source.indexOf("export const $name")
        check(start >= 0) { "schema $name not found" }
        val end = source.indexOf("})", start).let { if (it < 0) source.length else it }
        return source.substring(start, end)
    }

    private fun keysOf(body: String): Set<String> = Regex(
        """(?:^|[{,])\s*([a-z_]+):\s*(?:z\.|hhmm|limitMinutes|dayLimitOverridesSchema|timezoneSchema)""",
        RegexOption.MULTILINE,
    )
        .findAll(body).map { it.groupValues[1] }.toSet()

    private fun serialNames(className: String): Set<String> {
        val start = dtoSource.indexOf("class $className")
        val end = dtoSource.indexOf("\n) {", start).let { if (it < 0) dtoSource.indexOf("\n)", start) else it }
        return Regex("""@SerialName\("([a-z_]+)"\)""").findAll(dtoSource.substring(start, end))
            .map { it.groupValues[1] }.toSet()
    }

    private fun number(source: String, name: String): Long =
        Regex("""$name\s*=\s*([\d_]+)""").find(source)!!.groupValues[1].replace("_", "").toLong()

    @Test
    fun `data DTO has exactly the fields of deviceConfigSchema`() {
        val contract = keysOf(schemaBody(ts, "deviceConfigSchema"))
        assertEquals(
            setOf(
                "config_version", "daily_limit_minutes", "daily_limit_overrides", "bedtime_enabled", "bedtime_start",
                "bedtime_end", "school_mode_enabled", "app_rules", "timezone", "schedules", "server_time",
                "next_interval_seconds",
            ),
            contract,
        )
        // The legacy bedtime/school keys stay on the wire until Phase 19d-1; the app no longer reads them
        // (ignoreUnknownKeys). Remove LEGACY in 19d-1 together with the contract keys.
        val legacy = setOf("bedtime_enabled", "bedtime_start", "bedtime_end", "school_mode_enabled")
        assertEquals(contract - legacy, serialNames("DeviceConfigDataDto"))
        val scheduleBody = ts.substring(ts.indexOf("export const scheduleSchema")).substringBefore(".strict()")
        for (key in serialNames("ScheduleDto")) assertTrue(Regex("""\b$key:""").containsMatchIn(scheduleBody), key)
        assertEquals(setOf("id", "name", "type", "days", "start_time", "end_time"), serialNames("ScheduleDto"))
    }

    @Test
    fun `nullable fields are exactly the ones the contract allows to be null`() {
        val body = schemaBody(ts, "deviceConfigSchema")
        val nullable = Regex("""([a-z_]+):[^\n]*\.nullable\(\)""").findAll(body).map { it.groupValues[1] }.toSet()
        assertEquals(setOf("daily_limit_minutes", "bedtime_start", "bedtime_end", "timezone"), nullable)
        val dtoNullable = Regex(
            """val (\w+): (?:String|Int)\?""",
        ).findAll(dtoSource.substringAfter("class DeviceConfigDataDto")).count()
        assertEquals(nullable.size - 2, dtoNullable) // the two legacy bedtime times are not read (until 19d-1)
    }

    @Test
    fun `schedule limits and the time zone format match the contract`() {
        assertEquals(ScheduleLimits.MAX.toLong(), number(ts, "SCHEDULES_MAX"))
        assertEquals(ScheduleLimits.NAME_MAX.toLong(), number(ts, "SCHEDULE_NAME_MAX"))
        assertEquals(ScheduleLimits.MINUTES_PER_DAY.toLong(), number(ts, "MINUTES_PER_DAY"))
        assertEquals(ScheduleLimits.MINUTES_PER_WEEK.toLong(), number(ts, "MINUTES_PER_WEEK"))
        val types = Regex("""SCHEDULE_TYPES = \[([^\]]+)]""").find(ts)!!.groupValues[1]
            .split(",").map { it.trim().trim('"') }
        assertEquals(types, ScheduleType.entries.map { it.name })
        val pattern = Regex("""TIMEZONE_NAME_PATTERN = /(.+)/;""").find(ts)!!.groupValues[1]
        assertEquals(pattern, TimezoneName.PATTERN_SOURCE)
        assertTrue(ts.contains("value.length <= 64"))
        assertEquals(64, TimezoneName.MAX_LENGTH)
    }

    @Test
    fun `a missing key stays an error because nulls are explicit and the DTO has no defaults`() {
        assertTrue(dtoSource.contains("explicitNulls = true"))
        assertFalse(dtoSource.contains("explicitNulls = false"))
        val dto = dtoSource.substringAfter("class DeviceConfigDataDto").substringBefore("\n) {")
        assertFalse(dto.contains(" = "), "DeviceConfigDataDto must have no default values")
    }

    @Test
    fun `the contract schema is strict, so the Edge sends no key the app does not know`() {
        val start = ts.indexOf("export const deviceConfigSchema")
        val strictAt = ts.indexOf(".strict()", start)
        val refineAt = ts.indexOf("superRefine", start)
        assertTrue(strictAt in start until refineAt)
        assertTrue(handler.contains("server_time") && handler.contains("next_interval_seconds"))
    }

    @Test
    fun `interval, day limit maximum and etag version ceiling match the contract and the Edge mirror`() {
        assertEquals(number(ts, "DEVICE_CONFIG_INTERVAL_SECONDS"), ScreenTimeLimits.INTERVAL_SECONDS)
        assertEquals(number(edge, "DEVICE_CONFIG_INTERVAL_SECONDS"), ScreenTimeLimits.INTERVAL_SECONDS)
        assertEquals(number(ts, "DAILY_LIMIT_MAX_MINUTES"), ScreenTimeLimits.MAX_MINUTES.toLong())
        assertEquals(number(ts, "CONFIG_ETAG_MAX_VERSION"), ScreenTimeLimits.MAX_VERSION.toLong())
    }

    @Test
    fun `weekdays are ISO 1 to 7 in the contract and in the parser`() {
        assertTrue(ts.contains("ISO_WEEKDAYS = [1, 2, 3, 4, 5, 6, 7]"))
        for (day in 1..7) assertTrue(ts.contains("\"$day\": limitMinutes.optional()"), "day $day")
        assertEquals(7, ScreenTimeConfig.ISO_WEEKDAYS)
    }

    @Test
    fun `the effective limit rule is the contract's rule`() {
        // The contract: an override beats the default; absent override = default.
        // Pinned by text here and by cases in ScreenTimeConfigTest.
        assertTrue(ts.contains("override !== undefined ? override : config.daily_limit_minutes"))
    }

    @Test
    fun `the etag the app sends is the etag the server builds and parses`() {
        assertTrue(ts.contains("return `\"v\${version}\"`;"))
        assertTrue(edge.contains("return `\"v\${version}\"`;"))
        assertEquals("\"v7\"", ScreenTimeConfig.etagFor(7))
        assertTrue(handler.contains("req.headers.get(\"if-none-match\")"))
        assertTrue(handler.contains("status: 304"))
        assertTrue(ts.contains("[1-9][0-9]{0,8}"))
    }

    @Test
    fun `the endpoint is a GET-only Edge Function the app can reach`() {
        assertTrue(File(RepoFiles.root(), "supabase/functions/${DeviceConfigRepository.ENDPOINT}/handler.ts").exists())
        assertTrue(handler.contains("req.method !== \"GET\""))
        assertTrue(RepoFiles.read("$kt/data/KtorDeviceHttp.kt").contains("HttpHeaders.IfNoneMatch"))
    }

    @Test
    fun `rules code adds no credential header, no logging, no identifiers and applies nothing yet`() {
        val files = listOf(
            "data/DeviceConfigRepository.kt",
            "data/DeviceConfigHttpMapper.kt",
            "data/DeviceConfigDtos.kt",
            "data/DeviceConfigStore.kt",
            "domain/ScreenTimeConfig.kt",
            "work/DeviceConfigRunner.kt",
            "work/DeviceConfigWorker.kt",
            "ui/devicestatus/ScreenTimeFormat.kt",
        )
        val logCall = Regex("""\b(Log\.[a-z]\(|println\(|Timber\.|printStackTrace\()""")
        val banned = listOf(
            "ANDROID_ID", "IMEI", "getSerial", "Build.SERIAL", "AdvertisingId", "getLastKnownLocation",
            "getInstalledPackages", "UsageStatsManager", "AccessibilityService", "DevicePolicyManager",
            "SYSTEM_ALERT_WINDOW", "killBackgroundProcesses",
        )
        for (name in files) {
            val source = RepoFiles.read("$kt/$name")
            assertFalse(source.contains("bearerAuth(") || source.contains("Authorization"), name)
            assertFalse(logCall.containsMatchIn(source), name)
            for (word in banned) assertFalse(source.contains(word), "$name uses $word")
        }
    }

    @Test
    fun `the pull sends no body and no identifier`() {
        val repo = RepoFiles.read("$kt/data/DeviceConfigRepository.kt")
        assertFalse(repo.contains("postJson"))
        assertFalse(repo.contains("device_id"))
        assertTrue(repo.contains("getJson(ENDPOINT, cached?.etag())"))
    }

    @Test
    fun `job names and period are what the scheduler registers`() {
        val scheduler = RepoFiles.read("$kt/work/WorkScheduler.kt")
        assertTrue(scheduler.contains("DEVICE_CONFIG_WORK = \"device-config\""))
        assertTrue(scheduler.contains("DEVICE_CONFIG_NOW_WORK = \"device-config-now\""))
        assertTrue(
            scheduler.contains(
                "PeriodicWorkRequestBuilder<DeviceConfigWorker>(ScreenTimeLimits.INTERVAL_HOURS, TimeUnit.HOURS)",
            ),
        )
        assertEquals(ScreenTimeLimits.INTERVAL_SECONDS, ScreenTimeLimits.INTERVAL_HOURS * 3600)
    }

    @Test
    fun `the manifest still asks for no permission that rules would need`() {
        val manifest = RepoFiles.read("apps/android/app/src/main/AndroidManifest.xml")
        assertEquals(
            setOf("INTERNET", "ACCESS_NETWORK_STATE", "RECEIVE_BOOT_COMPLETED", "PACKAGE_USAGE_STATS"),
            RepoFiles.declaredPermissions(manifest),
        )
    }
}
