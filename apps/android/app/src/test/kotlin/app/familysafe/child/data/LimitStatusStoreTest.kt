package app.familysafe.child.data

import app.familysafe.child.domain.LimitInactiveReason
import app.familysafe.child.domain.LimitStatus
import org.junit.jupiter.api.Assertions.assertEquals
import org.junit.jupiter.api.Test

class LimitStatusStoreTest {
    @Test
    fun `starts unchecked`() {
        assertEquals(LimitStatus.Unchecked, LimitStatusStore().status.value)
    }

    @Test
    fun `records the latest result and clears back to unchecked`() {
        val store = LimitStatusStore()
        val result = LimitStatus.Inactive(LimitInactiveReason.NO_LIMIT_TODAY, 5L)
        store.record(result)
        assertEquals(result, store.status.value)
        store.clear()
        assertEquals(LimitStatus.Unchecked, store.status.value)
    }
}
