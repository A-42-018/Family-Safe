package app.familysafe.child.domain

import java.security.MessageDigest

/** Limits of `deviceAppsRequestSchema` (packages/contracts/src/device-apps.ts). A JVM test checks every one. */
object AppInventoryLimits {
    const val MAX_APPS = 500
    const val PACKAGE_MAX = 255
    const val LABEL_MAX = 200
    const val VERSION_MAX = 100

    /** Largest body the Edge Function accepts (`DEVICE_APPS_MAX_BODY_BYTES`). */
    const val MAX_BODY_BYTES = 1_048_576

    /** Same text as `PACKAGE_NAME_PATTERN` in the contract (a JVM test compares the two). */
    const val PACKAGE_PATTERN = """^[A-Za-z][A-Za-z0-9_]*(\.[A-Za-z][A-Za-z0-9_]*)+$"""

    /** Period of the WorkManager job; equals `DEVICE_APPS_INTERVAL_SECONDS` (a JVM test checks it). */
    const val INTERVAL_HOURS = 24L

    /** Minimum gap between two "did the list change?" readings triggered by opening the app. */
    const val CHECK_MIN_GAP_MILLIS = 15L * 60L * 1000L
}

/**
 * One launchable app as Android reports it. Only what the contract carries: the technical package name, the
 * visible name, the version name (`null` = unknown) and whether it is a system app. No icon, install time,
 * version code, signature or usage. Shown to the child in plain words on the Device status screen.
 */
data class InstalledApp(
    val packageName: String,
    val label: String,
    val versionName: String?,
    val isSystem: Boolean,
) {
    override fun toString(): String = "InstalledApp"
}

/**
 * What one `device-apps` upload carries after sanitizing: at most [AppInventoryLimits.MAX_APPS] entries, sorted by
 * package name, unique, every field valid for the contract. [omittedCount] = apps that were read but left out
 * (over the cap, or a package name the contract cannot carry); the child is told about them.
 */
class AppInventory(val apps: List<InstalledApp>, val omittedCount: Int) {
    /** Stable SHA-256 over exactly what would be sent; equal fingerprints mean "nothing new to tell the parent". */
    val fingerprint: String by lazy { AppInventoryFingerprint.of(this) }

    override fun equals(other: Any?): Boolean =
        other is AppInventory && omittedCount == other.omittedCount && apps == other.apps

    override fun hashCode(): Int = 31 * apps.hashCode() + omittedCount

    override fun toString(): String = "AppInventory"
}

/**
 * Turns whatever `PackageManager` returned into a list the contract accepts, never the other way round: the
 * server must not be able to answer a permanent 400 because of an unusual app name. Rules mirror the Zod schema:
 * label and version are trimmed (the way JavaScript's `trim()` does, including U+FEFF), control characters
 * `U+0000-U+001F`, `U+007F-U+009F` are replaced by a space, label 1..200 (falls back to the package name), version
 * 1..100 or `null`, package name <= 255 and matching the shared pattern (otherwise the app is left out), no
 * duplicates, at most 500 entries.
 *
 * **Cap decision:** when more than 500 apps are readable, the first 500 **sorted by package name** are sent and the
 * rest is counted in `omittedCount` (shown to the child, never a 400). Sorting makes the choice deterministic, so
 * the same phone always shares the same 500 apps and the fingerprint does not flip between runs.
 */
object AppInventorySanitizer {
    private val packageRegex = Regex(AppInventoryLimits.PACKAGE_PATTERN)
    private val controlChars = Regex("[\\u0000-\\u001f\\u007f-\\u009f]")

    /** Deterministic order; also decides which of two entries with the same package name survives. */
    private val order = compareBy<InstalledApp>(
        { it.packageName },
        { it.label },
        { it.versionName.orEmpty() },
        { it.isSystem },
    )

    fun sanitize(raw: List<InstalledApp>): AppInventory {
        var invalid = 0
        val clean = ArrayList<InstalledApp>(raw.size)
        for (app in raw) {
            val one = normalize(app)
            if (one == null) invalid++ else clean += one
        }
        val unique = clean.sortedWith(order).distinctBy { it.packageName }
        val kept = unique.take(AppInventoryLimits.MAX_APPS)
        return AppInventory(kept, invalid + (unique.size - kept.size))
    }

    /** The contract-valid form of one app, or null when its package name cannot be sent. Idempotent. */
    fun normalize(app: InstalledApp): InstalledApp? {
        val pkg = app.packageName
        if (pkg.length > AppInventoryLimits.PACKAGE_MAX || !packageRegex.matches(pkg)) return null
        val label = cleanText(app.label, AppInventoryLimits.LABEL_MAX)
            ?: cleanText(pkg, AppInventoryLimits.LABEL_MAX)
            ?: return null
        val version = cleanText(app.versionName, AppInventoryLimits.VERSION_MAX)
        return InstalledApp(pkg, label, version, app.isSystem)
    }

    /** `trim()` as JavaScript does it: Unicode whitespace plus the byte order mark. */
    private fun isJsSpace(c: Char): Boolean = c.isWhitespace() || c == '\uFEFF'

    private fun cleanText(raw: String?, max: Int): String? {
        if (raw == null) return null
        val trimmed = controlChars.replace(raw, " ").trim { isJsSpace(it) }
        if (trimmed.isEmpty()) return null
        val cut = if (trimmed.length <= max) trimmed else truncate(trimmed, max)
        return cut.trimEnd { isJsSpace(it) }.ifEmpty { null }
    }

