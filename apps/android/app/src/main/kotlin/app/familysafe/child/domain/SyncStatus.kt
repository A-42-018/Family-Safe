package app.familysafe.child.domain

/** Last successful sync with the backend. `null` means it has never happened. */
data class SyncStatus(val lastSyncEpochMillis: Long? = null) {
    val hasSynced: Boolean get() = lastSyncEpochMillis != null
}
