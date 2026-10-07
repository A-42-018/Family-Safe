package app.familysafe.child.data

import app.familysafe.child.domain.PermissionCatalog
import app.familysafe.child.domain.PermissionKey

/**
 * Two small facts the OS cannot tell us later: which permissions were ever seen granted (so a later "not granted"
 * reads as REVOKED) and which ones the app has asked the child for (so "not granted" reads as DENIED, not
 * "not requested"). Kept as one string `g:a,b;r:c` in [SecureStore]. Unreadable storage reads as "no history",
 * which can only make a state look less alarming (NOT_REQUESTED), never invent a grant.
 */
class PermissionHistoryStore(private val store: SecureStore) {
    private var granted: Set<PermissionKey>
    private var requested: Set<PermissionKey>

    init {
        val (g, r) = read()
        granted = g
        requested = r
    }

    @Synchronized
    fun everGranted(key: PermissionKey): Boolean = key in granted

    @Synchronized
    fun wasRequested(key: PermissionKey): Boolean = key in requested

    /** Adds keys seen granted right now. Writes only when something is new. */
    @Synchronized
    fun markGranted(keys: Collection<PermissionKey>) {
        val next = granted + keys.filter { it.wireName != null }
        if (next == granted) return
        granted = next
        persist()
    }

    /** Called by the phase that shows a permission prompt, right before it does. */
    @Synchronized
    fun markRequested(key: PermissionKey) {
        if (key.wireName == null || key in requested) return
        requested = requested + key
        persist()
    }

    private fun persist() {
        try {
            store.put(KEY_HISTORY, "g:${names(granted)};r:${names(requested)}")
        } catch (_: Exception) {
            // The in-memory value is still right for this process.
        }
    }

    private fun names(keys: Set<PermissionKey>): String =
        PermissionCatalog.SYNCED.filter { it in keys }.joinToString(",") { checkNotNull(it.wireName) }

    private fun read(): Pair<Set<PermissionKey>, Set<PermissionKey>> = try {
        val parts = store.get(KEY_HISTORY)?.split(";")
        if (parts == null || parts.size != 2 || !parts[0].startsWith("g:") || !parts[1].startsWith("r:")) {
            emptySet<PermissionKey>() to emptySet()
        } else {
            parse(parts[0].removePrefix("g:")) to parse(parts[1].removePrefix("r:"))
        }
    } catch (_: Exception) {
        emptySet<PermissionKey>() to emptySet()
    }

    private fun parse(list: String): Set<PermissionKey> =
        list.split(",").mapNotNull { name -> PermissionCatalog.SYNCED.firstOrNull { it.wireName == name } }.toSet()

    private companion object {
        const val KEY_HISTORY = "permission_history"
    }
}
