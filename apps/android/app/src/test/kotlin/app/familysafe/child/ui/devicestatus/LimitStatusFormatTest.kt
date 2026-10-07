package app.familysafe.child.ui.devicestatus

import app.familysafe.child.domain.LimitInactiveReason
import app.familysafe.child.domain.LimitLevel
import org.junit.jupiter.api.Assertions.assertEquals
import org.junit.jupiter.api.Test

class LimitStatusFormatTest {
    @Test
    fun `every inactive reason has its own line`() {
        val ids = LimitInactiveReason.entries.map(LimitStatusFormat::inactiveMessage)
        assertEquals(LimitInactiveReason.entries.size, ids.toSet().size)
    }

    @Test
    fun `every level has its own line`() {
        val ids = LimitLevel.entries.map(LimitStatusFormat::levelMessage)
        assertEquals(LimitLevel.entries.size, ids.toSet().size)
    }
}
