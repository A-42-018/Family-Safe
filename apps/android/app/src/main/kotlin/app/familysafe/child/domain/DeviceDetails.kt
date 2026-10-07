package app.familysafe.child.domain

import java.time.LocalDate
import java.time.ZoneOffset

/** Field limits of `deviceInfoRequestSchema` (packages/contracts/src/device-info.ts). A JVM test checks them. */
object DeviceDetailsLimits {
    const val SDK_MIN = 1
    const val SDK_MAX = 99
    const val STORAGE_MB_MAX = 16_777_216L
    const val SECURITY_PATCH_MIN = "2010-01-01"

    /** Period of the WorkManager job; equals `DEVICE_INFO_INTERVAL_SECONDS` (a JVM test checks it). */
    const val INTERVAL_HOURS = 24L
}

/**
 * The permission-free hardware/OS facts one `device-info` upload carries: API level, security patch date and
 * internal storage in MiB. No hardware identifiers, addresses, app names or file names. `null` = the OS did
 * not say. Shown to the child in plain words on the Device status screen.
 */
class DeviceDetails(
    val sdkLevel: Int,
    val securityPatch: String?,
    val storageTotalMb: Long?,
    val storageFreeMb: Long?,
    /** FamilySafe is the Device Owner of this phone (managed mode, Track B). A self-report, shown to the parent. */
    val managedMode: Boolean = false,
) {
    /**
     * What may leave the device, or null when the API level is unusable (then nothing is sent at all).
     * Everything else degrades to "unknown" instead of failing: an unparseable or future patch date becomes null
     * (stricter than the server, so a device with a wrong clock cannot get stuck on a 400), storage values are
     * only sent as a consistent pair (total >= 1, 0 <= free <= total, both clamped to the contract ceiling).
     */
    fun sanitized(todayUtc: LocalDate = LocalDate.now(ZoneOffset.UTC)): DeviceDetails? {
        if (sdkLevel !in DeviceDetailsLimits.SDK_MIN..DeviceDetailsLimits.SDK_MAX) return null
        val patch = SecurityPatchParser.normalize(securityPatch)?.takeIf { !LocalDate.parse(it).isAfter(todayUtc) }
        val storage = StorageMath.pair(storageTotalMb, storageFreeMb)
        return DeviceDetails(sdkLevel, patch, storage?.first, storage?.second, managedMode)
    }

    override fun equals(other: Any?): Boolean = other is DeviceDetails &&
        sdkLevel == other.sdkLevel &&
        securityPatch == other.securityPatch &&
        storageTotalMb == other.storageTotalMb &&
        storageFreeMb == other.storageFreeMb &&
        managedMode == other.managedMode

    override fun hashCode(): Int = listOf(
        sdkLevel,
        securityPatch,
        storageTotalMb,
        storageFreeMb,
        managedMode,
    ).hashCode()

    override fun toString(): String = "DeviceDetails"
}

fun interface DeviceDetailsSource {
    fun current(): DeviceDetails
}

/** `Build.VERSION.SECURITY_PATCH` is `YYYY-MM-DD` on every supported release; anything else is "unknown". */
object SecurityPatchParser {
    private val shape = Regex("""\d{4}-\d{2}-\d{2}""")

    /** The trimmed value when it is a real calendar date on or after 2010-01-01, else null. */
    fun normalize(raw: String?): String? {
        val text = raw?.trim() ?: return null
        if (!shape.matches(text)) return null
        val date = try {
            LocalDate.parse(text)
        } catch (_: Exception) {
            return null
        }
        val earliest = LocalDate.parse(DeviceDetailsLimits.SECURITY_PATCH_MIN)
        return text.takeIf { !date.isBefore(earliest) && date.toString() == it }
    }
}

/** Pure byte to MiB rules (1 MiB = 1 048 576 bytes; the web app formats them for the parent). */
object StorageMath {
    private const val BYTES_PER_MB = 1_048_576L

