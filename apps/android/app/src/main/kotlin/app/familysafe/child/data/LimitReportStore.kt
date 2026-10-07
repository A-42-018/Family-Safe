package app.familysafe.child.data

import app.familysafe.child.domain.LimitReportState
import app.familysafe.child.domain.LimitReportStateCodec

/**
 * The tiny outbox of the "daily limit reached" report, kept in the sealed [SecureStore] so a restart neither loses a
 * pending report nor sends the same day twice. One string under one key; unreadable or tampered storage reads as an
 * empty state. All changes go through [update], which is serialized.
 */
class LimitReportStore(private val store: SecureStore) {
    private val lock = Any()
    private var state: LimitReportState = read()

    fun snapshot(): LimitReportState = synchronized(lock) { state }

    fun update(transform: (LimitReportState) -> LimitReportState): LimitReportState = synchronized(lock) {
        val before = state
        val after = transform(before)
        state = after
        if (after != before) write(after)
        after
    }

    /** New enrollment or lost connection: another pairing's history must not be reported. */
    fun clear() {
        synchronized(lock) {
            state = LimitReportState()
            try {
                store.remove(KEY_STATE)
            } catch (_: Exception) {
                // Nothing more to do; the in-memory state is already empty.
            }
        }
    }

    private fun write(value: LimitReportState) {
        try {
            store.put(KEY_STATE, LimitReportStateCodec.encode(value))
        } catch (_: Exception) {
            // The in-memory value is still right for this process.
        }
    }

    private fun read(): LimitReportState = try {
        LimitReportStateCodec.decode(store.get(KEY_STATE)) ?: LimitReportState()
    } catch (_: Exception) {
        LimitReportState()
    }

    private companion object {
        const val KEY_STATE = "limit_report"
    }
}
