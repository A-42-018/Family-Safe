package app.familysafe.child.testutil

import app.familysafe.child.data.SecureStore
import java.io.File
import kotlin.coroutines.Continuation
import kotlin.coroutines.EmptyCoroutineContext
import kotlin.coroutines.startCoroutine

/** Runs a suspend block that never really suspends (all fakes here are synchronous). No coroutines library needed. */
fun <T> runSuspend(block: suspend () -> T): T {
    var outcome: Result<T>? = null
    block.startCoroutine(Continuation(EmptyCoroutineContext) { outcome = it })
    return checkNotNull(outcome) { "Block suspended; use runTest for real asynchrony" }.getOrThrow()
}

/** In-memory [SecureStore] that records write order and can be told to fail. */
class MapSecureStore : SecureStore {
    val map = linkedMapOf<String, String>()
    val putKeys = mutableListOf<String>()
    var failPut: (String) -> Boolean = { false }
    var failGet: Boolean = false

    override fun put(key: String, value: String) {
        if (failPut(key)) throw IllegalStateException("put failed")
        putKeys += key
        map[key] = value
    }

    override fun get(key: String): String? {
        if (failGet) throw IllegalStateException("get failed")
        return map[key]
    }

    override fun remove(key: String) {
        map.remove(key)
    }

    override fun clear() = map.clear()
}

/** Finds a file in the monorepo from whatever directory the tests run in (Gradle: apps/android/app). */
object RepoFiles {
    fun root(): File {
        var dir: File? = File("").absoluteFile
        while (dir != null) {
            if (File(dir, "packages/contracts/src/enrollment.ts").exists()) return dir
            dir = dir.parentFile
        }
        error("Monorepo root not found")
    }

    fun read(relative: String): String = File(root(), relative).readText()

    /**
     * The permissions the app manifest itself requests: every `uses-permission` element except the ones marked
     * `tools:node="remove"` (those strip a library's permission and request nothing).
     */
    fun declaredPermissions(manifest: String): Set<String> {
        val element = Regex("""<uses-permission\b([^>]*?)/>""")
        val name = Regex("""android:name="android\.permission\.(\w+)"""")
        return element.findAll(manifest)
            .map { it.groupValues[1] }
            .filterNot { it.contains("tools:node=\"remove\"") }
            .mapNotNull { name.find(it)?.groupValues?.get(1) }
            .toSet()
    }
}

const val VALID_CODE = "0123456789ABCDEF"
const val VALID_CODE_TYPED = "0123-4567-89ab-cdef"
