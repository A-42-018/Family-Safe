package app.familysafe.child.data

import app.familysafe.child.config.ApiBaseUrl
import io.ktor.client.HttpClient
import io.ktor.client.engine.mock.MockEngine
import io.ktor.client.engine.mock.MockRequestHandleScope
import io.ktor.client.engine.mock.respond
import io.ktor.client.request.HttpRequestData
import io.ktor.client.request.HttpResponseData
import io.ktor.http.HttpHeaders
import io.ktor.http.HttpMethod
import io.ktor.http.HttpStatusCode
import io.ktor.http.content.TextContent
import io.ktor.http.headersOf
import java.net.SocketTimeoutException
import java.net.UnknownHostException
import kotlinx.coroutines.test.runTest
import org.junit.jupiter.api.Assertions.assertEquals
import org.junit.jupiter.api.Assertions.assertInstanceOf
import org.junit.jupiter.api.Assertions.assertNull
import org.junit.jupiter.api.Test

class KtorRefreshApiTest {
    private val base = ApiBaseUrl.parse("https://ref.supabase.co/functions/v1", allowLoopbackHttp = false).getOrThrow()
    private val token = "T".repeat(43)
    private val json = headersOf(HttpHeaders.ContentType, "application/json")
    private fun body(refresh: String = "R".repeat(43), access: String = "aaa.bbb.ccc") = """
        {"data":{"device_id":"11111111-2222-3333-4444-555555555555","token_type":"Bearer",
        "access_token":"$access","access_expires_in":900,"refresh_token":"$refresh",
        "refresh_expires_at":"2026-10-30T12:00:00.000Z"}}
    """.trimIndent()

    private fun api(handler: suspend MockRequestHandleScope.(HttpRequestData) -> HttpResponseData) =
        KtorRefreshApi(HttpClient(MockEngine(handler)) { expectSuccess = false }, base)

    @Test
    fun `posts only the refresh token to device-refresh without any credential header`() = runTest {
        var seen: HttpRequestData? = null
        val outcome = api { req ->
            seen = req
            respond(body(), HttpStatusCode.OK, json)
        }.refresh(token)

        val success = assertInstanceOf(RefreshOutcome.Success::class.java, outcome)
        assertEquals("aaa.bbb.ccc", success.tokens.accessToken)
        assertEquals("R".repeat(43), success.tokens.refreshToken)

        val req = seen!!
        assertEquals(HttpMethod.Post, req.method)
        assertEquals("https://ref.supabase.co/functions/v1/device-refresh", req.url.toString())
        assertNull(req.headers[HttpHeaders.Authorization])
        assertEquals("""{"refresh_token":"$token"}""", (req.body as TextContent).text)
    }

    @Test
    fun `maps status codes`() = runTest {
        val errorBody = """{"error":{"code":"x","message":"secret words"}}"""

        suspend fun outcome(code: Int, headers: io.ktor.http.Headers = json) =
            api { respond(errorBody, HttpStatusCode.fromValue(code), headers) }.refresh(token)

        assertEquals(RefreshOutcome.Failure(RefreshFailure.CredentialsRejected), outcome(401))
        assertEquals(RefreshOutcome.Failure(RefreshFailure.Uncertain), outcome(500))
        assertEquals(RefreshOutcome.Failure(RefreshFailure.ServerUnavailable), outcome(503))
        assertEquals(RefreshOutcome.Failure(RefreshFailure.Rejected), outcome(400))
        assertEquals(
            RefreshOutcome.Failure(RefreshFailure.RateLimited(30)),
            outcome(429, headersOf(HttpHeaders.RetryAfter, "30")),
        )
    }

    @Test
    fun `an unreadable or off-contract 200 is uncertain`() = runTest {
        assertEquals(
            RefreshOutcome.Failure(RefreshFailure.Uncertain),
            api { respond("not json", HttpStatusCode.OK, json) }.refresh(token),
        )
        assertEquals(
            RefreshOutcome.Failure(RefreshFailure.Uncertain),
            api { respond(body(refresh = "short"), HttpStatusCode.OK, json) }.refresh(token),
        )
    }

    @Test
    fun `network failures split into before-send and maybe-after-send`() = runTest {
        assertEquals(
            RefreshOutcome.Failure(RefreshFailure.Unreachable),
            api { throw UnknownHostException("h") }.refresh(token),
        )
        assertEquals(
            RefreshOutcome.Failure(RefreshFailure.Uncertain),
            api { throw SocketTimeoutException("read timed out") }.refresh(token),
        )
    }
}
