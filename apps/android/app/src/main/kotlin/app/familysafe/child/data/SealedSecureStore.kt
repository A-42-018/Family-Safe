package app.familysafe.child.data

import java.security.GeneralSecurityException
import java.util.Base64

/** Where sealed (already encrypted) blobs live. Android: private SharedPreferences. Tests: a map. */
interface BlobStorage {
    fun read(name: String): String?
    fun write(name: String, value: String)
    fun delete(name: String)
    fun deleteAll()
}

/** [SecureStore] on top of [AesGcmSealer] + [BlobStorage]. A value that fails to decrypt reads as absent and is dropped. */
class SealedSecureStore(
    private val sealer: AesGcmSealer,
    private val storage: BlobStorage,
) : SecureStore {
    override fun put(key: String, value: String) {
        val sealed = sealer.seal(key, value.toByteArray(Charsets.UTF_8))
        storage.write(key, Base64.getEncoder().encodeToString(sealed))
    }

    override fun get(key: String): String? {
        val stored = storage.read(key) ?: return null
        return try {
            String(sealer.open(key, Base64.getDecoder().decode(stored)), Charsets.UTF_8)
        } catch (_: GeneralSecurityException) {
            storage.delete(key)
            null
        } catch (_: IllegalArgumentException) {
            storage.delete(key)
            null
        }
    }

    override fun remove(key: String) = storage.delete(key)

    override fun clear() = storage.deleteAll()
}
