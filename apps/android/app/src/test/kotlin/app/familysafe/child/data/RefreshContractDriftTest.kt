package app.familysafe.child.data

import app.familysafe.child.testutil.RepoFiles
import java.io.File
import org.junit.jupiter.api.Assertions.assertEquals
import org.junit.jupiter.api.Assertions.assertFalse
import org.junit.jupiter.api.Assertions.assertTrue
import org.junit.jupiter.api.Test

/** Fails when the Android wire format and `packages/contracts/src/device-auth.ts` drift apart. */
class RefreshContractDriftTest {
    private val ts = RepoFiles.read("packages/contracts/src/device-auth.ts")
    private val kt = "apps/android/app/src/main/kotlin/app/familysafe/child"
    private val logCall = Regex("""\b(Log\.[a-z]\(|println\(|Timber\.|printStackTrace\()""")
    private val dtoSource = RepoFiles.read("$kt/data/RefreshDtos.kt")

    private fun schemaBody(name: String): String {
        val start = ts.indexOf("export const $name")
        check(start >= 0) { "schema $name not found" }
        val end = ts.indexOf("\n\n", start).let { if (it < 0) ts.length else it }
        return ts.substring(start, end)
    }

    private fun keysOf(body: String): Set<String> =
        Regex("""(?:^|[{,])\s*([a-z_]+):\s*z\.""", RegexOption.MULTILINE)
            .findAll(body).map { it.groupValues[1] }.toSet()

    private fun serialNames(className: String): Set<String> {
        val start = dtoSource.indexOf("class $className")
        val end = dtoSource.indexOf("\n}\n", start)
        return Regex("""@SerialName\("([a-z_]+)"\)""").findAll(dtoSource.substring(start, end))
            .map { it.groupValues[1] }.toSet()
    }

    @Test
    fun `request DTO has exactly the fields of refreshRequestSchema`() {
        val contract = keysOf(schemaBody("refreshRequestSchema"))
        assertEquals(setOf("refresh_token"), contract)
        assertEquals(contract, serialNames("RefreshRequestDto"))
    }

    @Test
    fun `response DTO has exactly the fields of refreshResponseSchema`() {
        val contract = keysOf(schemaBody("refreshResponseSchema"))
        val expected = setOf(
            "device_id",
            "token_type",
            "access_token",
            "access_expires_in",
            "refresh_token",
            "refresh_expires_at",
        )
        assertEquals(expected, contract)
        assertEquals(contract, serialNames("RefreshDataDto"))
    }

    @Test
    fun `refresh token length matches the contract`() {
        val length = Regex("""REFRESH_TOKEN_LENGTH\s*=\s*(\d+)""").find(ts)!!.groupValues[1].toInt()
        assertEquals(length, RefreshedTokens.REFRESH_TOKEN_LENGTH)
    }

    @Test
    fun `the endpoint the app calls exists as an Edge Function`() {
        val source = RepoFiles.read("$kt/data/KtorRefreshApi.kt")
        val name = Regex("""endpoint\("([a-z-]+)"\)""").find(source)!!.groupValues[1]
        assertTrue(File(RepoFiles.root(), "supabase/functions/$name/handler.ts").exists())
    }

    @Test
    fun `the refresh client sends no credential header, only the device client does`() {
        val refreshSource = RepoFiles.read("$kt/data/KtorRefreshApi.kt")
        assertFalse(refreshSource.contains("Authorization") || refreshSource.contains("bearerAuth("))

        val offenders = File(RepoFiles.root(), kt).walkTopDown()
            .filter { it.isFile && it.extension == "kt" }
            .filter { it.readText().contains("bearerAuth(") }
            .map { it.name }
            .toList()
        assertEquals(listOf("KtorDeviceHttp.kt"), offenders)
    }

    @Test
    fun `no main source logs or prints`() {
        val offenders = File(RepoFiles.root(), kt).walkTopDown()
            .filter { it.isFile && it.extension == "kt" }
            .filter { f -> logCall.containsMatchIn(f.readText()) }
            .map { it.name }
            .toList()
        assertEquals(emptyList<String>(), offenders)
    }
}
