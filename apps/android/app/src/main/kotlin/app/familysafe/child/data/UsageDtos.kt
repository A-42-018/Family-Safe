package app.familysafe.child.data

import kotlinx.serialization.SerialName
import kotlinx.serialization.Serializable
import kotlinx.serialization.json.Json

/**
 * Wire format of `appUsageSchema` / `deviceUsageRequestSchema`. Every key is required by the contract and none is
 * nullable. Names are checked by a JVM drift test.
 */
@Serializable
internal data class UsageAppDto(
    @SerialName("package_name") val packageName: String,
    @SerialName("foreground_minutes") val foregroundMinutes: Int,
    @SerialName("launch_count") val launchCount: Int,
) {
    override fun toString(): String = "UsageAppDto"
}

@Serializable
internal data class UsageRequestDto(
    @SerialName("day") val day: String,
    @SerialName("total_screen_minutes") val totalScreenMinutes: Int,
    @SerialName("unlock_count") val unlockCount: Int,
    @SerialName("apps") val apps: List<UsageAppDto>,
) {
    override fun toString(): String = "UsageRequestDto"
}

/** `{ "data": <deviceUsageResponseSchema> }`. */
@Serializable
internal data class UsageEnvelopeDto(@SerialName("data") val data: UsageDataDto)

@Serializable
internal data class UsageDataDto(
    @SerialName("server_time") val serverTime: String,
    @SerialName("next_interval_seconds") val nextIntervalSeconds: Int,
)

internal object UsageWire {
    private val json = Json {
        ignoreUnknownKeys = true
        explicitNulls = true
    }

    fun encode(dto: UsageRequestDto): String = json.encodeToString(UsageRequestDto.serializer(), dto)

    fun serverTime(body: String): String = json.decodeFromString(UsageEnvelopeDto.serializer(), body).data.serverTime
}
