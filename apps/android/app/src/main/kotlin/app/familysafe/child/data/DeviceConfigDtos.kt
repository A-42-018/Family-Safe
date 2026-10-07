package app.familysafe.child.data

import app.familysafe.child.domain.ParsedScreenTimeConfig
import app.familysafe.child.domain.RawAppRule
import app.familysafe.child.domain.RawSchedule
import app.familysafe.child.domain.ScreenTimeConfigParser
import kotlinx.serialization.SerialName
import kotlinx.serialization.Serializable
import kotlinx.serialization.json.Json

/** `{ "data": <deviceConfigSchema> }`. Field names are checked against the contracts file by a JVM test. */
@Serializable
internal data class DeviceConfigEnvelopeDto(@SerialName("data") val data: DeviceConfigDataDto)

/** One entry of `app_rules` (`appRuleSchema`). Every key is required; the limit may be null (blocked rule). */
@Serializable
internal data class AppRuleDto(
    @SerialName("package_name") val packageName: String,
    @SerialName("blocked") val blocked: Boolean,
    @SerialName("daily_limit_minutes") val dailyLimitMinutes: Int?,
) {
    override fun toString(): String = "AppRuleDto"
}

/** One entry of `schedules` (`scheduleSchema`). Every key is required and none is nullable. */
@Serializable
internal data class ScheduleDto(
    @SerialName("id") val id: String,
    @SerialName("name") val name: String,
    @SerialName("type") val type: String,
    @SerialName("days") val days: List<Int>,
    @SerialName("start_time") val startTime: String,
    @SerialName("end_time") val endTime: String,
) {
    override fun toString(): String = "ScheduleDto"
}

/**
 * Every key is required (a missing nullable key is a decoding error, not a silent null), so a server that drops a
 * rule field can never be read as "no limit". Unknown extra keys are ignored.
 */
@Serializable
internal data class DeviceConfigDataDto(
    @SerialName("config_version") val configVersion: Int,
    @SerialName("daily_limit_minutes") val dailyLimitMinutes: Int?,
    @SerialName("daily_limit_overrides") val dailyLimitOverrides: Map<String, Int>,
    @SerialName("app_rules") val appRules: List<AppRuleDto>,
    @SerialName("timezone") val timezone: String?,
    @SerialName("schedules") val schedules: List<ScheduleDto>,
    @SerialName("server_time") val serverTime: String,
    @SerialName("next_interval_seconds") val nextIntervalSeconds: Int,
) {
    override fun toString(): String = "DeviceConfigDataDto"
}

internal object DeviceConfigWire {
    private val json = Json {
        ignoreUnknownKeys = true
        explicitNulls = true
    }

    /** Null for an unreadable body or any value outside the contract. */
    fun parse(body: String): ParsedScreenTimeConfig? = try {
        val dto = json.decodeFromString(DeviceConfigEnvelopeDto.serializer(), body).data
        ScreenTimeConfigParser.parse(
            version = dto.configVersion,
            dailyLimitMinutes = dto.dailyLimitMinutes,
            dayOverrides = dto.dailyLimitOverrides,
            appRules = dto.appRules.map { RawAppRule(it.packageName, it.blocked, it.dailyLimitMinutes) },
            timezone = dto.timezone,
            schedules = dto.schedules.map { RawSchedule(it.id, it.name, it.type, it.days, it.startTime, it.endTime) },
            serverTime = dto.serverTime,
            nextIntervalSeconds = dto.nextIntervalSeconds,
        )
    } catch (_: Exception) {
        null
    }
}
