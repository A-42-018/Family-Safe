package app.familysafe.child.data

import kotlinx.serialization.SerialName
import kotlinx.serialization.Serializable
import kotlinx.serialization.json.Json

/**
 * Wire format of `deviceLimitReachedRequestSchema` (`device-limit-events`). Both keys are required and none is
 * nullable. Names are checked by a JVM drift test. No device id, no minutes, no app: only the local day and the time.
 */
@Serializable
internal data class LimitReachedRequestDto(
    @SerialName("day") val day: String,
    @SerialName("occurred_at") val occurredAt: String,
) {
    override fun toString(): String = "LimitReachedRequestDto"
}

internal object LimitReportWire {
    private val json = Json {
        ignoreUnknownKeys = true
        explicitNulls = true
    }

    fun encode(dto: LimitReachedRequestDto): String = json.encodeToString(LimitReachedRequestDto.serializer(), dto)
}
