package app.familysafe.child.data

import kotlinx.serialization.SerialName
import kotlinx.serialization.Serializable
import kotlinx.serialization.json.Json

/**
 * Wire format of `deviceInfoRequestSchema`. Every key is required by the contract, so unknown values are sent as
 * explicit `null` (the encoder below keeps nulls). Field names are checked against the contracts file by a JVM test.
 */
@Serializable
internal data class DeviceInfoRequestDto(
    @SerialName("sdk_level") val sdkLevel: Int,
    @SerialName("security_patch") val securityPatch: String?,
    @SerialName("storage_total_mb") val storageTotalMb: Long?,
    @SerialName("storage_free_mb") val storageFreeMb: Long?,
    @SerialName("managed_mode") val managedMode: Boolean,
) {
    override fun toString(): String = "DeviceInfoRequestDto"
}

/** `{ "data": <deviceInfoResponseSchema> }`. */
@Serializable
internal data class DeviceInfoEnvelopeDto(@SerialName("data") val data: DeviceInfoDataDto)

@Serializable
internal data class DeviceInfoDataDto(
    @SerialName("server_time") val serverTime: String,
    @SerialName("next_interval_seconds") val nextIntervalSeconds: Int,
)

internal object DeviceInfoWire {
    private val json = Json {
        ignoreUnknownKeys = true
        explicitNulls = true
    }

    fun encode(dto: DeviceInfoRequestDto): String = json.encodeToString(DeviceInfoRequestDto.serializer(), dto)

    fun serverTime(body: String): String =
        json.decodeFromString(DeviceInfoEnvelopeDto.serializer(), body).data.serverTime
}
