package app.familysafe.child.domain

/**
 * Limits of the per-app rules and of the blocked-app attempt report. The constants are checked against
 * `device-config.ts` / `device-app-events.ts` (and the Edge mirror) by JVM drift tests.
 */
object AppRuleLimits {
    /** `APP_RULES_MAX`: at most this many rules per device. */
    const val MAX_RULES = 200

    /** `CHILD_APP_PACKAGE`: this app can never be restricted. */
    const val CHILD_APP_PACKAGE = "app.familysafe.child"

    /** `DEVICE_APP_EVENTS_MAX`: at most this many events in one upload. */
    const val EVENTS_MAX = 20

    /** SQL window of `device_record_app_attempts`: up to 24 h late, 5 minutes ahead. */
    const val EVENT_PAST_SECONDS = 86_400L
    const val EVENT_FUTURE_SECONDS = 300L

    /** `APP_EVENT_EDGE_MARGIN_SECONDS`: the Edge accepts a window narrower by this much on both sides. */
    const val EVENT_EDGE_MARGIN_SECONDS = 60L

    /** Extra safety on top of the Edge margin so a slightly wrong device clock cannot cause a permanent 400. */
    const val EVENT_CLIENT_MARGIN_SECONDS = 60L

    /** The server ignores a second attempt for the same package within this many seconds; the app does the same. */
    const val ATTEMPT_DEDUPE_SECONDS = 300L

    /** Attempts waiting for an upload (oldest are dropped first) and packages remembered for de-duplication. */
    const val OUTBOX_MAX = 40
    const val LAST_SEEN_MAX = 200

    /** How far back a check looks for opened apps (never further than the server would accept). */
    const val SCAN_MAX_MILLIS = (EVENT_PAST_SECONDS - EVENT_EDGE_MARGIN_SECONDS - EVENT_CLIENT_MARGIN_SECONDS) * 1_000L

    /** Persisting a pure watermark move at most this often (attempts and rule changes are persisted at once). */
    const val WATERMARK_PERSIST_MILLIS = 15L * 60L * 1_000L
}

/** One rule exactly as the wire carries it, before validation. */
class RawAppRule(val packageName: String, val blocked: Boolean, val dailyLimitMinutes: Int?) {
    override fun toString(): String = "RawAppRule"
}

/**
 * One app restriction from the parent. A rule restricts something: [blocked], or a daily limit (0 = no use that
 * day). While [blocked] the stored limit is kept but ignored (blocked wins). Built only through [validated], so an
 * off-contract rule can never reach the cache or the screens. `toString` is fixed (it never names the package).
 */
class AppRule private constructor(
    val packageName: String,
    val blocked: Boolean,
    val dailyLimitMinutes: Int?,
) {
    override fun equals(other: Any?): Boolean = other is AppRule &&
        other.packageName == packageName &&
        other.blocked == blocked &&
        other.dailyLimitMinutes == dailyLimitMinutes

    override fun hashCode(): Int = listOf(packageName, blocked, dailyLimitMinutes).hashCode()

    override fun toString(): String = "AppRule"

    companion object {
        private val PACKAGE = Regex(AppInventoryLimits.PACKAGE_PATTERN)

        /** Null for anything `appRuleSchema` would not send. */
        fun validated(packageName: String, blocked: Boolean, dailyLimitMinutes: Int?): AppRule? {
            if (packageName.length > AppInventoryLimits.PACKAGE_MAX || !PACKAGE.matches(packageName)) return null
            if (packageName == AppRuleLimits.CHILD_APP_PACKAGE) return null
            if (dailyLimitMinutes != null && dailyLimitMinutes !in 0..ScreenTimeLimits.MAX_MINUTES) return null
            if (!blocked && dailyLimitMinutes == null) return null
            return AppRule(packageName, blocked, dailyLimitMinutes)
        }

        fun validated(raw: RawAppRule): AppRule? = validated(raw.packageName, raw.blocked, raw.dailyLimitMinutes)
    }
}

/** Validation and storage form of the rule list inside a [ScreenTimeConfig]. */
object AppRuleList {
    /** Null when a rule is off-contract, a package appears twice or there are more than the cap. Sorted by package. */
    fun validated(rules: List<AppRule>): List<AppRule>? {
        if (rules.size > AppRuleLimits.MAX_RULES) return null
        if (rules.map { it.packageName }.toSet().size != rules.size) return null
        return rules.sortedBy { it.packageName }
    }

    /**
     * `pkg=B` (blocked), `pkg=B60` (blocked, stored limit 60 kept), `pkg=L60` (limit 60), joined by commas;
     * empty = no rules. Package names never contain `=`, `,` or `;`.
     */
    fun encode(rules: List<AppRule>): String = rules.joinToString(",") { rule ->
        val limit = rule.dailyLimitMinutes
        val code = if (rule.blocked) "B${limit ?: ""}" else "L$limit"
        "${rule.packageName}=$code"
    }

    private val CODE = Regex("""^(?:B([0-9]{1,4})?|L([0-9]{1,4}))$""")

    /** Null for anything [encode] would not write or [AppRule.validated] would not let through. */
    fun decode(text: String): List<AppRule>? {
        if (text.isEmpty()) return emptyList()
        val rules = ArrayList<AppRule>()
        for (pair in text.split(",")) {
            val kv = pair.split("=")
            if (kv.size != 2) return null
            val match = CODE.matchEntire(kv[1]) ?: return null
            val blocked = kv[1].startsWith("B")
            val limitText = if (blocked) match.groupValues[1] else match.groupValues[2]
            val limit = if (limitText.isEmpty()) null else limitText.toInt()
            rules += AppRule.validated(kv[0], blocked, limit) ?: return null
        }
        return rules
    }
}
