package app.familysafe.child.domain

/** Why a package is paused in managed mode (Track B). Ordered by priority: the first reason found wins. */
enum class SuspendReason(val code: Char) {
    /** The parent blocked this app. */
    APP_BLOCKED('B'),

    /** This app reached its own daily limit. */
    APP_LIMIT('L'),

    /** Today's total screen-time limit is reached (non-system apps). */
    DAILY_LIMIT('D'),

    /** A schedule (bedtime, school, custom) is in force (non-system apps). */
    SCHEDULE('S'),
    ;

    companion object {
        fun fromCode(code: Char): SuspendReason? = entries.firstOrNull { it.code == code }
    }
}

/** Which packages should be paused right now and why. Built by [EnforcementPlanner]; applied only by managed mode. */
class EnforcementPlan(val suspend: Map<String, SuspendReason>) {
    val packages: Set<String> get() = suspend.keys

    override fun equals(other: Any?): Boolean = other is EnforcementPlan && other.suspend == suspend

    override fun hashCode(): Int = suspend.hashCode()

    override fun toString(): String = "EnforcementPlan(${suspend.size})"
}

/** Everything the planner reads. All of it is already on this phone; nothing here is fetched. */
class EnforcementInputs(
    /** The rules in force (null when none or expired: then nothing is paused). */
    val config: ScreenTimeConfig?,
    val appRules: AppRuleStatus,
    val limit: LimitStatus,
    val schedules: ScheduleStatus,
    /** Launcher apps the phone reported (the last inventory); used for the "all non-system apps" cases. */
    val installed: List<InstalledApp>,
) {
    override fun toString(): String = "EnforcementInputs"
}

/**
 * Pure decision: BLOCKED > app limit > daily total limit > schedule. Explicit parent rules (block, app limit) name
 * one package each and may hit a system app (Android may still refuse it). The two broad cases (total limit, schedule)
 * never touch system apps (phone, messages, settings, clock, camera ...) and never FamilySafe itself.
 */
object EnforcementPlanner {
    fun plan(inputs: EnforcementInputs): EnforcementPlan {
        val out = LinkedHashMap<String, SuspendReason>()

        fun add(packageName: String, reason: SuspendReason) {
            if (packageName != AppRuleLimits.CHILD_APP_PACKAGE && !out.containsKey(packageName)) {
                out[packageName] = reason
            }
        }
        inputs.config?.blockedPackages?.sorted()?.forEach { add(it, SuspendReason.APP_BLOCKED) }
        (inputs.appRules as? AppRuleStatus.Active)?.entries
            ?.filter { it.level == AppRuleLevel.LIMIT }
            ?.map { it.packageName }?.sorted()
            ?.forEach { add(it, SuspendReason.APP_LIMIT) }
        val broad = inputs.installed.filter { !it.isSystem }.map { it.packageName }.sorted()
        val dailyLimit = (inputs.limit as? LimitStatus.Active)?.evaluation?.level == LimitLevel.LIMIT
        if (dailyLimit) broad.forEach { add(it, SuspendReason.DAILY_LIMIT) }
        if ((inputs.schedules as? ScheduleStatus.Active)?.isQuiet == true) {
            broad.forEach {
                add(
                    it,
                    SuspendReason.SCHEDULE,
                )
            }
        }
        return EnforcementPlan(out)
    }
}

/** What enforcement did at [checkedAtEpochMillis]. Memory only: never stored (the paused set has its own store), never sent. */
class EnforcementStatus(
    val mode: ManagedModeState,
    /** Packages FamilySafe is pausing now and why. Empty in Track A. */
    val paused: Map<String, SuspendReason>,
    /** Packages Android refused to pause; FamilySafe does not retry them until they leave and re-enter the plan. */
    val refused: Set<String>,
    val checkedAtEpochMillis: Long,
) {
    override fun equals(other: Any?): Boolean = other is EnforcementStatus &&
        other.mode == mode &&
        other.paused == paused &&
        other.refused == refused &&
        other.checkedAtEpochMillis == checkedAtEpochMillis

    override fun hashCode(): Int = listOf(mode, paused, refused, checkedAtEpochMillis).hashCode()

    override fun toString(): String = "EnforcementStatus($mode, ${paused.size} paused)"

    companion object {
        /** The result of "inform only": nothing is paused, nothing was refused. */
        fun informOnly(nowEpochMillis: Long) =
            EnforcementStatus(ManagedModeState.NOT_MANAGED, emptyMap(), emptySet(), nowEpochMillis)
    }
}

