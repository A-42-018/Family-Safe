package app.familysafe.child.data

import kotlinx.serialization.SerialName
import kotlinx.serialization.Serializable

/** Wire format of `refreshRequestSchema`. Field names are checked against the contracts file by a JVM test. */
@Serializable
internal data class RefreshRequestDto(@SerialName("refresh_token") val refreshToken: String) {
    override fun toString(): String = "RefreshRequestDto"
}

/** `{ "data": <refreshResponseSchema> }`. */
@Serializable
internal data class RefreshEnvelopeDto(@SerialName("data") val data: RefreshDataDto)

@Serializable
internal data class RefreshDataDto(
    @SerialName("device_id") val deviceId: String,
    @SerialName("token_type") val tokenType: String,
    @SerialName("access_token") val accessToken: String,
    @SerialName("access_expires_in") val accessExpiresIn: Int,
    @SerialName("refresh_token") val refreshToken: String,
    @SerialName("refresh_expires_at") val refreshExpiresAt: String,
) {
    override fun toString(): String = "RefreshDataDto"
}
