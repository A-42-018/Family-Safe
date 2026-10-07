package app.familysafe.child.data

import kotlinx.serialization.SerialName
import kotlinx.serialization.Serializable
import kotlinx.serialization.json.Json

/**
 * Wire format of `permissionSyncRequestSchema`: the eight catalog keys, all required, each a state name from the
 * contract's list. No device id (it comes from the token). Field names are checked against the contracts file.
 */
@Serializable
internal data class PermissionSyncRequestDto(
    @SerialName("camera") val camera: String,
    @SerialName("microphone") val microphone: String,
    @SerialName("contacts") val contacts: String,
    @SerialName("sms") val sms: String,
    @SerialName("call_log") val callLog: String,
    @SerialName("location") val location: String,
    @SerialName("precise_location") val preciseLocation: String,
    @SerialName("background_location") val backgroundLocation: String,
) {
    override fun toString(): String = "PermissionSyncRequestDto"
}

/** `{ "data": <permissionSyncResponseSchema> }`. */
@Serializable
internal data class PermissionSyncEnvelopeDto(@SerialName("data") val data: PermissionSyncDataDto)

@Serializable
internal data class PermissionSyncDataDto(
    @SerialName("server_time") val serverTime: String,
    @SerialName("next_interval_seconds") val nextIntervalSeconds: Int,
)

internal object PermissionSyncWire {
    private val json = Json { ignoreUnknownKeys = true }

    fun encode(dto: PermissionSyncRequestDto): String = json.encodeToString(PermissionSyncRequestDto.serializer(), dto)

    fun serverTime(body: String): String =
        json.decodeFromString(PermissionSyncEnvelopeDto.serializer(), body).data.serverTime
}