/** Applies an [EnforcementPlan]. Track A informs (nothing to apply); Track B pauses apps. */
interface Enforcer {
    fun reconcile(plan: EnforcementPlan, nowEpochMillis: Long): EnforcementStatus

    /** Undoes everything this enforcer did (disconnect, revoke, rules gone). */
    fun releaseAll(nowEpochMillis: Long): EnforcementStatus
}

/** Track A: the notices (limit, app rule, quiet time) are the enforcement. Nothing is ever paused. */
class ConsumerEnforcer : Enforcer {
    override fun reconcile(plan: EnforcementPlan, nowEpochMillis: Long) = EnforcementStatus.informOnly(nowEpochMillis)

    override fun releaseAll(nowEpochMillis: Long) = EnforcementStatus.informOnly(nowEpochMillis)
}

/** The packages FamilySafe itself paused, so it can resume exactly those after a restart. */
interface SuspendedStore {
    fun read(): Map<String, SuspendReason>

    fun write(paused: Map<String, SuspendReason>)

    fun clear()
}

/**
 * Track B: pauses what the plan lists and resumes what it no longer lists, using only [PackageSuspender]. It only ever
 * resumes packages it paused itself (the [SuspendedStore]), so it cannot undo someone else's pause.
 */
class ManagedEnforcer(
    private val suspender: PackageSuspender,
    private val store: SuspendedStore,
) : Enforcer {
    private var refused: Set<String> = emptySet()

    override fun reconcile(plan: EnforcementPlan, nowEpochMillis: Long): EnforcementStatus {
        val desired = plan.suspend
        val current = store.read()
        val toResume = current.keys - desired.keys
        val toSuspend = desired.keys - current.keys - refused

        val resumedOk = resume(toResume)
        val failedSuspend = if (toSuspend.isEmpty()) emptySet() else suspender.setSuspended(toSuspend, true)
        refused = (refused intersect desired.keys) + failedSuspend

        val paused = LinkedHashMap<String, SuspendReason>()
        for ((pkg, reason) in current) if (pkg !in resumedOk) paused[pkg] = desired[pkg] ?: reason
        for (pkg in toSuspend) if (pkg !in failedSuspend) paused[pkg] = desired.getValue(pkg)
        store.write(paused)
        return EnforcementStatus(ManagedModeState.DEVICE_OWNER, paused, refused, nowEpochMillis)
    }

    override fun releaseAll(nowEpochMillis: Long): EnforcementStatus {
        val resumed = resume(store.read().keys)
        val left = store.read().filterKeys { it !in resumed }
        refused = emptySet()
        if (left.isEmpty()) store.clear() else store.write(left)
        return EnforcementStatus(ManagedModeState.DEVICE_OWNER, left, emptySet(), nowEpochMillis)
    }

    /** Resumes [packages]; returns the ones that are no longer paused (done, or no longer installed). */
    private fun resume(packages: Set<String>): Set<String> {
        if (packages.isEmpty()) return emptySet()
        val failed = suspender.setSuspended(packages, false)
        // A refused resume of a package that is gone or already running is finished; a still-paused one is retried.
        return packages.filterTo(HashSet()) { it !in failed || suspender.isSuspended(it) != true }
    }
}

/** Cache form of the paused set: `v1;pkg=B,pkg2=S` (empty set = `v1;`). Anything else reads as "nothing paused". */
object SuspendedCodec {
    private const val TAG = "v1"
    const val MAX = 1_000
    private val PACKAGE = Regex(AppInventoryLimits.PACKAGE_PATTERN)

    fun encode(paused: Map<String, SuspendReason>): String =
        TAG + ";" + paused.entries.sortedBy { it.key }.joinToString(",") { "${it.key}=${it.value.code}" }

    fun decode(text: String?): Map<String, SuspendReason>? {
        val parts = text?.split(";") ?: return null
        if (parts.size != 2 || parts[0] != TAG) return null
        if (parts[1].isEmpty()) return emptyMap()
        val out = LinkedHashMap<String, SuspendReason>()
        for (entry in parts[1].split(",")) {
            val kv = entry.split("=")
            if (kv.size != 2 || kv[1].length != 1) return null
            val reason = SuspendReason.fromCode(kv[1][0]) ?: return null
            if (!PACKAGE.matches(kv[0]) || kv[0] == AppRuleLimits.CHILD_APP_PACKAGE) return null
            if (out.put(kv[0], reason) != null) return null
        }
        return if (out.size > MAX) null else out
    }
}
