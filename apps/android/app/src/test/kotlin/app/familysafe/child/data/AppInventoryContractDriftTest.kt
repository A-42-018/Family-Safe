package app.familysafe.child.data

import app.familysafe.child.domain.AppInventoryLimits
import app.familysafe.child.testutil.RepoFiles
import java.io.File
import org.junit.jupiter.api.Assertions.assertEquals
import org.junit.jupiter.api.Assertions.assertFalse
import org.junit.jupiter.api.Assertions.assertTrue
import org.junit.jupiter.api.Test

/** Fails when the Android wire format and `packages/contracts/src/device-apps.ts` (and its Edge mirror) drift apart. */
class AppInventoryContractDriftTest {
    private val ts = RepoFiles.read("packages/contracts/src/device-apps.ts")
    private val edge = RepoFiles.read("supabase/functions/_shared/device-apps.ts")
    private val kt = "apps/android/app/src/main/kotlin/app/familysafe/child"
    private val dtoSource = RepoFiles.read("$kt/data/AppInventoryDtos.kt")

    private fun schemaBody(source: String, name: String): String {
        val start = source.indexOf("export const $name")
        check(start >= 0) { "schema $name not found" }
        val end = source.indexOf("})", start).let { if (it < 0) source.length else it }
        return source.substring(start, end)
    }

    private fun keysOf(body: String): Set<String> =
        Regex("""(?:^|[{,])\s*([a-z_]+):\s*z\.""", RegexOption.MULTILINE)
            .findAll(body).map { it.groupValues[1] }.toSet()

    private fun serialNames(className: String): Set<String> {
        val start = dtoSource.indexOf("class $className")
        check(start >= 0) { "class $className not found" }
        val end = dtoSource.indexOf("\n)", start)
        return Regex("""@SerialName\("([a-z_]+)"\)""").findAll(dtoSource.substring(start, end))
            .map { it.groupValues[1] }.toSet()
    }

    private fun number(source: String, name: String): Long =
        Regex("""$name\s*=\s*(\d+)""").find(source)!!.groupValues[1].toLong()

    @Test
    fun `entry DTO has exactly the four keys of deviceAppSchema`() {
        val contract = keysOf(schemaBody(ts, "deviceAppSchema"))
        assertEquals(setOf("package_name", "label", "version_name", "is_system"), contract)
        assertEquals(contract, serialNames("AppInventoryEntryDto"))
        assertEquals(contract, keysOf(schemaBody(edge, "DeviceAppSchema")))
    }

    @Test
    fun `request DTO has exactly the apps key of deviceAppsRequestSchema`() {
        assertEquals(setOf("apps"), serialNames("AppInventoryRequestDto"))
        assertTrue(ts.contains("apps: z"))
        assertTrue(edge.contains("apps: z"))
    }

    @Test
    fun `only the version is nullable, in the contract, the mirror and the DTO`() {
        for (source in listOf(ts, edge)) {
            val nullable = Regex("""([a-z_]+):[^\n]*\.nullable\(\)""").findAll(source).map { it.groupValues[1] }.toSet()
            assertEquals(setOf("version_name"), nullable)
        }
        val dtoNullable = Regex("""val (\w+): (?:String|Long|Int|Boolean)\?""")
            .findAll(dtoSource).map { it.groupValues[1] }.toSet()
        assertEquals(setOf("versionName"), dtoNullable)
    }

    @Test
    fun `the encoder keeps explicit nulls because every key is required`() {
        assertTrue(dtoSource.contains("explicitNulls = true"))
        assertFalse(dtoSource.contains("explicitNulls = false"))
    }

    @Test
    fun `response DTO covers the fields the app reads from deviceAppsResponseSchema`() {
        val contract = keysOf(schemaBody(ts, "deviceAppsResponseSchema"))
        assertEquals(setOf("server_time", "next_interval_seconds"), contract)
        assertEquals(contract, serialNames("AppInventoryDataDto"))
    }

    @Test
    fun `limits, body cap and interval match the contract and the Edge mirror`() {
        for (source in listOf(ts, edge)) {
            assertEquals(number(source, "DEVICE_APPS_MAX"), AppInventoryLimits.MAX_APPS.toLong())
            assertEquals(number(source, "DEVICE_APPS_PACKAGE_MAX"), AppInventoryLimits.PACKAGE_MAX.toLong())
            assertEquals(number(source, "DEVICE_APPS_LABEL_MAX"), AppInventoryLimits.LABEL_MAX.toLong())
            assertEquals(number(source, "DEVICE_APPS_VERSION_MAX"), AppInventoryLimits.VERSION_MAX.toLong())
            assertEquals(number(source, "DEVICE_APPS_MAX_BODY_BYTES"), AppInventoryLimits.MAX_BODY_BYTES.toLong())
            assertEquals(number(source, "DEVICE_APPS_INTERVAL_SECONDS"), AppInventoryLimits.INTERVAL_HOURS * 3600)
        }
    }

