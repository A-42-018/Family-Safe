package app.familysafe.child.data

import app.familysafe.child.domain.DeviceInfoLimits
import app.familysafe.child.testutil.RepoFiles
import java.io.File
import org.junit.jupiter.api.Assertions.assertEquals
import org.junit.jupiter.api.Assertions.assertTrue
import org.junit.jupiter.api.Test

/** Fails when the Android wire format and `packages/contracts/src/enrollment.ts` drift apart. */
class EnrollmentContractDriftTest {
    private val ts = RepoFiles.read("packages/contracts/src/enrollment.ts")

    private fun schemaBody(name: String): String {
        val start = ts.indexOf("export const $name")
        check(start >= 0) { "schema $name not found" }
        val end = ts.indexOf("\n\n", start).let { if (it < 0) ts.length else it }
        return ts.substring(start, end)
    }

    private fun keysOf(body: String): Set<String> =
        Regex("""^\s{2,4}([a-z_]+):""", RegexOption.MULTILINE).findAll(body).map { it.groupValues[1] }.toSet()

    private val dtoSource = RepoFiles.read("apps/android/app/src/main/kotlin/app/familysafe/child/data/RedeemDtos.kt")

    private fun serialNames(className: String): Set<String> {
        val start = dtoSource.indexOf("class $className")
        val end = dtoSource.indexOf(")\n", start)
        return Regex("""@SerialName\("([a-z_]+)"\)""").findAll(dtoSource.substring(start, end))
            .map { it.groupValues[1] }.toSet()
    }

    @Test
    fun `request DTO has exactly the fields of redeemPairingRequestSchema`() {
        val contract = keysOf(schemaBody("redeemPairingRequestSchema"))
        assertEquals(setOf("code", "device_name", "manufacturer", "model", "android_version", "app_version"), contract)
        assertEquals(contract, serialNames("RedeemRequestDto"))
    }

    @Test
    fun `response DTO fields all exist in redeemPairingResponseSchema`() {
        val contract = keysOf(schemaBody("redeemPairingResponseSchema"))
        assertTrue(contract.containsAll(serialNames("RedeemDataDto")), "contract=$contract")
    }

    @Test
    fun `device field limits match the contract`() {
        val body = schemaBody("redeemPairingRequestSchema")
        fun limit(field: String) =
            Regex("""$field:[^\n]*?(?:optionalText\(|\.max\()(\d+)""").find(body)?.groupValues?.get(1)?.toInt()
        assertEquals(DeviceInfoLimits.NAME, limit("device_name"))
        assertEquals(DeviceInfoLimits.MANUFACTURER, limit("manufacturer"))
        assertEquals(DeviceInfoLimits.MODEL, limit("model"))
        assertEquals(DeviceInfoLimits.ANDROID_VERSION, limit("android_version"))
        assertEquals(DeviceInfoLimits.APP_VERSION, limit("app_version"))
    }

    @Test
    fun `the endpoint the app calls exists as an Edge Function`() {
        val source = RepoFiles.read("apps/android/app/src/main/kotlin/app/familysafe/child/data/KtorEnrollmentApi.kt")
        val name = Regex("""endpoint\("([a-z-]+)"\)""").find(source)!!.groupValues[1]
        assertTrue(File(RepoFiles.root(), "supabase/functions/$name/handler.ts").exists())
    }

    @Test
    fun `the app sends no Authorization header to the unauthenticated endpoint`() {
        val source = RepoFiles.read("apps/android/app/src/main/kotlin/app/familysafe/child/data/KtorEnrollmentApi.kt")
        assertTrue(!source.contains("Authorization") && !source.contains("bearerAuth"))
    }
}
