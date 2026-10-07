package app.familysafe.child.data

import kotlinx.serialization.SerialName
import kotlinx.serialization.Serializable
import kotlinx.serialization.json.Json

/**
 * Wire format of `deviceAppSchema` / `deviceAppsRequestSchema`. All four keys are required by the contract, so an
 * unknown version is an explicit `null` (the encoder below keeps nulls). Names are checked by a JVM drift test.
 */
@Serializable
internal data class AppInventoryEntryDto(
    @SerialName("package_name") val packageName: String,
    @SerialName("label") val label: String,
    @SerialName("version_name") val versionName: String?,
    @SerialName("is_system") val isSystem: Boolean,
) {
    override fun toString(): String = "AppInventoryEntryDto"
}

@Serializable
internal data class AppInventoryRequestDto(
    @SerialName("apps") val apps: List<AppInventoryEntryDto>,
) {
    override fun toString(): String = "AppInventoryRequestDto"
}

/** `{ "data": <deviceAppsResponseSchema> }`. */
@Serializable
internal data class AppInventoryEnvelopeDto(@SerialName("data") val data: AppInventoryDataDto)

@Serializable
internal data class AppInventoryDataDto(
    @SerialName("server_time") val serverTime: String,
    @SerialName("next_interval_seconds") val nextIntervalSeconds: Int,
)

internal object AppInventoryWire {
    private val json = Json {
        ignoreUnknownKeys = true
        explicitNulls = true
    }

    fun encode(dto: AppInventoryRequestDto): String = json.encodeToString(AppInventoryRequestDto.serializer(), dto)

    fun serverTime(body: String): String =
        json.decodeFromString(AppInventoryEnvelopeDto.serializer(), body).data.serverTime
}
