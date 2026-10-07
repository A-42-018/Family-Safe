package app.familysafe.child.ui.devicestatus

import app.familysafe.child.domain.SuspendReason
import app.familysafe.child.testutil.RepoFiles
import org.junit.jupiter.api.Assertions.assertEquals
import org.junit.jupiter.api.Assertions.assertFalse
import org.junit.jupiter.api.Assertions.assertTrue
import org.junit.jupiter.api.Test

class ManagedModeFormatTest {
    @Test
    fun `every reason has its own plain-words line`() {
        assertEquals(
            SuspendReason.entries.size,
            SuspendReason.entries.map { ManagedModeFormat.reasonText(it) }.toSet().size,
        )
    }

    @Test
    fun `managed-mode strings are honest`() {
        val strings = RepoFiles.read("apps/android/app/src/main/res/values/strings.xml")
        val lines = strings.lines().filter { it.contains("name=\"managed_") }
        assertTrue(lines.size >= 10)
        val banned = Regex(
            """\b(secure|safe|protected|guaranteed|unbreakable)\b|cannot be bypassed|locked out|cannot be undone|""" +
                """cannot be removed|prevent""",
            RegexOption.IGNORE_CASE,
        )
        lines.forEach { assertFalse(banned.containsMatchIn(it), it) }
        // off: says plainly that it cannot pause; on: says Android shows a message; always: what happens on disconnect
        assertTrue(strings.contains("it cannot pause other apps"))
        assertTrue(strings.contains("Android shows you a message"))
        assertTrue(strings.contains("every app FamilySafe paused is turned back on"))
    }
}
