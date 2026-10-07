package app.familysafe.child.data

import app.familysafe.child.domain.PermissionCatalog
import app.familysafe.child.domain.PermissionKey
import app.familysafe.child.domain.PermissionState
import app.familysafe.child.domain.PermissionSyncLimits
import app.familysafe.child.testutil.RepoFiles
import java.io.File
import org.junit.jupiter.api.Assertions.assertEquals
import org.junit.jupiter.api.Assertions.assertFalse
import org.junit.jupiter.api.Assertions.assertTrue
import org.junit.jupiter.api.Test

/** Fails when the Android wire format and `packages/contracts/src/permissions.ts` (and its Edge mirror) drift apart. */
class PermissionSyncContractDriftTest {
    private val ts = RepoFiles.read("packages/contracts/src/permissions.ts")
    private val edge = RepoFiles.read("supabase/functions/_shared/permissions.ts")
    private val kt = "apps/android/app/src/main/kotlin/app/familysafe/child"
    private val dtoSource = RepoFiles.read("$kt/data/PermissionSyncDtos.kt")
    private val strings = RepoFiles.read("apps/android/app/src/main/res/values/strings.xml")

    private fun constList(source: String, name: String): List<String> {
        val start = source.indexOf("export const $name")
        check(start >= 0) { "list $name not found" }
        val end = source.indexOf("] as const", start)
        return Regex("\"([A-Za-z_]+)\"").findAll(source.substring(start, end)).map { it.groupValues[1] }.toList()
    }

    private fun schemaBody(source: String, name: String): String {
        val start = source.indexOf("export const $name")
        check(start >= 0) { "schema $name not found" }
        val end = source.indexOf("})", start).let { if (it < 0) source.length else it }
        return source.substring(start, end)
    }

    private fun keysOf(body: String): Set<String> =
        Regex("""(?:^|[{,])\s*([a-z_]+):\s*(?:z\.|state)""", RegexOption.MULTILINE)
            .findAll(body).map { it.groupValues[1] }.toSet()

    private fun serialNames(className: String): List<String> {
        val start = dtoSource.indexOf("class $className")
        val end = dtoSource.indexOf("\n)", start)
        return Regex("""@SerialName\("([a-z_]+)"\)""").findAll(dtoSource.substring(start, end))
            .map { it.groupValues[1] }.toList()
    }

    private fun number(source: String, name: String): Long =
        Regex("""$name\s*=\s*(\d+)""").find(source)!!.groupValues[1].toLong()

    @Test
    fun `synced catalog keys equal the contract key list, in its order`() {
        val contract = constList(ts, "PERMISSION_KEYS")
        assertEquals(contract, PermissionCatalog.SYNCED.map { it.wireName })
        assertEquals(contract, constList(edge, "PERMISSION_KEYS"))
    }

    @Test
    fun `only synced keys carry a wire name`() {
        val withWireName = PermissionKey.entries.filter { it.wireName != null }
        assertEquals(PermissionCatalog.SYNCED.toSet(), withWireName.toSet())
    }

    @Test
    fun `permission states equal the contract state list`() {
        val contract = constList(ts, "PERMISSION_STATES")
        assertEquals(contract, PermissionState.entries.map { it.name })
        assertEquals(contract, constList(edge, "PERMISSION_STATES"))
    }

    @Test
    fun `request DTO has exactly the keys of permissionSyncRequestSchema, in order`() {
        val contract = keysOf(schemaBody(ts, "permissionSyncRequestSchema"))
        assertEquals(PermissionCatalog.SYNCED.map { it.wireName!! }.toSet(), contract)
        assertEquals(contract, serialNames("PermissionSyncRequestDto").toSet())
        assertEquals(contract, keysOf(schemaBody(edge, "PermissionSyncSchema")))
        assertEquals(PermissionCatalog.SYNCED.size, serialNames("PermissionSyncRequestDto").size)
    }

    @Test
    fun `every request field is a plain required string`() {
        val fields = Regex("""val (\w+): (\w+\??)""").findAll(dtoSource.substringBefore("/** `{ \"data\"")).toList()
        assertEquals(8, fields.size)
        assertTrue(fields.all { it.groupValues[2] == "String" })
    }

