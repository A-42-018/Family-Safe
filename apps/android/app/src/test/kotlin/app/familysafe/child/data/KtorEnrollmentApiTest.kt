package app.familysafe.child.data

import app.familysafe.child.config.ApiBaseUrl
import app.familysafe.child.domain.EnrollmentFailure
import io.ktor.client.HttpClient
import io.ktor.client.engine.mock.MockEngine
import io.ktor.client.engine.mock.MockRequestHandleScope
import io.ktor.client.engine.mock.respond
import io.ktor.client.request.HttpRequestData
import io.ktor.client.request.HttpResponseData
import io.ktor.http.Headers
import io.ktor.http.HttpHeaders
import io.ktor.http.HttpMethod
import io.ktor.http.HttpStatusCode
import io.ktor.http.content.TextContent
import io.ktor.http.headersOf
import java.net.SocketTimeoutException
import java.net.UnknownHostException
import kotlinx.coroutines.test.runTest
import org.junit.jupiter.api.Assertions.assertEquals
import org.junit.jupiter.api.Assertions.assertFalse
import org.junit.jupiter.api.Assertions.assertInstanceOf
import org.junit.jupiter.api.Assertions.assertNull
import org.junit.jupiter.api.Assertions.assertTrue
import org.junit.jupiter.api.Test

class KtorEnrollmentApiTest {
    private val base = ApiBaseUrl.parse("https://ref.supabase.co/functions/v1", allowLoopbackHttp = false).getOrThrow()
    private val request = RedeemRequest("0123456789ABCDEF", "Sam's phone", "Google", "Pixel 8", "14", "0.10.0")
    private val json = headersOf(HttpHeaders.ContentType, "application/json")
    private val goodBody = """
        {"data":{"device_id":"11111111-2222-3333-4444-555555555555","token_type":"Bearer",
        "access_token":"aaa.bbb.ccc","access_expires_in":900,"refresh_token":"${"R".repeat(43)}",
        "refresh_expires_at":"2026-10-30T12:00:00.000Z"}}
    """.trimIndent()

    private fun api(handler: suspend MockRequestHandleScope.(HttpRequestData) -> HttpResponseData) =
        KtorEnrollmentApi(HttpClient(MockEngine(handler)) { expectSuccess = false }, base)

    @Test
    fun `posts the JSON body to enrollment-redeem without credentials and parses the answer`() = runTest {
        var seen: HttpRequestData? = null
        val outcome = api { req ->
            seen = req
            respond(goodBody, HttpStatusCode.Created, json)
        }.redeem(request)

        val success = assertInstanceOf(RedeemOutcome.Success::class.java, outcome)
        assertEquals("11111111-2222-3333-4444-555555555555", success.response.deviceId)
        assertEquals("R".repeat(43), success.response.refreshToken)

        val req = seen!!
        assertEquals(HttpMethod.Post, req.method)
        assertEquals("https://ref.supabase.co/functions/v1/enrollment-redeem", req.url.toString())
        assertNull(req.headers[HttpHeaders.Authorization])
        val body = (req.body as TextContent).text
        assertTrue(body.contains("\"device_name\":\"Sam's phone\""))
        assertTrue(body.contains("\"code\":\"0123456789ABCDEF\""))
        assertFalse(body.contains("null"))
    }

    @Test
    fun `maps status codes`() = runTest {
        val errorBody = """{"error":{"code":"x","message":"secret words"}}"""

        suspend fun outcome(code: HttpStatusCode, headers: Headers = json) =
            api { respond(errorBody, code, headers) }.redeem(request)

        assertEquals(RedeemOutcome.Failure(EnrollmentFailure.InvalidCode), outcome(HttpStatusCode.Unauthorized))
        assertEquals(RedeemOutcome.Failure(EnrollmentFailure.ServerError), outcome(HttpStatusCode.InternalServerError))
        assertEquals(RedeemOutcome.Failure(EnrollmentFailure.Rejected), outcome(HttpStatusCode.BadRequest))
        assertEquals(
            RedeemOutcome.Failure(EnrollmentFailure.RateLimited(42)),
            outcome(HttpStatusCode.TooManyRequests, headersOf(HttpHeaders.RetryAfter, "42")),
        )
    }

    @Test
    fun `an unreadable success body is uncertain`() = runTest {
        val outcome = api { respond("<html>", HttpStatusCode.Created, json) }.redeem(request)
        assertEquals(RedeemOutcome.Failure(EnrollmentFailure.Uncertain), outcome)
    }

    @Test
    fun `transport failures are classified`() = runTest {
        assertEquals(
            RedeemOutcome.Failure(EnrollmentFailure.Unreachable),
            api { throw UnknownHostException("h") }.redeem(request),
        )
        assertEquals(
            RedeemOutcome.Failure(EnrollmentFailure.Uncertain),
            api { throw SocketTimeoutException("read") }.redeem(request),
        )
    }
}
