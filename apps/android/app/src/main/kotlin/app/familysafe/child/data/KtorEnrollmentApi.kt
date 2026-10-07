package app.familysafe.child.data

import app.familysafe.child.config.ApiBaseUrl
import io.ktor.client.HttpClient
import io.ktor.client.engine.okhttp.OkHttp
import io.ktor.client.plugins.HttpTimeout
import io.ktor.client.request.post
import io.ktor.client.request.setBody
import io.ktor.client.statement.bodyAsText
import io.ktor.http.ContentType
import io.ktor.http.HttpHeaders
import io.ktor.http.contentType
import kotlin.coroutines.cancellation.CancellationException
import kotlinx.serialization.json.Json

/**
 * Ktor (OkHttp) implementation. No logging plugin, no retry plugin (redeem is not idempotent), no redirects followed
 * with credentials (there are none), no default headers. Nothing here logs the code, the body or the URL.
 */
class KtorEnrollmentApi(
    private val client: HttpClient,
    private val baseUrl: ApiBaseUrl,
) : EnrollmentApi {
    override suspend fun redeem(request: RedeemRequest): RedeemOutcome = try {
        val response = client.post(baseUrl.endpoint("enrollment-redeem")) {
            contentType(ContentType.Application.Json)
            setBody(json.encodeToString(RedeemRequestDto.serializer(), request.toDto()))
        }
        RedeemHttpMapper.map(
            status = response.status.value,
            retryAfterHeader = response.headers[HttpHeaders.RetryAfter],
            body = if (response.status.value in 200..299) response.bodyAsText() else "",
            parse = ::parseSuccess,
        )
    } catch (e: CancellationException) {
        throw e
    } catch (e: Exception) {
        RedeemOutcome.Failure(NetworkFailureClassifier.classify(e))
    }

    private fun parseSuccess(body: String): RedeemResponse? {
        val data = json.decodeFromString(RedeemEnvelopeDto.serializer(), body).data
        return RedeemResponse.parse(data.deviceId, data.refreshToken, data.refreshExpiresAt)
    }

    private fun RedeemRequest.toDto() =
        RedeemRequestDto(code, deviceName, manufacturer, model, androidVersion, appVersion)

    companion object {
        private val json = Json {
            ignoreUnknownKeys = true
            explicitNulls = false
        }

        const val CONNECT_TIMEOUT_MS = 10_000L
        const val REQUEST_TIMEOUT_MS = 20_000L

        /** Production client: OkHttp engine, bounded timeouts, no other plugins. */
        fun defaultClient(): HttpClient = HttpClient(OkHttp) {
            expectSuccess = false
            followRedirects = false
            install(HttpTimeout) {
                connectTimeoutMillis = CONNECT_TIMEOUT_MS
                requestTimeoutMillis = REQUEST_TIMEOUT_MS
                socketTimeoutMillis = REQUEST_TIMEOUT_MS
            }
        }
    }
}