    @Test
    fun `response DTO covers the fields the app reads from permissionSyncResponseSchema`() {
        val contract = keysOf(schemaBody(ts, "permissionSyncResponseSchema"))
        assertEquals(setOf("server_time", "next_interval_seconds"), contract)
        assertEquals(contract, serialNames("PermissionSyncDataDto").toSet())
    }

    @Test
    fun `interval matches the contract and the Edge mirror`() {
        assertEquals(number(ts, "PERMISSION_SYNC_INTERVAL_SECONDS"), PermissionSyncLimits.INTERVAL_HOURS * 3600)
        assertEquals(number(edge, "PERMISSION_SYNC_INTERVAL_SECONDS"), PermissionSyncLimits.INTERVAL_HOURS * 3600)
    }

    @Test
    fun `the endpoint the app calls exists as an Edge Function`() {
        val handler = "supabase/functions/${PermissionSyncRepository.ENDPOINT}/handler.ts"
        assertTrue(File(RepoFiles.root(), handler).exists())
    }

    @Test
    fun `permission sync code adds no credential header, no logging and no data-reading APIs`() {
        val files = listOf(
            "data/PermissionSyncRepository.kt",
            "data/PermissionSyncHttpMapper.kt",
            "data/PermissionSyncDtos.kt",
            "data/PermissionStateStore.kt",
            "data/PermissionHistoryStore.kt",
            "data/PermissionStateReader.kt",
            "data/AndroidPermissionProbe.kt",
            "domain/PermissionSync.kt",
            "domain/PermissionCatalog.kt",
            "work/PermissionSyncRunner.kt",
            "work/PermissionSyncWorker.kt",
        )
        val logCall = Regex("""\b(Log\.[a-z]\(|println\(|Timber\.|printStackTrace\()""")
        val banned = listOf(
            "requestPermissions", "ActivityResultContracts", "ContentResolver", "ContactsContract", "Telephony",
            "CallLog", "getLastKnownLocation", "LocationManager", "CameraManager", "AudioRecord", "MediaRecorder",
            "getInstalledPackages", "getInstalledApplications", "ANDROID_ID", "IMEI", "getSerial",
        )
        for (name in files) {
            val source = RepoFiles.read("$kt/$name")
            assertFalse(source.contains("bearerAuth(") || source.contains("Authorization"), name)
            assertFalse(logCall.containsMatchIn(source), name)
            for (word in banned) assertFalse(source.contains(word), "$name uses $word")
        }
    }

    @Test
    fun `the probe only reads grants and never asks`() {
        val source = RepoFiles.read("$kt/data/AndroidPermissionProbe.kt")
        assertTrue(source.contains("checkSelfPermission"))
        assertFalse(source.contains("shouldShowRequestPermissionRationale"))
    }

    @Test
    fun `the manifest still asks for none of the permissions it only reports on`() {
        val manifest = RepoFiles.read("apps/android/app/src/main/AndroidManifest.xml")
        val declared = RepoFiles.declaredPermissions(manifest)
        assertEquals(setOf("INTERNET", "ACCESS_NETWORK_STATE", "RECEIVE_BOOT_COMPLETED", "PACKAGE_USAGE_STATS"), declared)
    }

    @Test
    fun `every state and every permission has child-facing copy`() {
        for (state in PermissionState.entries) {
            val base = "permission_status_${state.name.lowercase()}"
            assertTrue(strings.contains("name=\"$base\""), base)
            assertTrue(strings.contains("name=\"${base}_help\""), "${base}_help")
        }
        val parts = mapOf(
            PermissionKey.LOCATION to "location", PermissionKey.PRECISE_LOCATION to "precise_location",
            PermissionKey.BACKGROUND_LOCATION to "background_location", PermissionKey.CAMERA to "camera",
            PermissionKey.MICROPHONE to "microphone", PermissionKey.CONTACTS to "contacts", PermissionKey.SMS to "sms",
            PermissionKey.CALL_LOG to "call_log", PermissionKey.USAGE_ACCESS to "usage_access",
            PermissionKey.APP_LIST to "app_list", PermissionKey.NOTIFICATIONS to "notifications",
        )
        assertEquals(PermissionKey.entries.toSet(), parts.keys)
        for ((_, slug) in parts) {
            assertTrue(strings.contains("name=\"permission_${slug}_name\""), slug)
            assertTrue(strings.contains("name=\"permission_${slug}_why\""), slug)
        }
    }
}
