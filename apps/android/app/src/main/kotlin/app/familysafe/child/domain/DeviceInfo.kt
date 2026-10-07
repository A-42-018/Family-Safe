package app.familysafe.child.domain

/** Field limits of `redeemPairingRequestSchema` (packages/contracts/src/enrollment.ts). */
object DeviceInfoLimits {
    const val NAME = 100
    const val MANUFACTURER = 100
    const val MODEL = 100
    const val ANDROID_VERSION = 32
    const val APP_VERSION = 32
}

/** What a parent will see about this device after pairing. Shown to the child before they connect. */
data class DeviceInfo(
    val name: String,
    val manufacturer: String?,
    val model: String?,
    val androidVersion: String?,
    val appVersion: String?,
) {
    /** Trimmed, control characters removed, clamped to the server limits. Null when the name is unusable. */
    fun sanitized(): DeviceInfo? {
        val cleanName = DeviceText.clean(name, DeviceInfoLimits.NAME) ?: return null
        return DeviceInfo(
            name = cleanName,
            manufacturer = DeviceText.clean(manufacturer, DeviceInfoLimits.MANUFACTURER),
            model = DeviceText.clean(model, DeviceInfoLimits.MODEL),
            androidVersion = DeviceText.clean(androidVersion, DeviceInfoLimits.ANDROID_VERSION),
            appVersion = DeviceText.clean(appVersion, DeviceInfoLimits.APP_VERSION),
        )
    }

    companion object {
        /** Friendly default such as "Google Pixel 8"; never empty. */
        fun defaultName(manufacturer: String?, model: String?): String {
            val maker = manufacturer?.trim().orEmpty()
            val mdl = model?.trim().orEmpty()
            val joined = when {
                mdl.isEmpty() -> maker
                maker.isEmpty() || mdl.startsWith(maker, ignoreCase = true) -> mdl
                else -> "$maker $mdl"
            }
            return DeviceText.clean(joined, DeviceInfoLimits.NAME) ?: "Android device"
        }
    }
}

fun interface DeviceInfoProvider {
    fun current(): DeviceInfo
}

internal object DeviceText {
    /** Trim, drop control characters, cap length without splitting a surrogate pair. Blank becomes null. */
    fun clean(value: String?, max: Int): String? {
        if (value == null) return null
        var out = value.filterNot { it.isISOControl() }.trim().take(max)
        if (out.isNotEmpty() && out.last().isHighSurrogate()) out = out.dropLast(1)
        return out.trim().ifEmpty { null }
    }

    /** Live editing variant: only removes control characters and caps length. */
    fun limitTyped(value: String, max: Int): String {
        var out = value.filterNot { it.isISOControl() }.take(max)
        if (out.isNotEmpty() && out.last().isHighSurrogate()) out = out.dropLast(1)
        return out
    }
}
