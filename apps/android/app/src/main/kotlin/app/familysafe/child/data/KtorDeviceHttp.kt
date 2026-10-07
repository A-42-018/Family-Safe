package app.familysafe.child.data

import app.familysafe.child.config.ApiBaseUrl
import io.ktor.client.HttpClient
import io.ktor.client.request.bearerAuth
import io.ktor.client.request.get
import io.ktor.client.request.header
import io.ktor.client.request.post
import io.ktor.client.request.setBody
import io.ktor.client.statement.bodyAsText
import io.ktor.http.ContentType
import io.ktor.http.HttpHeaders
import io.ktor.http.contentType

/** What device endpoints depend on; implemented by [KtorDeviceHttp], faked in tests. */
fun interface DeviceHttp {
    /** POSTs [jsonBody] to the Edge Function [endpoint] with a device access token (one 401 -> refresh -> retry). */
    suspend fun postJson(endpoint: String, jsonBody: String): AuthedOutcome
}

/** GET counterpart of [DeviceHttp] for read-only endpoints (`device-config`); same token handling, same single retry. */
fun interface DeviceGetHttp {
    /** GETs the Edge Function [endpoint]; [ifNoneMatch] (a strong ETag such as `"v3"`) lets the server answer 304. */
    suspend fun getJson(endpoint: String, ifNoneMatch: String?): AuthedOutcome
}

/**
 * The one place that puts a device access token on a request. Phase 12+ device endpoints (heartbeat, config,
 * commands) call this instead of building requests themselves. The token lives only inside the [send] lambda.
 */
class KtorDeviceHttp(
    private val client: HttpClient,
    private val baseUrl: ApiBaseUrl,
    private val executor: AuthenticatedExecutor,
) : DeviceHttp, DeviceGetHttp {
    override suspend fun postJson(endpoint: String, jsonBody: String): AuthedOutcome {
        val url = baseUrl.endpoint(endpoint)
        return executor.execute { accessToken ->
            val response = client.post(url) {
                bearerAuth(accessToken)
                contentType(ContentType.Application.Json)
                setBody(jsonBody)
            }
            RawResponse(response.status.value, response.bodyAsText(), response.headers[HttpHeaders.RetryAfter])
        }
    }

    override suspend fun getJson(endpoint: String, ifNoneMatch: String?): AuthedOutcome {
        val url = baseUrl.endpoint(endpoint)
        return executor.execute { accessToken ->
            val response = client.get(url) {
                bearerAuth(accessToken)
                if (ifNoneMatch != null) header(HttpHeaders.IfNoneMatch, ifNoneMatch)
            }
            RawResponse(response.status.value, response.bodyAsText(), response.headers[HttpHeaders.RetryAfter])
        }
    }
}
