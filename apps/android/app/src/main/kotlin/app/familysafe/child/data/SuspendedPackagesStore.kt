package app.familysafe.child.data

import app.familysafe.child.domain.EnforcementStatus
import app.familysafe.child.domain.SuspendReason
import app.familysafe.child.domain.SuspendedCodec
import app.familysafe.child.domain.SuspendedStore
import kotlinx.coroutines.flow.MutableStateFlow
import kotlinx.coroutines.flow.StateFlow
import kotlinx.coroutines.flow.asStateFlow

/**
 * The packages managed mode paused, in the sealed [SecureStore] so a restart (or a disconnect) can resume exactly
 * those. Only package names and a one-letter reason; unreadable storage reads as "nothing paused by us".
 */
class SuspendedPackagesStore(private val store: SecureStore) : SuspendedStore {
    override fun read(): Map<String, SuspendReason> = try {
        SuspendedCodec.decode(store.get(KEY)) ?: emptyMap()
    } catch (_: Exception) {
        emptyMap()
    }

    override fun write(paused: Map<String, SuspendReason>) {
        try {
            if (paused.isEmpty()) store.remove(KEY) else store.put(KEY, SuspendedCodec.encode(paused))
        } catch (_: Exception) {
            // The next reconcile writes again; in the worst case a package is resumed a little late.
        }
    }

    override fun clear() {
        try {
            store.remove(KEY)
        } catch (_: Exception) {
            // Nothing more to do.
        }
    }

    private companion object {
        const val KEY = "managed_suspended"
    }
}

/** The latest enforcement result, in memory only. Derived on this phone; never stored here, never sent. */
class EnforcementStatusStore {
    private val state = MutableStateFlow<EnforcementStatus?>(null)
    val status: StateFlow<EnforcementStatus?> = state.asStateFlow()

    fun record(status: EnforcementStatus) {
        state.value = status
    }

    fun clear() {
        state.value = null
    }
}
