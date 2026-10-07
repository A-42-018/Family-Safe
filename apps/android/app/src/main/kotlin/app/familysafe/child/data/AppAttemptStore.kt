package app.familysafe.child.data

import app.familysafe.child.domain.AppAttempt
import app.familysafe.child.domain.AppAttemptState
import app.familysafe.child.domain.AppAttemptStateCodec
import app.familysafe.child.domain.AppRuleLimits

/**
 * Detection bookkeeping and the small outbox of blocked-app attempts, kept in the sealed [SecureStore] so a restart
 * neither loses a pending attempt nor counts the same app twice. One string under one key. Unreadable or tampered
 * storage reads as an empty state. All changes go through [update], which is serialized, so concurrent checks (the
 * minute tick, a resume, a rules change) can never lose each other's writes.
 *
 * A pure watermark move is persisted at most every [AppRuleLimits.WATERMARK_PERSIST_MILLIS]; losing it only means
 * the next start looks a little further back, and de-duplication keeps that from counting anything twice.
 */
class AppAttemptStore(private val store: SecureStore) {
    private val lock = Any()
    private var state: AppAttemptState = read()
    private var persistedWatermark: Long? = state.watermarkMillis

    fun snapshot(): AppAttemptState = synchronized(lock) { state }

    /** Applies [transform] to the current state; returns the new state. */
    fun update(transform: (AppAttemptState) -> AppAttemptState): AppAttemptState = synchronized(lock) {
        val before = state
        val after = transform(before)
        state = after
        if (needsWrite(before, after)) write(after)
        after
    }

    /** Removes exactly the attempts in [sent] from the outbox (matched by package and time). */
    fun removePending(sent: List<AppAttempt>): AppAttemptState = update { current ->
        val gone = sent.toHashSet()
        current.copy(pending = current.pending.filterNot { it in gone })
    }

    /** Drops attempts the server could not accept any more. */
    fun replacePending(pending: List<AppAttempt>): AppAttemptState = update { it.copy(pending = pending) }

    /** New enrollment or lost connection: another pairing's history must not be reported. */
    fun clear() {
        synchronized(lock) {
            state = AppAttemptState()
            persistedWatermark = null
            try {
                store.remove(KEY_STATE)
            } catch (_: Exception) {
                // Nothing more to do; the in-memory state is already empty.
            }
        }
    }

    private fun needsWrite(before: AppAttemptState, after: AppAttemptState): Boolean {
        val otherChange = before.rulesVersion != after.rulesVersion ||
            before.lastSeen != after.lastSeen ||
            before.pending != after.pending
        if (otherChange) return true
        val moved = after.watermarkMillis ?: return false
        val last = persistedWatermark ?: return true
        return moved - last >= AppRuleLimits.WATERMARK_PERSIST_MILLIS
    }

    private fun write(value: AppAttemptState) {
        try {
            store.put(KEY_STATE, AppAttemptStateCodec.encode(value))
            persistedWatermark = value.watermarkMillis
        } catch (_: Exception) {
            // The in-memory value is still right for this process.
        }
    }

    private fun read(): AppAttemptState = try {
        AppAttemptStateCodec.decode(store.get(KEY_STATE)) ?: AppAttemptState()
    } catch (_: Exception) {
        AppAttemptState()
    }

    private companion object {
        const val KEY_STATE = "app_attempt_state"
    }
}
