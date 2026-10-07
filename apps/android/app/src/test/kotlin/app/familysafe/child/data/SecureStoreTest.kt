package app.familysafe.child.data

import java.security.GeneralSecurityException
import javax.crypto.KeyGenerator
import javax.crypto.SecretKey
import org.junit.jupiter.api.Assertions.assertArrayEquals
import org.junit.jupiter.api.Assertions.assertEquals
import org.junit.jupiter.api.Assertions.assertFalse
import org.junit.jupiter.api.Assertions.assertNotEquals
import org.junit.jupiter.api.Assertions.assertNull
import org.junit.jupiter.api.Assertions.assertThrows
import org.junit.jupiter.api.Test

private class MapBlobStorage : BlobStorage {
    val map = linkedMapOf<String, String>()
    override fun read(name: String) = map[name]
    override fun write(name: String, value: String) {
        map[name] = value
    }
    override fun delete(name: String) {
        map.remove(name)
    }
    override fun deleteAll() = map.clear()
}

private fun newKey(): SecretKey = KeyGenerator.getInstance("AES").apply { init(256) }.generateKey()

class SecureStoreTest {
    private val blobs = MapBlobStorage()
    private val store: SecureStore = SealedSecureStore(AesGcmSealer(newKey()), blobs)

    @Test
    fun `round trips a value`() {
        store.put("refresh", "s3cr3t-token")
        assertEquals("s3cr3t-token", store.get("refresh"))
    }

    @Test
    fun `missing key reads as null`() {
        assertNull(store.get("nope"))
    }

    @Test
    fun `stored blob does not contain the plaintext`() {
        store.put("refresh", "s3cr3t-token")
        assertFalse(blobs.map.values.single().contains("s3cr3t"))
    }

    @Test
    fun `same value encrypts differently each time`() {
        store.put("a", "same")
        val first = blobs.map.getValue("a")
        store.put("a", "same")
        assertNotEquals(first, blobs.map.getValue("a"))
    }

    @Test
    fun `overwrite remove and clear`() {
        store.put("a", "1")
        store.put("a", "2")
        assertEquals("2", store.get("a"))
        store.put("b", "3")
        store.remove("a")
        assertNull(store.get("a"))
        assertEquals("3", store.get("b"))
        store.clear()
        assertNull(store.get("b"))
    }

    @Test
    fun `tampered or garbage blobs read as absent and are dropped`() {
        store.put("a", "1")
        blobs.map["a"] = blobs.map.getValue("a").reversed()
        assertNull(store.get("a"))
        assertFalse("a" in blobs.map)
        blobs.map["b"] = "%%% not base64 %%%"
        assertNull(store.get("b"))
        blobs.map["c"] = "AAAA"
        assertNull(store.get("c"))
    }

    @Test
    fun `blob moved to another key does not decrypt`() {
        store.put("a", "1")
        blobs.map["b"] = blobs.map.getValue("a")
        assertNull(store.get("b"))
    }

    @Test
    fun `a different key cannot open the value`() {
        store.put("a", "1")
        val other = SealedSecureStore(AesGcmSealer(newKey()), blobs)
        assertNull(other.get("a"))
    }

    @Test
    fun `sealer rejects truncated input and round trips bytes`() {
        val sealer = AesGcmSealer(newKey())
        val data = byteArrayOf(0, 1, 2, 127, -1)
        assertArrayEquals(data, sealer.open("n", sealer.seal("n", data)))
        assertThrows(GeneralSecurityException::class.java) { sealer.open("n", ByteArray(5)) }
    }
}