    fun bytesToMb(bytes: Long): Long = bytes / BYTES_PER_MB

    /** `StatFs` figures in bytes to a valid (total, free) pair, or null when they cannot be trusted. */
    fun fromBytes(totalBytes: Long, freeBytes: Long): Pair<Long, Long>? {
        if (totalBytes <= 0 || freeBytes < 0) return null
        return pair(bytesToMb(totalBytes), bytesToMb(freeBytes))
    }

    /** Valid pair for the contract (both present, total >= 1, free <= total, clamped to the ceiling), else null. */
    fun pair(total: Long?, free: Long?): Pair<Long, Long>? {
        if (total == null || free == null) return null
        if (total < 1 || free < 0) return null
        val cappedTotal = total.coerceAtMost(DeviceDetailsLimits.STORAGE_MB_MAX)
        val cappedFree = free.coerceAtMost(DeviceDetailsLimits.STORAGE_MB_MAX)
        if (cappedFree > cappedTotal) return null
        return cappedTotal to cappedFree
    }
}

/** What the child's screen shows: exactly what the server last acknowledged, and when. */
class DeviceInfoReport(val details: DeviceDetails, val sentAtEpochMillis: Long) {
    override fun toString(): String = "DeviceInfoReport"
}

/**
 * Single-string form of a [DeviceInfoReport] for the sealed store: `sentAt;sdk;patch;totalMb;freeMb;managed` (empty =
 * null, managed is `0`/`1`). The older five-field form reads as "nothing sent yet" so the new field is reported.
 */
object DeviceInfoReportCodec {
    private const val FIELDS = 6

    fun encode(report: DeviceInfoReport): String = with(report.details) {
        listOf(
            report.sentAtEpochMillis.toString(),
            sdkLevel.toString(),
            securityPatch.orEmpty(),
            storageTotalMb?.toString().orEmpty(),
            storageFreeMb?.toString().orEmpty(),
            if (managedMode) "1" else "0",
        ).joinToString(";")
    }

    /** Null for anything [encode] would not write, or that [DeviceDetails.sanitized] would not let through. */
    fun decode(text: String?): DeviceInfoReport? {
        val parts = text?.split(";") ?: return null
        if (parts.size != FIELDS) return null
        val sentAt = parts[0].toLongOrNull()?.takeIf { it > 0 } ?: return null
        val sdk = parts[1].toIntOrNull() ?: return null
        val patch = parts[2].ifEmpty { null }
        val total = parts[3].ifEmpty { null }?.let { it.toLongOrNull() ?: return null }
        val free = parts[4].ifEmpty { null }?.let { it.toLongOrNull() ?: return null }
        val managed = when (parts[5]) {
            "1" -> true
            "0" -> false
            else -> return null
        }
        if (patch != null && SecurityPatchParser.normalize(patch) != patch) return null
        if (sdk !in DeviceDetailsLimits.SDK_MIN..DeviceDetailsLimits.SDK_MAX) return null
        if ((total == null) != (free == null)) return null
        if (total != null && free != null && StorageMath.pair(total, free) != (total to free)) return null
        return DeviceInfoReport(DeviceDetails(sdk, patch, total, free, managed), sentAt)
    }
}

/** When a device-info upload is worth doing in addition to the daily one. */
object DeviceInfoPolicy {
    /**
     * After an OS or security-patch update the parent should not wait up to a day: the API level or patch date now
     * differs from what was last acknowledged; the same for switching managed mode on or off. Storage is ignored on
     * purpose (it changes constantly). No report yet
     * is NOT "stale": the freshly enqueued periodic job uploads immediately, an extra request would only duplicate it.
     */
    fun needsUploadNow(last: DeviceInfoReport?, current: DeviceDetails): Boolean {
        if (last == null) return false
        return last.details.sdkLevel != current.sdkLevel ||
            last.details.securityPatch != current.securityPatch ||
            last.details.managedMode != current.managedMode
    }
}
