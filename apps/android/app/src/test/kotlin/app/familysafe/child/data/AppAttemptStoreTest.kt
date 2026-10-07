package app.familysafe.child.data

import app.familysafe.child.domain.AppAttempt
import app.familysafe.child.domain.AppAttemptState
import app.familysafe.child.domain.AppRuleInactiveReason
import app.familysafe.child.domain.AppRuleLimits
import app.familysafe.child.domain.AppRuleStatus
import app.familysafe.child.testutil.MapSecureStore
import org.junit.jupiter.api.Assertions.assertEquals
import org.junit.jupiter.api.Assertions.assertFalse
import org.junit.jupiter.api.Assertions.assertNull
import org.junit.jupiter.api.Assertions.assertTrue
import org.junit.jupiter.api.Test

class AppAttemptStoreTest {
    private val key = "app_attempt_state"
    private val a1 = AppAttempt("com.example.a", 1_000L)
    private val a2 = AppAttempt("com.example.b", 2_000L)

    @Test
    fun `starts empty`() {
        assertEquals(AppAttemptState(), AppAttemptStore(MapSecureStore()).snapshot())
    }

    @Test
    fun `an attempt is persisted at once and survives a restart`() {
        val backing = MapSecureStore()
        AppAttemptStore(backing).update { it.copy(rulesVersion = 3, watermarkMillis = 5_000L, pending = listOf(a1)) }
        val reopened = AppAttemptStore(backing).snapshot()
        assertEquals(3, reopened.rulesVersion)
        assertEquals(5_000L, reopened.watermarkMillis)
        assertEquals(listOf(a1), reopened.pending)
    }

    @Test
    fun `a pure watermark move is written at most every fifteen minutes`() {
        val backing = MapSecureStore()
        val store = AppAttemptStore(backing)
        store.update { it.copy(rulesVersion = 1, watermarkMillis = 1_000L) }
        val writes = backing.putKeys.size
        store.update { it.copy(watermarkMillis = 1_000L + AppRuleLimits.WATERMARK_PERSIST_MILLIS - 1) }
        assertEquals(writes, backing.putKeys.size)
        assertEquals(1_000L + AppRuleLimits.WATERMARK_PERSIST_MILLIS - 1, store.snapshot().watermarkMillis)
        store.update { it.copy(watermarkMillis = 1_000L + AppRuleLimits.WATERMARK_PERSIST_MILLIS) }
        assertEquals(writes + 1, backing.putKeys.size)
        // a restart after an unwritten move reads the older value: more is scanned, nothing is counted twice
        val moved = AppAttemptStore(backing).snapshot()
        assertEquals(1_000L + AppRuleLimits.WATERMARK_PERSIST_MILLIS, moved.watermarkMillis)
    }

    @Test
    fun `a changed rules version, dedupe memory or outbox is always written`() {
        val backing = MapSecureStore()
        val store = AppAttemptStore(backing)
        store.update { it.copy(rulesVersion = 1, watermarkMillis = 10L) }
        val n = backing.putKeys.size
        store.update { it.copy(rulesVersion = 2) }
        store.update { it.copy(lastSeen = mapOf("com.example.a" to 5L)) }
        store.update { it.copy(pending = listOf(a1)) }
        assertEquals(n + 3, backing.putKeys.size)
    }

    @Test
    fun `removePending removes exactly what was sent`() {
        val store = AppAttemptStore(MapSecureStore())
        store.update { it.copy(pending = listOf(a1, a2)) }
        store.removePending(listOf(a1))
        assertEquals(listOf(a2), store.snapshot().pending)
        store.removePending(listOf(AppAttempt("com.example.b", 2_001L)))
        assertEquals(listOf(a2), store.snapshot().pending)
    }

    @Test
    fun `replacePending swaps the outbox and keeps everything else`() {
        val store = AppAttemptStore(MapSecureStore())
        store.update { it.copy(rulesVersion = 4, watermarkMillis = 9L, pending = listOf(a1, a2)) }
        store.replacePending(listOf(a2))
        val s = store.snapshot()
        assertEquals(listOf(a2), s.pending)
        assertEquals(4, s.rulesVersion)
    }

    @Test
    fun `clear forgets memory and storage`() {
        val backing = MapSecureStore()
        val store = AppAttemptStore(backing)
        store.update { it.copy(rulesVersion = 1, pending = listOf(a1)) }
        store.clear()
        assertEquals(AppAttemptState(), store.snapshot())
        assertNull(backing.map[key])
        assertEquals(AppAttemptState(), AppAttemptStore(backing).snapshot())
        // a first watermark after clearing is written again
        store.update { it.copy(rulesVersion = 1, watermarkMillis = 5L) }
        assertTrue(backing.map.containsKey(key))
    }

    @Test
    fun `junk or tampered storage reads as an empty state`() {
        val backing = MapSecureStore()
        for (junk in listOf("yesterday", "v1;x;;;", "v1;;;com.a.a=0;", "v2;;;;")) {
            backing.map[key] = junk
            assertEquals(AppAttemptState(), AppAttemptStore(backing).snapshot(), junk)
        }
    }

    @Test
    fun `broken storage never throws and the process keeps its value`() {
        val backing = MapSecureStore().apply {
            failGet = true
            failPut = { true }
        }
        val store = AppAttemptStore(backing)
        assertEquals(AppAttemptState(), store.snapshot())
        store.update { it.copy(rulesVersion = 1, pending = listOf(a1)) }
        assertEquals(listOf(a1), store.snapshot().pending)
        store.clear()
        assertTrue(store.snapshot().pending.isEmpty())
    }

    @Test
    fun `the stored string holds package names and times only`() {
        val backing = MapSecureStore()
        AppAttemptStore(backing).update { it.copy(rulesVersion = 1, watermarkMillis = 7L, pending = listOf(a1)) }
        assertEquals("v1;1;7;;com.example.a=1000", backing.map[key])
    }

    // --- status store ---

    @Test
    fun `the status store is memory only and resets`() {
        val store = AppRuleStatusStore()
        assertEquals(AppRuleStatus.Unchecked, store.status.value)
        val inactive = AppRuleStatus.Inactive(AppRuleInactiveReason.NO_APP_RULES, 3L)
        store.record(inactive)
        assertEquals(inactive, store.status.value)
        store.clear()
        assertEquals(AppRuleStatus.Unchecked, store.status.value)
        assertFalse(store.status.value is AppRuleStatus.Inactive)
    }
}
