package app.familysafe.child.data

import kotlinx.serialization.SerialName
import kotlinx.serialization.Serializable
import kotlinx.serialization.json.Json

/**
 * Wire format of `appEventSchema` / `deviceAppEventsRequestSchema` (`device-app-events`). Every key is required and
 * none is nullable. Names are checked by a JVM drift test. No device id and no app name: just which restricted
 * package was opened and when.
 */
@Serializable
internal data class AppEventDto(
    @SerialName("type") val type: String,
    @SerialName("package_name") val packageName: String,
    @SerialName("occurred_at") val occurredAt: String,
) {
    override fun toString(): String = "AppEventDto"
}

@Serializable
internal data class AppEventsRequestDto(@SerialName("events") val events: List<AppEventDto>) {
    override fun toString(): String = "AppEventsRequestDto"
}

internal object AppAttemptWire {
    /** `deviceAppEventsRequestSchema` allows only this event type on this endpoint. */
    const val EVENT_TYPE = "BLOCKED_APP_ATTEMPT"

    private val json = Json {
        ignoreUnknownKeys = true
        explicitNulls = true
    }

    fun encode(dto: AppEventsRequestDto): String = json.encodeToString(AppEventsRequestDto.serializer(), dto)
}
