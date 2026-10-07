package app.familysafe.child.domain

import app.familysafe.child.testutil.RepoFiles
import org.junit.jupiter.api.Assertions.assertEquals
import org.junit.jupiter.api.Assertions.assertFalse
import org.junit.jupiter.api.Assertions.assertTrue
import org.junit.jupiter.api.Test

/** Source-level guards for 17c-2: the limit check informs the child; it never locks, never sends, never stores. */
class LimitEnforcementGuardTest {
    private val base = "apps/android/app/src/main/kotlin/app/familysafe/child"
    private fun src(path: String) = RepoFiles.read("$base/$path")

    private val checkFiles = listOf(
        "domain/ScreenTimeEnforcement.kt",
        "data/LimitStatusStore.kt",
        "work/LimitCheckRunner.kt",
    )

    @Test
    fun `the limit check has no network, storage or logging`() {
        val banned = Regex("""SecureStore|Ktor|DeviceHttp|DeviceGetHttp|SharedPreferences|File\(|Log\.|println""")
        checkFiles.forEach { assertFalse(banned.containsMatchIn(src(it)), "$it must stay local and silent") }
    }

    @Test
    fun `nothing in the app locks the phone or draws over other apps`() {
        val banned = Regex(
            "SYSTEM_ALERT_WINDOW|TYPE_APPLICATION_OVERLAY|killBackgroundProcesses|startLockTask|" +
                "DevicePolicyManager|lockNow|AccessibilityService|BIND_ACCESSIBILITY|FLAG_KEEP_SCREEN_ON",
        )
        val files = checkFiles + listOf("ui/limit/LimitReachedScreen.kt", "ui/ChildApp.kt", "MainActivity.kt")
        files.forEach { assertFalse(banned.containsMatchIn(src(it)), "$it must not lock or overlay") }
        assertFalse(banned.containsMatchIn(RepoFiles.read("apps/android/app/src/main/AndroidManifest.xml")))
    }

    @Test
    fun `this phase adds no permission`() {
        val manifest = RepoFiles.read("apps/android/app/src/main/AndroidManifest.xml")
        assertEquals(
            setOf("INTERNET", "ACCESS_NETWORK_STATE", "RECEIVE_BOOT_COMPLETED", "PACKAGE_USAGE_STATS"),
            RepoFiles.declaredPermissions(manifest),
        )
    }

    @Test
    fun `the limit status is never written to the sealed store`() {
        val container = src("di/AppContainer.kt")
        assertFalse(Regex("""limitStatusStore\s*=\s*.*secureStore""").containsMatchIn(container))
        assertTrue(container.contains("LimitStatusStore()"))
    }

    @Test
    fun `limit strings tell the truth about what the app can do`() {
        val strings = RepoFiles.read("apps/android/app/src/main/res/values/strings.xml")
        val limitLines = strings.lines().filter { it.contains("name=\"limit_") || it.contains("rules_applies_note") }
        assertTrue(limitLines.isNotEmpty())
        val banned = Regex(
            """\b(secure|safe|protected|guaranteed)\b|cannot be bypassed|locked out|reported to your parent""",
            RegexOption.IGNORE_CASE,
        )
        limitLines.forEach { assertFalse(banned.containsMatchIn(it), it) }
        assertTrue(strings.contains("cannot lock the phone"))
        // 18c: the screen-time check itself still reports nothing; only a blocked app being opened is reported
        assertTrue(strings.contains("The screen-time limit check sends nothing to your parent"))
    }

    @Test
    fun `the foreground check repeats once a minute and stops with the screen`() {
        assertEquals(60_000L, LimitCheckTimings.FOREGROUND_TICK_MILLIS)
        val activity = src("MainActivity.kt")
        assertTrue(activity.contains("repeatOnLifecycle(Lifecycle.State.STARTED)"))
        assertTrue(activity.contains("LimitCheckTimings.FOREGROUND_TICK_MILLIS"))
    }

    @Test
    fun `no endpoint or contract is touched by the limit check`() {
        assertFalse(RepoFiles.read("$base/work/WorkScheduler.kt").contains("LimitCheck"))
    }
}
