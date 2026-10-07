package app.familysafe.child.domain

import app.familysafe.child.testutil.RepoFiles
import org.junit.jupiter.api.Assertions.assertEquals
import org.junit.jupiter.api.Assertions.assertFalse
import org.junit.jupiter.api.Assertions.assertTrue
import org.junit.jupiter.api.Test

/** Source-level guards for 18c: the app notices and informs; it never blocks, locks, draws over or disguises. */
class AppRuleEnforcementGuardTest {
    private val base = "apps/android/app/src/main/kotlin/app/familysafe/child"
    private fun src(path: String) = RepoFiles.read("$base/$path")
    private val strings = RepoFiles.read("apps/android/app/src/main/res/values/strings.xml")

    private val ruleFiles = listOf(
        "domain/AppRules.kt",
        "domain/AppRuleEnforcement.kt",
        "data/AppAttemptStore.kt",
        "data/AppRuleStatusStore.kt",
        "work/AppRuleCheckRunner.kt",
        "work/AppAttemptRunner.kt",
        "ui/limit/AppRuleNoticeScreen.kt",
        "ui/devicestatus/AppRuleStatusFormat.kt",
    )

    @Test
    fun `nothing in the app blocks, locks or draws over other apps`() {
        val banned = Regex(
            "SYSTEM_ALERT_WINDOW|TYPE_APPLICATION_OVERLAY|killBackgroundProcesses|startLockTask|DevicePolicyManager|" +
                "lockNow|AccessibilityService|BIND_ACCESSIBILITY|setApplicationHidden|setPackagesSuspended|" +
                "FLAG_KEEP_SCREEN_ON|moveTaskToBack|finishAffinity|ACTION_DELETE|ACTION_UNINSTALL_PACKAGE",
        )
        (ruleFiles + listOf("ui/ChildApp.kt", "MainActivity.kt", "di/AppContainer.kt")).forEach {
            assertFalse(banned.containsMatchIn(src(it)), "$it must not block or overlay")
        }
        assertFalse(banned.containsMatchIn(RepoFiles.read("apps/android/app/src/main/AndroidManifest.xml")))
    }

    @Test
    fun `this phase adds no permission and no component`() {
        val manifest = RepoFiles.read("apps/android/app/src/main/AndroidManifest.xml")
        assertEquals(
            setOf("INTERNET", "ACCESS_NETWORK_STATE", "RECEIVE_BOOT_COMPLETED", "PACKAGE_USAGE_STATS"),
            RepoFiles.declaredPermissions(manifest),
        )
        assertFalse(manifest.contains("<service"))
        // Track B (T2) added exactly one receiver: the device-admin component, bindable only by the system.
        assertEquals(1, Regex("<receiver").findAll(manifest).count())
        assertTrue(manifest.contains("android:permission=\"android.permission.BIND_DEVICE_ADMIN\""))
        assertFalse(manifest.contains("android.permission.QUERY_ALL_PACKAGES"))
    }

    @Test
    fun `the rule check itself is local and silent`() {
        val banned = Regex("""Ktor|DeviceHttp|DeviceGetHttp|SharedPreferences|File\(|Log\.|println""")
        val files = listOf(
            "domain/AppRules.kt",
            "domain/AppRuleEnforcement.kt",
            "data/AppRuleStatusStore.kt",
            "work/AppRuleCheckRunner.kt",
        )
        files.forEach { assertFalse(banned.containsMatchIn(src(it)), "$it must stay local and silent") }
    }

    @Test
    fun `the app-rule status is memory only, the attempt bookkeeping is the only thing stored`() {
        val container = src("di/AppContainer.kt")
        assertTrue(container.contains("AppRuleStatusStore()"))
        assertFalse(Regex("""appRuleStatusStore\s*=\s*.*secureStore""").containsMatchIn(container))
        assertTrue(container.contains("AppAttemptStore("))
    }

    @Test
    fun `an upload only ever carries package names and times of blocked apps`() {
        val dto = src("data/AppAttemptDtos.kt")
        assertTrue(dto.contains("package_name"))
        assertTrue(dto.contains("occurred_at"))
        assertFalse(dto.contains("label"))
        assertFalse(dto.contains("minutes"))
        assertFalse(dto.contains("usage"))
    }

    @Test
    fun `the strings are honest about what the app can and cannot do`() {
        val lines = strings.lines().filter { it.contains("name=\"app_rule") || it.contains("name=\"limit_check_note") }
        assertTrue(lines.isNotEmpty())
        val banned = Regex(
            """\b(secure|safe|protected|guaranteed)\b|cannot be bypassed|locked out|prevent|stops you""",
            RegexOption.IGNORE_CASE,
        )
        lines.forEach { assertFalse(banned.containsMatchIn(it), it) }
        assertTrue(strings.contains("cannot close other apps or lock the phone"))
        assertTrue(strings.contains("your parent is told which app and when"))
        assertTrue(strings.contains("Nothing else about your app use is sent for this"))
    }

    @Test
    fun `the old claim that nothing is reported is gone`() {
        assertFalse(strings.contains("Nothing about it is sent to your parent"))
        assertTrue(strings.contains("name=\"limit_check_note\""))
        val note = strings.lines().first { it.contains("name=\"limit_check_note\"") }
        assertTrue(note.contains("screen-time limit"))
        assertTrue(note.contains("app rules"))
    }

    @Test
    fun `the foreground check is the existing once-a-minute tick, nothing runs in the background service`() {
        val activity = src("MainActivity.kt")
        assertTrue(activity.contains("AppRuleCheckRunner") || src("di/AppContainer.kt").contains("AppRuleCheckRunner"))
        assertTrue(activity.contains("repeatOnLifecycle(Lifecycle.State.STARTED)"))
        assertFalse(src("work/WorkScheduler.kt").contains("AppRuleCheck"))
        assertFalse(src("di/AppContainer.kt").contains("startForeground"))
    }

    @Test
    fun `the blocked-app notice names no package outside the app and says the app cannot close it`() {
        val screen = src("ui/limit/AppRuleNoticeScreen.kt")
        assertTrue(screen.contains("app_rule_notice_cannot_close"))
        assertTrue(screen.contains("BackHandler"))
        assertFalse(screen.contains("packageName"))
    }
}