    @Test
    fun `the package pattern is the same text in Kotlin, the contract and the mirror`() {
        for (source in listOf(ts, edge)) {
            val line = source.lines().first { it.contains("PACKAGE_NAME_PATTERN =") }
            val pattern = line.substringAfter("= /").substringBeforeLast("/;")
            assertEquals(AppInventoryLimits.PACKAGE_PATTERN, pattern)
        }
    }

    @Test
    fun `control characters are the same class the contract rejects`() {
        val sanitizer = RepoFiles.read("$kt/domain/AppInventory.kt")
        val contractClass = Regex("""CONTROL_CHARS = /(\[[^/]+\])/""").find(ts)!!.groupValues[1]
        assertEquals("[\\u0000-\\u001f\\u007f-\\u009f]", contractClass)
        assertTrue(sanitizer.contains("""Regex("[\\\\u0000-\\\\u001f\\\\u007f-\\\\u009f]")"""))
    }

    @Test
    fun `the endpoint the app calls exists as an Edge Function`() {
        assertTrue(File(RepoFiles.root(), "supabase/functions/${AppInventoryRepository.ENDPOINT}/handler.ts").exists())
    }

    @Test
    fun `the WorkManager period equals the contract interval`() {
        val scheduler = RepoFiles.read("$kt/work/WorkScheduler.kt")
        assertTrue(scheduler.contains("AppInventoryLimits.INTERVAL_HOURS, TimeUnit.HOURS"))
        assertTrue(scheduler.contains("const val APP_INVENTORY_WORK = \"app-inventory\""))
        assertTrue(scheduler.contains("const val APP_INVENTORY_NOW_WORK = \"app-inventory-now\""))
    }

    @Test
    fun `app inventory code adds no credential header, no logging and no forbidden APIs`() {
        val files = listOf(
            "data/AppInventoryRepository.kt",
            "data/AppInventoryHttpMapper.kt",
            "data/AppInventoryDtos.kt",
            "data/AppInventoryReportStore.kt",
            "data/AndroidInstalledAppsSource.kt",
            "domain/AppInventory.kt",
            "work/AppInventoryRunner.kt",
            "work/AppInventoryWorker.kt",
            "ui/devicestatus/AppInventoryFormat.kt",
        )
        val logCall = Regex("""\b(Log\.[a-z]\(|println\(|Timber\.|printStackTrace\()""")
        val banned = listOf(
            "QUERY_ALL_PACKAGES", "ANDROID_ID", "IMEI", "getSerial", "Build.SERIAL", "AdvertisingId",
            "getLastKnownLocation", "getInstalledPackages", "getInstalledApplications", "getPackageSizeInfo",
            "UsageStatsManager", "firstInstallTime", "lastUpdateTime", "loadIcon", "signingInfo", "signatures",
            "longVersionCode", "versionCode", "getApplicationIcon", "AccessibilityService",
            "NotificationListenerService", "PACKAGE_ADDED", "PACKAGE_REMOVED", "BroadcastReceiver",
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
    fun `the source reads launchable apps only, with no extra permission`() {
        val source = RepoFiles.read("$kt/data/AndroidInstalledAppsSource.kt")
        assertTrue(source.contains("queryIntentActivities"))
        assertTrue(source.contains("Intent.ACTION_MAIN"))
        assertTrue(source.contains("Intent.CATEGORY_LAUNCHER"))
        assertTrue(source.contains("FLAG_SYSTEM"))
    }

    @Test
    fun `the manifest permission allow-list is unchanged and only a launcher query was added`() {
        val manifest = RepoFiles.read("apps/android/app/src/main/AndroidManifest.xml")
        val declared = RepoFiles.declaredPermissions(manifest)
        assertEquals(setOf("INTERNET", "ACCESS_NETWORK_STATE", "RECEIVE_BOOT_COMPLETED", "PACKAGE_USAGE_STATS"), declared)
        assertFalse(manifest.contains("QUERY_ALL_PACKAGES"))
        val queries = Regex("""<queries>(.*?)</queries>""", RegexOption.DOT_MATCHES_ALL).findAll(manifest).toList()
        assertEquals(1, queries.size)
        val body = queries.single().groupValues[1]
        assertEquals(1, Regex("""<intent>""").findAll(body).count())
        assertEquals(1, Regex("""<action android:name="android\.intent\.action\.MAIN"\s*/>""").findAll(body).count())
        assertEquals(
            1,
            Regex("""<category android:name="android\.intent\.category\.LAUNCHER"\s*/>""").findAll(body).count(),
        )
        assertFalse(body.contains("<package"))
        assertFalse(body.contains("<provider"))
    }

    @Test
    fun `the app-list upload reads nothing but the four contract fields`() {
        val source = RepoFiles.read("$kt/data/AndroidInstalledAppsSource.kt")
        assertTrue(source.contains("packageName"))
        assertTrue(source.contains("loadLabel"))
        assertTrue(source.contains("versionName"))
        assertFalse(source.contains("loadIcon"))
    }
}
