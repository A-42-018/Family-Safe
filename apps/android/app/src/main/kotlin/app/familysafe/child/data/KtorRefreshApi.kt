package app.familysafe.child.data

import app.familysafe.child.config.ApiBaseUrl
import io.ktor.client.HttpClient
import io.ktor.client.request.post
import io.ktor.client.request.setBody
import io.ktor.client.statement.bodyAsText
import io.ktor.http.ContentType
import io.ktor.http.HttpHeaders
import io.ktor.http.contentType
import kotlin.coroutines.cancellation.CancellationException
import kotlinx.serialization.json.Json

/**
 * Ktor implementation of `device-refresh`. The endpoint is unauthenticated (the refresh token in the body is the
 * credential), so this class never sets a credential header. No logging, no retry (the call rotates a token), no
 * redirects. Nothing here logs the token, the body or the URL.
 */
class KtorRefreshApi(
    private val client: HttpClient,
    private val baseUrl: ApiBaseUrl,
) : RefreshApi {
    override suspend fun refresh(refreshToken: String): RefreshOutcome = try {
        val response = client.post(baseUrl.endpoint("device-refresh")) {
            contentType(ContentType.Application.Json)
            setBody(json.encodeToString(RefreshRequestDto.serializer(), RefreshRequestDto(refreshToken)))
        }
        RefreshHttpMapper.map(
            status = response.status.value,
            retryAfterHeader = response.headers[HttpHeaders.RetryAfter],
            body = if (response.status.value in 200..299) response.bodyAsText() else "",
            parse = ::parseSuccess,
        )
    } catch (e: CancellationException) {
        throw e
    } catch (e: Exception) {
        RefreshOutcome.Failure(
            if (NetworkFailureClassifier.isBeforeSend(e)) RefreshFailure.Unreachable else RefreshFailure.Uncertain,
        )
    }

    private fun parseSuccess(body: String): RefreshedTokens? {
        val data = json.decodeFromString(RefreshEnvelopeDto.serializer(), body).data
        return RefreshedTokens.parse(
            data.deviceId,
            data.tokenType,
            data.accessToken,
            data.accessExpiresIn,
            data.refreshToken,
            data.refreshExpiresAt,
        )
    }

    private companion object {
        val json = Json {
            ignoreUnknownKeys = true
            explicitNulls = false
        }
    }
}
