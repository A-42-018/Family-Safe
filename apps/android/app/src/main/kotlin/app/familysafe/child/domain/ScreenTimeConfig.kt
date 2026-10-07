package app.familysafe.child.domain

import java.time.Instant

/** Limits and timings of the screen-time config. The constants are checked against `device-config.ts` by a JVM test. */
object ScreenTimeLimits {
    /** `DEVICE_CONFIG_INTERVAL_SECONDS`: the server's hint for how often the app re-pulls. */
    const val INTERVAL_SECONDS = 21_600L
    const val INTERVAL_HOURS = 6L

    /** `DAILY_LIMIT_MAX_MINUTES`. */
    const val MAX_MINUTES = 1_440

    /** `CONFIG_ETAG_MAX_VERSION`. */
    const val MAX_VERSION = 999_999_999

    /** After this many missed intervals the cached rules are shown as "may be out of date" (still applied). */
    const val STALE_AFTER_INTERVALS = 3L

    /** Rules not confirmed by the server for this long are no longer applied (prompt §30: no stale rules forever). */
    const val EXPIRY_DAYS = 7L

    /** Opening the app re-pulls when the last confirmation is at least this old. */
    const val PULL_ON_RESUME_MILLIS = 30L * 60L * 1_000L

    const val STALE_MILLIS = STALE_AFTER_INTERVALS * INTERVAL_SECONDS * 1_000L
    const val EXPIRY_MILLIS = EXPIRY_DAYS * 24L * 60L * 60L * 1_000L
}

/** Bedtime window as the server sends it: `HH:MM` strings, only while bedtime is on. Not applied until Phase 19. */
class BedtimeWindow(val start: String, val end: String) {
    override fun equals(other: Any?): Boolean = other is BedtimeWindow && other.start == start && other.end == end

    override fun hashCode(): Int = 31 * start.hashCode() + end.hashCode()

    override fun toString(): String = "BedtimeWindow"
}

/**
 * The parent's screen-time rules as the server last sent them. Built only through [validated] /
 * [ScreenTimeConfigParser] so an off-contract value can never reach the cache or the screens. `toString` is fixed
 * (it names only the version).
 */
class ScreenTimeConfig private constructor(
    val version: Int,
    /** Default daily limit in minutes; null = no default limit. */
    val dailyLimitMinutes: Int?,
    /** ISO weekday (1 = Monday … 7 = Sunday) to minutes; a present key replaces the default, 0 = no screen time. */
    val dayOverrides: Map<Int, Int>,
    val bedtime: BedtimeWindow?,
    val schoolModeEnabled: Boolean,
    /** Per-app restrictions (Phase 18), sorted by package name; empty = none. */
    val appRules: List<AppRule>,
) {
    /** Same rule as `effectiveDailyLimitMinutes` in the contracts: an override beats the default; null = no limit. */
    fun limitFor(isoWeekday: Int): Int? =
        if (dayOverrides.containsKey(isoWeekday)) dayOverrides[isoWeekday] else dailyLimitMinutes

    /** Strong ETag the server uses for this version (`"v3"`); sent back as `If-None-Match`. */
    fun etag(): String = etagFor(version)

    val hasAnyLimit: Boolean get() = dailyLimitMinutes != null || dayOverrides.isNotEmpty()

    /** The restriction for one package, or null when the parent set none. */
    fun appRuleFor(packageName: String): AppRule? = appRules.firstOrNull { it.packageName == packageName }

    /** Packages the parent blocked (blocked wins over a stored limit). */
    val blockedPackages: Set<String> get() = appRules.filter { it.blocked }.mapTo(LinkedHashSet()) { it.packageName }

    override fun equals(other: Any?): Boolean = other is ScreenTimeConfig &&
        other.version == version &&
        other.dailyLimitMinutes == dailyLimitMinutes &&
        other.dayOverrides == dayOverrides &&
        other.bedtime == bedtime &&
        other.schoolModeEnabled == schoolModeEnabled &&
        other.appRules == appRules

    override fun hashCode(): Int =
        listOf(version, dailyLimitMinutes, dayOverrides, bedtime, schoolModeEnabled, appRules).hashCode()

    override fun toString(): String = "ScreenTimeConfig(v$version)"

    companion object {
        private val HHMM = Regex("""^([01][0-9]|2[0-3]):[0-5][0-9]$""")

        fun etagFor(version: Int): String = "\"v$version\""

        /** Null when any value is outside what the contract allows. Overrides are copied (sorted by weekday). */
        fun validated(
            version: Int,
            dailyLimitMinutes: Int?,
            dayOverrides: Map<Int, Int>,
            bedtime: BedtimeWindow?,
            schoolModeEnabled: Boolean,
            appRules: List<AppRule> = emptyList(),
        ): ScreenTimeConfig? {
            if (version !in 1..ScreenTimeLimits.MAX_VERSION) return null
            if (dailyLimitMinutes != null && dailyLimitMinutes !in 0..ScreenTimeLimits.MAX_MINUTES) return null
            val badOverride = dayOverrides.any { (day, minutes) ->
                day !in 1..ISO_WEEKDAYS || minutes !in 0..ScreenTimeLimits.MAX_MINUTES
            }
            if (badOverride) return null
            if (bedtime != null) {
                val badTimes = !HHMM.matches(bedtime.start) || !HHMM.matches(bedtime.end)
                if (badTimes || bedtime.start == bedtime.end) return null
            }
            val rules = AppRuleList.validated(appRules) ?: return null
            val sorted = dayOverrides.toSortedMap().toMap()
            return ScreenTimeConfig(version, dailyLimitMinutes, sorted, bedtime, schoolModeEnabled, rules)
        }

        const val ISO_WEEKDAYS = 7
    }
}

