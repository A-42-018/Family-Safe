package app.familysafe.child.domain

/** Field limits of `heartbeatRequestSchema` (packages/contracts/src/heartbeat.ts). */
object HeartbeatLimits {
    const val VERSION_MAX = 32
    const val BATTERY_MIN = 0
    const val BATTERY_MAX = 100

    /** Period of the WorkManager job; equals `HEARTBEAT_INTERVAL_SECONDS` (a JVM test checks it). */
    const val INTERVAL_MINUTES = 15L
}

/** Wire names equal `NETWORK_TYPES` in the contracts file (a JVM test checks it). */
enum class NetworkType(val wire: String) {
    Wifi("WIFI"),
    Cellular("CELLULAR"),
    Ethernet("ETHERNET"),
    Vpn("VPN"),
    None("NONE"),
    Unknown("UNKNOWN"),
}

/**
 * Everything one heartbeat carries. Deliberately coarse: no device id (the server takes it from the token), no
 * location, no app names, no hardware identifiers. Shown to the child in plain words on the Sync status screen.
 */
class HeartbeatPayload(
    val appVersion: String,
    val androidVersion: String,
    val batteryLevel: Int,
    val isCharging: Boolean,
    val networkType: NetworkType,
) {
    /** Trimmed, control characters removed, clamped to the server limits. Null when a version string is unusable. */
    fun sanitized(): HeartbeatPayload? {
        val app = DeviceText.clean(appVersion, HeartbeatLimits.VERSION_MAX) ?: return null
        val android = DeviceText.clean(androidVersion, HeartbeatLimits.VERSION_MAX) ?: return null
        return HeartbeatPayload(
            appVersion = app,
            androidVersion = android,
            batteryLevel = batteryLevel.coerceIn(HeartbeatLimits.BATTERY_MIN, HeartbeatLimits.BATTERY_MAX),
            isCharging = isCharging,
            networkType = networkType,
        )
    }

    override fun toString(): String = "HeartbeatPayload"
}

fun interface HeartbeatPayloadSource {
    fun current(): HeartbeatPayload
}

/** Pure battery rules; the Android source feeds them the sticky `ACTION_BATTERY_CHANGED` extras. */
object BatteryMath {
    // BatteryManager.BATTERY_STATUS_CHARGING / BATTERY_STATUS_FULL. Literals keep this file JVM-testable.
    private const val STATUS_CHARGING = 2
    private const val STATUS_FULL = 5

    /** 0..100, or null when the platform gave no usable reading (missing extras are -1). */
    fun percent(level: Int, scale: Int): Int? {
        if (level < 0 || scale <= 0) return null
        return (level.toLong() * HeartbeatLimits.BATTERY_MAX / scale).toInt()
            .coerceIn(HeartbeatLimits.BATTERY_MIN, HeartbeatLimits.BATTERY_MAX)
    }

    /** Charging, or full while still plugged in. `plugged` is the `EXTRA_PLUGGED` bit set (0 = on battery). */
    fun isCharging(status: Int, plugged: Int): Boolean =
        status == STATUS_CHARGING || (status == STATUS_FULL && plugged != 0)
}

/** Pure mapping from the active network's transports to [NetworkType]. VPN wins: it sits on top of another link. */
object NetworkTypeMapper {
    fun from(
        hasActiveNetwork: Boolean,
        vpn: Boolean,
        wifi: Boolean,
        cellular: Boolean,
        ethernet: Boolean,
    ): NetworkType = when {
        !hasActiveNetwork -> NetworkType.None
        vpn -> NetworkType.Vpn
        wifi -> NetworkType.Wifi
        cellular -> NetworkType.Cellular
        ethernet -> NetworkType.Ethernet
        else -> NetworkType.Unknown
    }
}
