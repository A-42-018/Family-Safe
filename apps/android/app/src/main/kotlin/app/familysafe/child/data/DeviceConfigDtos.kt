package app.familysafe.child.data

import app.familysafe.child.domain.ParsedScreenTimeConfig
import app.familysafe.child.domain.RawAppRule
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

/**
 * Every key is required (a missing nullable key is a decoding error, not a silent null), so a server that drops a
 * rule field can never be read as "no limit". Unknown extra keys are ignored.
 */
@Serializable
internal data class DeviceConfigDataDto(
    @SerialName("config_version") val configVersion: Int,
    @SerialName("daily_limit_minutes") val dailyLimitMinutes: Int?,
    @SerialName("daily_limit_overrides") val dailyLimitOverrides: Map<String, Int>,
    @SerialName("bedtime_enabled") val bedtimeEnabled: Boolean,
    @SerialName("bedtime_start") val bedtimeStart: String?,
    @SerialName("bedtime_end") val bedtimeEnd: String?,
    @SerialName("school_mode_enabled") val schoolModeEnabled: Boolean,
    @SerialName("app_rules") val appRules: List<AppRuleDto>,
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
            bedtimeEnabled = dto.bedtimeEnabled,
            bedtimeStart = dto.bedtimeStart,
            bedtimeEnd = dto.bedtimeEnd,
            schoolModeEnabled = dto.schoolModeEnabled,
            appRules = dto.appRules.map { RawAppRule(it.packageName, it.blocked, it.dailyLimitMinutes) },
            serverTime = dto.serverTime,
            nextIntervalSeconds = dto.nextIntervalSeconds,
        )
    } catch (_: Exception) {
        null
    }
}