/** A validated config plus the local time the server last confirmed it (a 200 or a 304). */
class CachedScreenTimeConfig(val config: ScreenTimeConfig, val validatedAtEpochMillis: Long) {
    fun freshness(nowEpochMillis: Long): ConfigFreshness = ConfigFreshness.of(validatedAtEpochMillis, nowEpochMillis)

    /** The rules the app may apply right now: null once they have expired. */
    fun activeConfig(nowEpochMillis: Long): ScreenTimeConfig? =
        if (freshness(nowEpochMillis) == ConfigFreshness.EXPIRED) null else config

    override fun toString(): String = "CachedScreenTimeConfig(v${config.version})"
}

enum class ConfigFreshness {
    /** Confirmed recently enough. */
    FRESH,

    /** Not confirmed for a while: still applied, but the child is told the check-in is overdue. */
    STALE,

    /** Not confirmed for [ScreenTimeLimits.EXPIRY_DAYS]: no longer applied. */
    EXPIRED,
    ;

    companion object {
        /** A confirmation time in the future (clock moved back) counts as just now. Boundaries are inclusive. */
        fun of(validatedAtEpochMillis: Long, nowEpochMillis: Long): ConfigFreshness {
            val age = (nowEpochMillis - validatedAtEpochMillis).coerceAtLeast(0L)
            return when {
                age > ScreenTimeLimits.EXPIRY_MILLIS -> EXPIRED
                age > ScreenTimeLimits.STALE_MILLIS -> STALE
                else -> FRESH
            }
        }
    }
}

/** A 200 body that passed every contract check. */
class ParsedScreenTimeConfig(val config: ScreenTimeConfig, val serverTimeEpochMillis: Long) {
    override fun toString(): String = "ParsedScreenTimeConfig"
}

/** Turns the wire values of `deviceConfigSchema` into a [ScreenTimeConfig]; null for anything off-contract. */
object ScreenTimeConfigParser {
    private val WEEKDAY_KEY = Regex("^[1-7]$")

