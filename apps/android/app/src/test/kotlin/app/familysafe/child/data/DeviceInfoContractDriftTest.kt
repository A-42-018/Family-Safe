package app.familysafe.child.data

import app.familysafe.child.domain.DeviceDetailsLimits
import app.familysafe.child.testutil.RepoFiles
import java.io.File
import org.junit.jupiter.api.Assertions.assertEquals
import org.junit.jupiter.api.Assertions.assertFalse
import org.junit.jupiter.api.Assertions.assertTrue
import org.junit.jupiter.api.Test

/** Fails when the Android wire format and `packages/contracts/src/device-info.ts` (and its Edge mirror) drift apart. */
class DeviceInfoContractDriftTest {
    private val ts = RepoFiles.read("packages/contracts/src/device-info.ts")
    private val edge = RepoFiles.read("supabase/functions/_shared/device-info.ts")
    private val kt = "apps/android/app/src/main/kotlin/app/familysafe/child"
    private val dtoSource = RepoFiles.read("$kt/data/DeviceInfoDtos.kt")

    private fun schemaBody(source: String, name: String): String {
        val start = source.indexOf("export const $name")
        check(start >= 0) { "schema $name not found" }
        val end = source.indexOf("})", start).let { if (it < 0) source.length else it }
        return source.substring(start, end)
    }

    private fun keysOf(body: String): Set<String> = Regex("""(?:^|[{,])\s*([a-z_]+):\s*z\.""", RegexOption.MULTILINE)
        .findAll(body).map { it.groupValues[1] }.toSet()

    private fun serialNames(className: String): Set<String> {
        val start = dtoSource.indexOf("class $className")
        val end = dtoSource.indexOf("\n)", start)
        return Regex("""@SerialName\("([a-z_]+)"\)""").findAll(dtoSource.substring(start, end))
            .map { it.groupValues[1] }.toSet()
    }

    private fun number(source: String, name: String): Long =
        Regex("""$name\s*=\s*(\d+)""").find(source)!!.groupValues[1].toLong()

    @Test
    fun `request DTO has exactly the fields of deviceInfoRequestSchema`() {
        val contract = keysOf(schemaBody(ts, "deviceInfoRequestSchema"))
        assertEquals(
            setOf("sdk_level", "security_patch", "storage_total_mb", "storage_free_mb", "managed_mode"),
            contract,
        )
        assertEquals(contract, serialNames("DeviceInfoRequestDto"))
        assertEquals(contract, keysOf(schemaBody(edge, "DeviceInfoSchema")))
    }

    @Test
    fun `nullable fields are exactly the ones the contract allows to be null`() {
        val body = schemaBody(ts, "deviceInfoRequestSchema")
        val nullable = Regex("""([a-z_]+):[^\n]*\.nullable\(\)""").findAll(body).map { it.groupValues[1] }.toSet()
        assertEquals(setOf("security_patch", "storage_total_mb", "storage_free_mb"), nullable)
        val dtoNullable = Regex("""val (\w+): (?:String|Long)\?""").findAll(dtoSource).count()
        assertEquals(nullable.size, dtoNullable)
    }

    @Test
    fun `the encoder keeps explicit nulls because every key is required`() {
        assertTrue(dtoSource.contains("explicitNulls = true"))
        assertFalse(dtoSource.contains("explicitNulls = false"))
    }

    @Test
    fun `response DTO covers the fields the app reads from deviceInfoResponseSchema`() {
        val contract = keysOf(schemaBody(ts, "deviceInfoResponseSchema"))
        assertEquals(setOf("server_time", "next_interval_seconds"), contract)
        assertEquals(contract, serialNames("DeviceInfoDataDto"))
    }

    @Test
    fun `limits, ceiling, minimum patch date and interval match the contract`() {
        assertEquals(number(ts, "SDK_LEVEL_MIN"), DeviceDetailsLimits.SDK_MIN.toLong())
        assertEquals(number(ts, "SDK_LEVEL_MAX"), DeviceDetailsLimits.SDK_MAX.toLong())
        assertEquals(number(ts, "STORAGE_MB_MAX"), DeviceDetailsLimits.STORAGE_MB_MAX)
        assertEquals(number(edge, "STORAGE_MB_MAX"), DeviceDetailsLimits.STORAGE_MB_MAX)
        assertTrue(ts.contains("SECURITY_PATCH_MIN = \"${DeviceDetailsLimits.SECURITY_PATCH_MIN}\""))
        assertEquals(number(ts, "DEVICE_INFO_INTERVAL_SECONDS"), DeviceDetailsLimits.INTERVAL_HOURS * 3600)
        assertEquals(number(edge, "DEVICE_INFO_INTERVAL_SECONDS"), DeviceDetailsLimits.INTERVAL_HOURS * 3600)
    }

    @Test
    fun `the endpoint the app calls exists as an Edge Function`() {
        assertTrue(File(RepoFiles.root(), "supabase/functions/${DeviceInfoRepository.ENDPOINT}/handler.ts").exists())
    }

    @Test
    fun `device info code adds no credential header, no logging and no forbidden identifiers`() {
        val files = listOf(
            "data/DeviceInfoRepository.kt",
            "data/DeviceInfoHttpMapper.kt",
            "data/DeviceInfoDtos.kt",
            "data/DeviceInfoReportStore.kt",
            "data/AndroidDeviceDetailsSource.kt",
            "domain/DeviceDetails.kt",
            "work/DeviceInfoRunner.kt",
            "work/DeviceInfoWorker.kt",
        )
        val logCall = Regex("""\b(Log\.[a-z]\(|println\(|Timber\.|printStackTrace\()""")
        val banned = listOf(
            "ANDROID_ID", "IMEI", "getSerial", "Build.SERIAL", "AdvertisingId", "getLastKnownLocation",
            "getInstalledPackages", "getInstalledApplications", "MemoryInfo", "WifiInfo", "getMacAddress",
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
    fun `the manifest still asks for no permission that device info would need`() {
        val manifest = RepoFiles.read("apps/android/app/src/main/AndroidManifest.xml")
        val declared = RepoFiles.declaredPermissions(manifest)
        assertEquals(
            setOf("INTERNET", "ACCESS_NETWORK_STATE", "RECEIVE_BOOT_COMPLETED", "PACKAGE_USAGE_STATS"),
            declared,
        )
    }
}
