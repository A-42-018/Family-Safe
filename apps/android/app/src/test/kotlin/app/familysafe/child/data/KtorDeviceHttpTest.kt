package app.familysafe.child.data

import app.familysafe.child.config.ApiBaseUrl
import io.ktor.client.HttpClient
import io.ktor.client.engine.mock.MockEngine
import io.ktor.client.engine.mock.respond
import io.ktor.client.request.HttpRequestData
import io.ktor.http.HttpHeaders
import io.ktor.http.HttpMethod
import io.ktor.http.HttpStatusCode
import io.ktor.http.content.TextContent
import io.ktor.http.headersOf
import kotlinx.coroutines.test.runTest
import org.junit.jupiter.api.Assertions.assertEquals
import org.junit.jupiter.api.Assertions.assertInstanceOf
import org.junit.jupiter.api.Test

class KtorDeviceHttpTest {
    private val base = ApiBaseUrl.parse("https://ref.supabase.co/functions/v1", allowLoopbackHttp = false).getOrThrow()

    private class Tokens(vararg results: AccessTokenResult) : AccessTokenSource {
        private val queue = results.toMutableList()
        override suspend fun accessToken() = queue.removeAt(0)
        override suspend fun refreshAfterUnauthorized(rejectedToken: String) = queue.removeAt(0)
        override fun discard(rejectedToken: String) = Unit
    }

    @Test
    fun `posts json with the bearer token to the named endpoint`() = runTest {
        val seen = mutableListOf<HttpRequestData>()
        val engine = MockEngine { req ->
            seen += req
            respond("""{"data":{}}""", HttpStatusCode.OK, headersOf(HttpHeaders.ContentType, "application/json"))
        }
        val http = KtorDeviceHttp(
            HttpClient(engine) { expectSuccess = false },
            base,
            AuthenticatedExecutor(Tokens(AccessTokenResult.Available("ACCESS"))),
        )

        val outcome = http.postJson("device-heartbeat", """{"a":1}""")

        assertEquals(200, assertInstanceOf(AuthedOutcome.Completed::class.java, outcome).response.status)
        val req = seen.single()
        assertEquals(HttpMethod.Post, req.method)
        assertEquals("https://ref.supabase.co/functions/v1/device-heartbeat", req.url.toString())
        assertEquals("Bearer ACCESS", req.headers[HttpHeaders.Authorization])
        assertEquals("""{"a":1}""", (req.body as TextContent).text)
    }

    @Test
    fun `a 401 refreshes once and repeats with the new token`() = runTest {
        val auth = mutableListOf<String?>()
        val engine = MockEngine { req ->
            auth += req.headers[HttpHeaders.Authorization]
            respond("", if (auth.size == 1) HttpStatusCode.Unauthorized else HttpStatusCode.OK)
        }
        val http = KtorDeviceHttp(
            HttpClient(engine) { expectSuccess = false },
            base,
            AuthenticatedExecutor(Tokens(AccessTokenResult.Available("OLD"), AccessTokenResult.Available("NEW"))),
        )

        val outcome = http.postJson("device-heartbeat", "{}")

        assertEquals(listOf<String?>("Bearer OLD", "Bearer NEW"), auth)
        assertEquals(200, assertInstanceOf(AuthedOutcome.Completed::class.java, outcome).response.status)
    }

    @Test
    fun `gets with the bearer token and the if-none-match header, no body`() = runTest {
        val seen = mutableListOf<HttpRequestData>()
        val engine = MockEngine { req ->
            seen += req
            respond("", HttpStatusCode.NotModified)
        }
        val http = KtorDeviceHttp(
            HttpClient(engine) { expectSuccess = false },
            base,
            AuthenticatedExecutor(Tokens(AccessTokenResult.Available("ACCESS"))),
        )

        val outcome = http.getJson("device-config", "\"v2\"")

        assertEquals(304, assertInstanceOf(AuthedOutcome.Completed::class.java, outcome).response.status)
        val req = seen.single()
        assertEquals(HttpMethod.Get, req.method)
        assertEquals("https://ref.supabase.co/functions/v1/device-config", req.url.toString())
        assertEquals("Bearer ACCESS", req.headers[HttpHeaders.Authorization])
        assertEquals("\"v2\"", req.headers[HttpHeaders.IfNoneMatch])
    }

    @Test
    fun `an unconditional get sends no if-none-match header`() = runTest {
        val seen = mutableListOf<HttpRequestData>()
        val engine = MockEngine { req ->
            seen += req
            respond("{}", HttpStatusCode.OK)
        }
        val http = KtorDeviceHttp(
            HttpClient(engine) { expectSuccess = false },
            base,
            AuthenticatedExecutor(Tokens(AccessTokenResult.Available("ACCESS"))),
        )
        http.getJson("device-config", null)
        assertEquals(null, seen.single().headers[HttpHeaders.IfNoneMatch])
    }
}
