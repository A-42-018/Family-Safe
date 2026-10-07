package app.familysafe.child.data

import kotlinx.serialization.SerialName
import kotlinx.serialization.Serializable

/** Wire format of `redeemPairingRequestSchema`. Field names are checked against the contracts file by a JVM test. */
@Serializable
internal data class RedeemRequestDto(
    @SerialName("code") val code: String,
    @SerialName("device_name") val deviceName: String,
    @SerialName("manufacturer") val manufacturer: String? = null,
    @SerialName("model") val model: String? = null,
    @SerialName("android_version") val androidVersion: String? = null,
    @SerialName("app_version") val appVersion: String? = null,
)

/** `{ "data": <redeemPairingResponseSchema> }`; unknown keys (token_type, access_token, ...) are ignored. */
@Serializable
internal data class RedeemEnvelopeDto(@SerialName("data") val data: RedeemDataDto)

@Serializable
internal data class RedeemDataDto(
    @SerialName("device_id") val deviceId: String,
    @SerialName("refresh_token") val refreshToken: String,
    @SerialName("refresh_expires_at") val refreshExpiresAt: String,
)
