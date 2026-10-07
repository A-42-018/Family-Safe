package app.familysafe.child.domain

/** Period of the WorkManager job; equals `PERMISSION_SYNC_INTERVAL_SECONDS` (a JVM test checks it). */
object PermissionSyncLimits {
    const val INTERVAL_HOURS = 6L

    /** On app resume an unchanged state is only re-sent when the last acknowledged sync is at least this old. */
    const val RESUME_MIN_AGE_MINUTES = 30L
}

/** What the OS says about one permission. No prompt is ever shown to find this out. */
interface PermissionProbe {
    /** False when this device or this distribution of the app cannot offer the permission at all. */
    fun isAvailable(key: PermissionKey): Boolean

    /** The current OS grant. False for anything not declared in the manifest. */
    fun isGranted(key: PermissionKey): Boolean
}

/** Everything [PermissionStateMapper] needs to name one state. */
data class PermissionFacts(
    val available: Boolean,
    val granted: Boolean,
    /** Seen granted at some earlier reading. */
    val everGranted: Boolean,
    /** The app asked the child for it at some point (later phases call `PermissionHistoryStore.markRequested`). */
    val requested: Boolean,
)

/**
 * Pure OS facts to contract state. `RESTRICTED` is never produced: no Android API this app uses reports it
 * (it exists in the contract for Phase 26 / managed devices).
 */
object PermissionStateMapper {
    fun map(facts: PermissionFacts): PermissionState = when {
        !facts.available -> PermissionState.NOT_AVAILABLE
        facts.granted -> PermissionState.GRANTED
        facts.everGranted -> PermissionState.REVOKED
        facts.requested -> PermissionState.DENIED
        else -> PermissionState.NOT_REQUESTED
    }
}

/** One complete reading of the eight synced permissions. Private constructor: incomplete maps cannot exist. */
class PermissionObservation private constructor(val states: Map<PermissionKey, PermissionState>) {
    override fun equals(other: Any?): Boolean = other is PermissionObservation && states == other.states

    override fun hashCode(): Int = states.hashCode()

    override fun toString(): String = "PermissionObservation"

    companion object {
        /** Null unless [states] holds exactly the synced keys. */
        fun create(states: Map<PermissionKey, PermissionState>): PermissionObservation? =
            if (states.keys == PermissionCatalog.SYNCED.toSet()) PermissionObservation(states.toMap()) else null
    }
}

/** What the server last acknowledged, and when. */
class PermissionSyncReport(val observation: PermissionObservation, val sentAtEpochMillis: Long) {
    override fun toString(): String = "PermissionSyncReport"
}

/** Single-string form of a [PermissionSyncReport]: `sentAt;STATE,STATE,...` in [PermissionCatalog.SYNCED] order. */
object PermissionSyncReportCodec {
    fun encode(report: PermissionSyncReport): String =
        report.sentAtEpochMillis.toString() + ";" +
            PermissionCatalog.SYNCED.joinToString(",") { report.observation.states.getValue(it).name }

    /** Null for anything [encode] would not write. */
    fun decode(text: String?): PermissionSyncReport? {
        val parts = text?.split(";") ?: return null
        if (parts.size != 2) return null
        val sentAt = parts[0].toLongOrNull()?.takeIf { it > 0 } ?: return null
        val names = parts[1].split(",")
        if (names.size != PermissionCatalog.SYNCED.size) return null
        val states = PermissionCatalog.SYNCED.zip(names).associate { (key, name) ->
            key to (PermissionState.entries.firstOrNull { it.name == name } ?: return null)
        }
        return PermissionObservation.create(states)?.let { PermissionSyncReport(it, sentAt) }
    }
}

/** What the Permissions screen shows: the current reading (or "not requested") and when it was last shared. */
class PermissionSnapshot(val entries: List<PermissionEntry>, val sharedAtEpochMillis: Long?) {
    override fun toString(): String = "PermissionSnapshot"

    companion object {
        fun initial(): PermissionSnapshot = PermissionSnapshot(PermissionCatalog.initial(), null)

        fun of(current: PermissionObservation?, report: PermissionSyncReport?): PermissionSnapshot {
            val shown = current ?: report?.observation
            val entries = PermissionKey.entries.map { key ->
                PermissionEntry(key, shown?.states?.get(key) ?: PermissionState.NOT_REQUESTED)
            }
            return PermissionSnapshot(entries, report?.sentAtEpochMillis)
        }
    }
}

/** When a permission upload is worth doing in addition to the 6-hour job. */
object PermissionSyncPolicy {
    private const val MILLIS_PER_MINUTE = 60_000L

    /**
     * On app resume: nothing acknowledged yet, a state that differs from the acknowledged one, or an acknowledged
     * sync older than [PermissionSyncLimits.RESUME_MIN_AGE_MINUTES]. Otherwise the periodic job is enough (the
     * server allows 12 uploads per hour, this stays far below it).
     */
    fun needsUploadNow(last: PermissionSyncReport?, current: PermissionObservation, nowEpochMillis: Long): Boolean {
        if (last == null) return true
        if (last.observation != current) return true
        val age = nowEpochMillis - last.sentAtEpochMillis
        return age >= PermissionSyncLimits.RESUME_MIN_AGE_MINUTES * MILLIS_PER_MINUTE
    }
}
