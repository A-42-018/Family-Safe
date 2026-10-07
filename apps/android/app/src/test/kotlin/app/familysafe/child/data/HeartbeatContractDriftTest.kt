package app.familysafe.child.data

import app.familysafe.child.domain.HeartbeatLimits
import app.familysafe.child.domain.NetworkType
import app.familysafe.child.testutil.RepoFiles
import java.io.File
import org.junit.jupiter.api.Assertions.assertEquals
import org.junit.jupiter.api.Assertions.assertFalse
import org.junit.jupiter.api.Assertions.assertTrue
import org.junit.jupiter.api.Test

/** Fails when the Android wire format and `packages/contracts/src/heartbeat.ts` (and its Edge mirror) drift apart. */
class HeartbeatContractDriftTest {
    private val ts = RepoFiles.read("packages/contracts/src/heartbeat.ts")
    private val edge = RepoFiles.read("supabase/functions/_shared/heartbeat.ts")
    private val kt = "apps/android/app/src/main/kotlin/app/familysafe/child"
    private val dtoSource = RepoFiles.read("$kt/data/HeartbeatDtos.kt")

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

    @Test
    fun `request DTO has exactly the fields of heartbeatRequestSchema`() {
        val contract = keysOf(schemaBody(ts, "heartbeatRequestSchema"))
        assertEquals(setOf("app_version", "android_version", "battery_level", "is_charging", "network_type"), contract)
        assertEquals(contract, serialNames("HeartbeatRequestDto"))
        assertEquals(contract, keysOf(schemaBody(edge, "HeartbeatSchema")))
    }

    @Test
    fun `response DTO covers the fields the app reads from heartbeatResponseSchema`() {
        val contract = keysOf(schemaBody(ts, "heartbeatResponseSchema"))
        assertEquals(setOf("server_time", "next_interval_seconds"), contract)
        assertEquals(contract, serialNames("HeartbeatDataDto"))
    }

    @Test
    fun `network type wire names equal NETWORK_TYPES`() {
        val list = Regex("""NETWORK_TYPES\s*=\s*\[([^\]]+)]""").find(ts)!!.groupValues[1]
        val names = Regex(""""([A-Z]+)"""").findAll(list).map { it.groupValues[1] }.toList()
        assertEquals(names, NetworkType.entries.map { it.wire })
    }

    @Test
    fun `limits and interval match the contract`() {
        assertTrue(ts.contains(".max(${HeartbeatLimits.VERSION_MAX})"))
        assertTrue(ts.contains(".min(${HeartbeatLimits.BATTERY_MIN})"))
        assertTrue(ts.contains(".max(${HeartbeatLimits.BATTERY_MAX})"))
        val seconds = Regex("""HEARTBEAT_INTERVAL_SECONDS\s*=\s*(\d+)""").find(ts)!!.groupValues[1].toLong()
        assertEquals(seconds, HeartbeatLimits.INTERVAL_MINUTES * 60)
    }

    @Test
    fun `the endpoint the app calls exists as an Edge Function`() {
        assertTrue(File(RepoFiles.root(), "supabase/functions/${HeartbeatRepository.ENDPOINT}/handler.ts").exists())
    }

    @Test
    fun `heartbeat code adds no credential header, no logging and no forbidden identifiers`() {
        val files = listOf(
            "data/HeartbeatRepository.kt",
            "data/HeartbeatHttpMapper.kt",
            "data/HeartbeatDtos.kt",
            "data/AndroidHeartbeatPayloadSource.kt",
            "work/HeartbeatRunner.kt",
            "work/HeartbeatWorker.kt",
        )
        val logCall = Regex("""\b(Log\.[a-z]\(|println\(|Timber\.|printStackTrace\()""")
        for (name in files) {
            val source = RepoFiles.read("$kt/$name")
            assertFalse(source.contains("bearerAuth(") || source.contains("Authorization"), name)
            assertFalse(logCall.containsMatchIn(source), name)
            // Only public Build/BatteryManager/Connectivity data: none of the hardware-identifier APIs.
            val banned =
                listOf("ANDROID_ID", "IMEI", "getSerial", "Build.SERIAL", "AdvertisingId", "getLastKnownLocation")
            for (word in banned) {
                assertFalse(source.contains(word), "$name uses $word")
            }
        }
    }

    @Test
    fun `the merged-manifest allow-list and the app manifest agree on the new permission`() {
        val gradle = RepoFiles.read("apps/android/app/build.gradle.kts")
        val manifest = RepoFiles.read("apps/android/app/src/main/AndroidManifest.xml")
        assertTrue(gradle.contains("android.permission.RECEIVE_BOOT_COMPLETED"))
        assertTrue("RECEIVE_BOOT_COMPLETED" in RepoFiles.declaredPermissions(manifest))
        for (still in listOf("WAKE_LOCK", "FOREGROUND_SERVICE", "FOREGROUND_SERVICE_DATA_SYNC")) {
            assertTrue(manifest.contains("android.permission.$still\" tools:node=\"remove\""), still)
            assertFalse(gradle.contains("android.permission.$still"), still)
        }
    }
}
