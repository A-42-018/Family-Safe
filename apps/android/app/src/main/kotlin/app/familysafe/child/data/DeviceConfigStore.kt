package app.familysafe.child.data

import app.familysafe.child.domain.CachedScreenTimeConfig
import app.familysafe.child.domain.ScreenTimeConfig
import app.familysafe.child.domain.ScreenTimeConfigCodec
import kotlinx.coroutines.flow.MutableStateFlow
import kotlinx.coroutines.flow.StateFlow
import kotlinx.coroutines.flow.asStateFlow

/**
 * The parent's rules as the server last sent them, cached in the sealed [SecureStore] so they survive a restart and
 * work offline (prompt §30). One string under one key, so a restart can never see half a config. Unreadable, broken
 * or tampered storage reads as "no rules yet" — the screens then say so. Expiry is NOT decided here: the cache keeps
 * the confirmation time and readers ask [CachedScreenTimeConfig.activeConfig].
 */
class DeviceConfigStore(private val store: SecureStore) {
    private val _cached = MutableStateFlow(read())
    val cached: StateFlow<CachedScreenTimeConfig?> = _cached.asStateFlow()

    /** A new config from the server, confirmed at [nowEpochMillis]. */
    fun record(config: ScreenTimeConfig, nowEpochMillis: Long) = write(CachedScreenTimeConfig(config, nowEpochMillis))

    /**
     * The server confirmed [version] (304). Only the confirmation time moves, and only when that version is the
     * cached one; returns false when the cache changed or vanished meanwhile (the caller then pulls in full).
     */
    fun confirm(version: Int, nowEpochMillis: Long): Boolean {
        val current = _cached.value ?: return false
        if (current.config.version != version) return false
        write(CachedScreenTimeConfig(current.config, nowEpochMillis))
        return true
    }

    /** New enrollment or lost connection: another pairing's rules must not keep applying or being shown. */
    fun clear() {
        _cached.value = null
        try {
            store.remove(KEY_CONFIG)
        } catch (_: Exception) {
            // Nothing more to do; the flow already says "no rules".
        }
    }

    private fun write(cached: CachedScreenTimeConfig) {
        _cached.value = cached
        try {
            store.put(KEY_CONFIG, ScreenTimeConfigCodec.encode(cached))
        } catch (_: Exception) {
            // The in-memory value is still right for this process.
        }
    }

    private fun read(): CachedScreenTimeConfig? = try {
        ScreenTimeConfigCodec.decode(store.get(KEY_CONFIG))
    } catch (_: Exception) {
        null
    }

    private companion object {
        const val KEY_CONFIG = "screen_time_config"
    }
}
