package app.familysafe.child.data

import java.security.GeneralSecurityException
import java.security.SecureRandom
import javax.crypto.Cipher
import javax.crypto.SecretKey
import javax.crypto.spec.GCMParameterSpec

/**
 * AES-256-GCM with a fresh random 96-bit IV per message. Output = IV || ciphertext+tag.
 * The key is supplied by the caller (Android Keystore in production, a software key in JVM tests).
 * The record name is bound in as associated data so a value cannot be swapped between keys.
 */
class AesGcmSealer(private val key: SecretKey, private val random: SecureRandom = SecureRandom()) {
    fun seal(name: String, plaintext: ByteArray): ByteArray {
        val iv = ByteArray(IV_BYTES).also(random::nextBytes)
        val cipher = Cipher.getInstance(TRANSFORMATION)
        cipher.init(Cipher.ENCRYPT_MODE, key, GCMParameterSpec(TAG_BITS, iv))
        cipher.updateAAD(name.toByteArray(Charsets.UTF_8))
        return iv + cipher.doFinal(plaintext)
    }

    /** Throws [GeneralSecurityException] for tampered, truncated or mis-bound data. */
    fun open(name: String, sealed: ByteArray): ByteArray {
        if (sealed.size < IV_BYTES + TAG_BITS / 8) throw GeneralSecurityException("Sealed value too short")
        val cipher = Cipher.getInstance(TRANSFORMATION)
        cipher.init(Cipher.DECRYPT_MODE, key, GCMParameterSpec(TAG_BITS, sealed.copyOfRange(0, IV_BYTES)))
        cipher.updateAAD(name.toByteArray(Charsets.UTF_8))
        return cipher.doFinal(sealed, IV_BYTES, sealed.size - IV_BYTES)
    }

    private companion object {
        const val TRANSFORMATION = "AES/GCM/NoPadding"
        const val IV_BYTES = 12
        const val TAG_BITS = 128
    }
}
