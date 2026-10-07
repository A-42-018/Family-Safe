package app.familysafe.child.data

import app.familysafe.child.domain.SyncStatus
import kotlinx.coroutines.flow.MutableStateFlow
import kotlinx.coroutines.flow.StateFlow
import kotlinx.coroutines.flow.asStateFlow

/**
 * "Last sync" as shown to the child: the moment the server last acknowledged a heartbeat, kept in [SecureStore] so
 * it survives a restart. Not a secret, but it lives in the same sealed store instead of a second plaintext file.
 * Unreadable or broken storage reads as "never" — the screen then says so, which is the safe direction.
 */
class SyncStatusStore(private val store: SecureStore) {
    private val _status = MutableStateFlow(SyncStatus(read()))
    val status: StateFlow<SyncStatus> = _status.asStateFlow()

    fun recordSuccess(epochMillis: Long) {
        _status.value = SyncStatus(epochMillis)
        try {
            store.put(KEY_LAST_SYNC, epochMillis.toString())
        } catch (_: Exception) {
            // In-memory value is still right for this process.
        }
    }

    /** New enrollment or lost connection: a sync time from another pairing would be misleading. */
    fun clear() {
        _status.value = SyncStatus()
        try {
            store.remove(KEY_LAST_SYNC)
        } catch (_: Exception) {
            // Nothing more to do; the flow already says "never".
        }
    }

    private fun read(): Long? = try {
        store.get(KEY_LAST_SYNC)?.toLongOrNull()?.takeIf { it > 0 }
    } catch (_: Exception) {
        null
    }

    private companion object {
        const val KEY_LAST_SYNC = "last_sync_at"
    }
}