    /** Never cuts a surrogate pair in half. */
    private fun truncate(text: String, max: Int): String {
        var end = max
        if (Character.isHighSurrogate(text[end - 1])) end--
        return text.substring(0, end)
    }
}

/** SHA-256 (hex) over a canonical, unambiguous form of an [AppInventory]. Contains nothing that is not sent. */
object AppInventoryFingerprint {
    private const val FIELD = '\u001f'
    private const val RECORD = '\u001e'
    private const val NO_VERSION = '\u0000'
    private const val HEX = "0123456789abcdef"

    fun of(inventory: AppInventory): String {
        val canonical = buildString {
            append(inventory.omittedCount).append(RECORD)
            for (app in inventory.apps) {
                append(app.packageName).append(FIELD)
                append(app.label).append(FIELD)
                append(app.versionName ?: NO_VERSION).append(FIELD)
                append(if (app.isSystem) '1' else '0').append(RECORD)
            }
        }
        val digest = MessageDigest.getInstance("SHA-256").digest(canonical.toByteArray(Charsets.UTF_8))
        return digest.joinToString("") { byte ->
            val value = byte.toInt() and 0xff
            HEX[value shr 4].toString() + HEX[value and 0x0f]
        }
    }
}

fun interface InstalledAppsSource {
    /** Raw reading; may throw. The repository sanitizes it before anything leaves the device. */
    fun current(): List<InstalledApp>
}

/** What the child's screen shows: exactly what the server last acknowledged, and when. */
class AppInventoryReport(val inventory: AppInventory, val sentAtEpochMillis: Long) {
    val fingerprint: String get() = inventory.fingerprint

    override fun toString(): String = "AppInventoryReport"
}

/**
 * Single-string form of an [AppInventoryReport] for the sealed store. Records are separated by U+001E, fields by
 * U+001F; both are control characters the sanitizer has removed from every field, so they cannot occur in data.
 * First record: `v1`, sent-at millis, omitted count. Then one record per app: package, label, version (empty =
 * unknown), `1`/`0` for system. [decode] only accepts what [encode] writes and what [AppInventorySanitizer] would
 * produce (sorted, unique, valid), so damaged or tampered storage reads as "nothing sent yet".
 */
object AppInventoryReportCodec {
    private const val FIELD = '\u001f'
    private const val RECORD = '\u001e'
    private const val VERSION_TAG = "v1"
    private const val HEADER_FIELDS = 3
    private const val APP_FIELDS = 4
    private const val OMITTED_MAX = 1_000_000

    fun encode(report: AppInventoryReport): String {
        val header = listOf(VERSION_TAG, report.sentAtEpochMillis.toString(), report.inventory.omittedCount.toString())
            .joinToString(FIELD.toString())
        val rows = report.inventory.apps.map { app ->
            listOf(app.packageName, app.label, app.versionName.orEmpty(), if (app.isSystem) "1" else "0")
                .joinToString(FIELD.toString())
        }
        return (listOf(header) + rows).joinToString(RECORD.toString())
    }

    fun decode(text: String?): AppInventoryReport? {
        val records = text?.split(RECORD) ?: return null
        val header = records.first().split(FIELD)
        if (header.size != HEADER_FIELDS || header[0] != VERSION_TAG) return null
        val sentAt = header[1].toLongOrNull()?.takeIf { it > 0 } ?: return null
        val omitted = header[2].toIntOrNull()?.takeIf { it in 0..OMITTED_MAX } ?: return null
        if (records.size - 1 > AppInventoryLimits.MAX_APPS) return null
        val apps = ArrayList<InstalledApp>(records.size - 1)
        for (record in records.drop(1)) {
            val app = decodeApp(record) ?: return null
            if (apps.isNotEmpty() && apps.last().packageName >= app.packageName) return null
            apps += app
        }
        return AppInventoryReport(AppInventory(apps, omitted), sentAt)
    }

    private fun decodeApp(record: String): InstalledApp? {
        val parts = record.split(FIELD)
        if (parts.size != APP_FIELDS) return null
        val system = when (parts[3]) {
            "1" -> true
            "0" -> false
            else -> return null
        }
        val app = InstalledApp(parts[0], parts[1], parts[2].ifEmpty { null }, system)
        return app.takeIf { AppInventorySanitizer.normalize(it) == it }
    }
}

/** When an extra upload is worth doing in addition to the daily one. */
object AppInventoryPolicy {
    /**
     * The list differs from what was last acknowledged. No report yet is NOT "changed": the freshly enqueued periodic
     * job uploads immediately, an extra request would only duplicate it. An empty reading never triggers anything
     * (a phone always has at least its launcher; empty means the reading failed).
     */
    fun needsUploadNow(last: AppInventoryReport?, current: AppInventory): Boolean {
        if (last == null || current.apps.isEmpty()) return false
        return last.fingerprint != current.fingerprint
    }

    /**
     * Reading every launchable app is not free, so opening the app checks for a changed list at most every
     * [AppInventoryLimits.CHECK_MIN_GAP_MILLIS]. A clock that went backwards counts as "check now".
     */
    fun shouldCheck(lastCheckEpochMillis: Long?, nowEpochMillis: Long): Boolean {
        if (lastCheckEpochMillis == null || nowEpochMillis < lastCheckEpochMillis) return true
        return nowEpochMillis - lastCheckEpochMillis >= AppInventoryLimits.CHECK_MIN_GAP_MILLIS
    }
}
