package app.familysafe.child.data

import app.familysafe.child.domain.DeviceAuthState
import app.familysafe.child.domain.EnrollmentState

/** The only things this app persists about its enrollment. Never printed. */
class DeviceCredentials(
    val deviceId: String,
    val refreshToken: String,
    val refreshExpiresAtEpochMillis: Long,
) {
    override fun toString(): String = "DeviceCredentials"
}

/**
 * Device id + refresh token in [SecureStore]. `device_id` is written LAST and removed FIRST, so a crash halfway
 * never leaves something that reads as "enrolled" without a usable token; partial leftovers read as absent and
 * are cleaned up.
 */
class CredentialStore(private val store: SecureStore) {
    fun save(credentials: DeviceCredentials) {
        try {
            store.remove(KEY_DISCONNECT_REASON)
            store.put(KEY_REFRESH_TOKEN, credentials.refreshToken)
            store.put(KEY_REFRESH_EXPIRES, credentials.refreshExpiresAtEpochMillis.toString())
            store.put(KEY_DEVICE_ID, credentials.deviceId)
        } catch (e: Exception) {
            clear()
            throw e
        }
    }

    fun load(): DeviceCredentials? {
        val id = store.get(KEY_DEVICE_ID)
        val token = store.get(KEY_REFRESH_TOKEN)
        val expiry = store.get(KEY_REFRESH_EXPIRES)?.toLongOrNull()
        if (id.isNullOrEmpty() || token.isNullOrEmpty() || expiry == null) {
            if (id != null || token != null || store.get(KEY_REFRESH_EXPIRES) != null) clear()
            return null
        }
        return DeviceCredentials(id, token, expiry)
    }

    fun state(): EnrollmentState = load()?.let { EnrollmentState.Enrolled(it.deviceId) } ?: EnrollmentState.NotEnrolled

    /** Pre-flight: can this device seal and read back a value right now? Checked BEFORE a code is redeemed. */
    fun isWritable(): Boolean = try {
        store.put(KEY_PROBE, "ok")
        (store.get(KEY_PROBE) == "ok").also { store.remove(KEY_PROBE) }
    } catch (_: Exception) {
        false
    }

    /**
     * Remembers WHY the credentials are gone, so the "disconnected" explanation survives an app restart. It holds
     * only the state name (no secret). [clear] leaves it alone; [save] (a new enrollment or a rotation) removes it.
     */
    fun markDisconnected(reason: DeviceAuthState) {
        require(reason.isDisconnected)
        store.put(KEY_DISCONNECT_REASON, reason.name)
    }

    fun disconnectReason(): DeviceAuthState? =
        DeviceAuthState.entries.firstOrNull { it.isDisconnected && it.name == store.get(KEY_DISCONNECT_REASON) }

    fun clear() {
        store.remove(KEY_DEVICE_ID)
        store.remove(KEY_REFRESH_TOKEN)
        store.remove(KEY_REFRESH_EXPIRES)
    }

    private companion object {
        const val KEY_DEVICE_ID = "device_id"
        const val KEY_REFRESH_TOKEN = "device_refresh_token"
        const val KEY_REFRESH_EXPIRES = "device_refresh_expires_at"
        const val KEY_PROBE = "storage_probe"
        const val KEY_DISCONNECT_REASON = "disconnect_reason"
    }
}
