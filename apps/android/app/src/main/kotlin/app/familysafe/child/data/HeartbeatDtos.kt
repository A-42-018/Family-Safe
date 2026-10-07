package app.familysafe.child.data

import kotlinx.serialization.SerialName
import kotlinx.serialization.Serializable
import kotlinx.serialization.json.Json

/** Wire format of `heartbeatRequestSchema`. Field names are checked against the contracts file by a JVM test. */
@Serializable
internal data class HeartbeatRequestDto(
    @SerialName("app_version") val appVersion: String,
    @SerialName("android_version") val androidVersion: String,
    @SerialName("battery_level") val batteryLevel: Int,
    @SerialName("is_charging") val isCharging: Boolean,
    @SerialName("network_type") val networkType: String,
) {
    override fun toString(): String = "HeartbeatRequestDto"
}

/** `{ "data": <heartbeatResponseSchema> }`. */
@Serializable
internal data class HeartbeatEnvelopeDto(@SerialName("data") val data: HeartbeatDataDto)

@Serializable
internal data class HeartbeatDataDto(
    @SerialName("server_time") val serverTime: String,
    @SerialName("next_interval_seconds") val nextIntervalSeconds: Int,
)

/** Encoding/decoding in one place so the mapper and the repository share one [Json] configuration. */
internal object HeartbeatWire {
    private val json = Json {
        ignoreUnknownKeys = true
        explicitNulls = false
    }

    fun encode(dto: HeartbeatRequestDto): String = json.encodeToString(HeartbeatRequestDto.serializer(), dto)

    fun serverTime(body: String): String =
        json.decodeFromString(HeartbeatEnvelopeDto.serializer(), body).data.serverTime
}