    @Suppress("LongParameterList")
    fun parse(
        version: Int,
        dailyLimitMinutes: Int?,
        dayOverrides: Map<String, Int>,
        bedtimeEnabled: Boolean,
        bedtimeStart: String?,
        bedtimeEnd: String?,
        schoolModeEnabled: Boolean,
        appRules: List<RawAppRule>,
        serverTime: String,
        nextIntervalSeconds: Int,
    ): ParsedScreenTimeConfig? {
        if (nextIntervalSeconds.toLong() != ScreenTimeLimits.INTERVAL_SECONDS) return null
        val serverMillis = try {
            Instant.parse(serverTime).toEpochMilli()
        } catch (_: Exception) {
            return null
        }
        if (dayOverrides.keys.any { !WEEKDAY_KEY.matches(it) }) return null
        val overrides = dayOverrides.mapKeys { it.key.toInt() }
        // The contract ties the two times to the switch: both set while on (and different), both null while off.
        val bedtime = if (bedtimeEnabled) {
            if (bedtimeStart == null || bedtimeEnd == null) return null
            BedtimeWindow(bedtimeStart, bedtimeEnd)
        } else {
            if (bedtimeStart != null || bedtimeEnd != null) return null
            null
        }
        if (appRules.size > AppRuleLimits.MAX_RULES) return null
        val rules = appRules.map { AppRule.validated(it) ?: return null }
        val config = ScreenTimeConfig.validated(
            version, dailyLimitMinutes, overrides, bedtime, schoolModeEnabled, rules,
        ) ?: return null
        return ParsedScreenTimeConfig(config, serverMillis)
    }
}

/**
 * Single-string form for the sealed store, versioned: `v2;validatedAt;version;limit;overrides;bedtime;school;apps`
 * where overrides is `1=60,3=0` (empty = none), bedtime is `HH:MM-HH:MM` (empty = off), school is `0|1` and apps is
 * the [AppRuleList] form (empty = none). The pre-18c form (six fields, no `v2`) reads as "nothing cached" on
 * purpose: the server's ETag now covers app rules, so an old cache could answer 304 and never receive them. A
 * missing cache makes the next pull a full one.
 */
object ScreenTimeConfigCodec {
    private const val FIELDS = 8
    private const val VERSION_TAG = "v2"

    fun encode(cached: CachedScreenTimeConfig): String = with(cached.config) {
        listOf(
            VERSION_TAG,
            cached.validatedAtEpochMillis.toString(),
            version.toString(),
            dailyLimitMinutes?.toString().orEmpty(),
            dayOverrides.entries.joinToString(",") { "${it.key}=${it.value}" },
            bedtime?.let { "${it.start}-${it.end}" }.orEmpty(),
            if (schoolModeEnabled) "1" else "0",
            AppRuleList.encode(appRules),
        ).joinToString(";")
    }

    /** Null for anything [encode] would not write, or that [ScreenTimeConfig.validated] would not let through. */
    fun decode(text: String?): CachedScreenTimeConfig? {
        val parts = text?.split(";") ?: return null
        if (parts.size != FIELDS || parts[0] != VERSION_TAG) return null
        val validatedAt = parts[1].toLongOrNull()?.takeIf { it > 0 } ?: return null
        val version = parts[2].toIntOrNull() ?: return null
        val limit = parts[3].ifEmpty { null }?.let { it.toIntOrNull() ?: return null }
        val overrides = linkedMapOf<Int, Int>()
        if (parts[4].isNotEmpty()) {
            for (pair in parts[4].split(",")) {
                val kv = pair.split("=")
                if (kv.size != 2) return null
                val day = kv[0].toIntOrNull() ?: return null
                val minutes = kv[1].toIntOrNull() ?: return null
                if (overrides.put(day, minutes) != null) return null
            }
        }
        val bedtime = if (parts[5].isEmpty()) {
            null
        } else {
            val window = parts[5].split("-")
            if (window.size != 2) return null
            BedtimeWindow(window[0], window[1])
        }
        val school = when (parts[6]) {
            "1" -> true
            "0" -> false
            else -> return null
        }
        val rules = AppRuleList.decode(parts[7]) ?: return null
        val config = ScreenTimeConfig.validated(version, limit, overrides, bedtime, school, rules) ?: return null
        return CachedScreenTimeConfig(config, validatedAt)
    }
}

/** When a config pull is worth doing in addition to the 6-hourly job. */
object ScreenTimeConfigPolicy {
    /**
     * Opening the app re-pulls once the last confirmation is old enough. No cache yet is NOT "due": the freshly
     * enqueued periodic job pulls immediately, an extra request would only duplicate it (same rule as the uploads).
     */
    fun needsPullNow(cache: CachedScreenTimeConfig?, nowEpochMillis: Long): Boolean {
        if (cache == null) return false
        return nowEpochMillis - cache.validatedAtEpochMillis >= ScreenTimeLimits.PULL_ON_RESUME_MILLIS
    }
}
