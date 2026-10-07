package app.familysafe.child.data

/**
 * Small key-value store for secrets (device refresh token in Phase 10/11). Values are encrypted at rest.
 * Implementations must never log keys or values.
 */
interface SecureStore {
    fun put(key: String, value: String)
    fun get(key: String): String?
    fun remove(key: String)
    fun clear()
}
