package app.familysafe.child.domain

import app.familysafe.child.testutil.RepoFiles
import org.junit.jupiter.api.Assertions.assertEquals
import org.junit.jupiter.api.Assertions.assertFalse
import org.junit.jupiter.api.Assertions.assertTrue
import org.junit.jupiter.api.Test

/** Guards for the schedule layer: it informs only, needs nothing new from Android and sends nothing. */
class QuietTimeGuardTest {
    private val kt = "apps/android/app/src/main/kotlin/app/familysafe/child"
    private val strings = RepoFiles.read("apps/android/app/src/main/res/values/strings.xml")
    private val manifest = RepoFiles.read("apps/android/app/src/main/AndroidManifest.xml")

    private val scheduleFiles = listOf(
        "domain/Schedules.kt",
        "domain/ScheduleStatus.kt",
        "data/ScheduleStatusStore.kt",
        "work/ScheduleCheckRunner.kt",
        "work/ScheduleBoundaryWorker.kt",
        "ui/limit/QuietTimeScreen.kt",
        "ui/devicestatus/ScheduleFormat.kt",
    )

    @Test
    fun `no schedule file logs, talks to the network, stores, sets an alarm or draws over other apps`() {
        val banned = Regex(
            """Log\.|println|Timber|printStackTrace|bearerAuth|Authorization|HttpClient|SecureStore|""" +
                """SharedPreferences|AlarmManager|setExact|SCHEDULE_EXACT_ALARM|USE_EXACT_ALARM|""" +
                """BroadcastReceiver|registerReceiver|SYSTEM_ALERT_WINDOW|startForegroundService|""" +
                """NotificationManager|DevicePolicyManager|AccessibilityService""",
        )
        scheduleFiles.forEach { assertFalse(banned.containsMatchIn(RepoFiles.read("$kt/$it")), "$it must stay quiet") }
    }

    @Test
    fun `the manifest has no receiver, service or alarm permission for schedules`() {
        // Track B (T2): the one device-admin receiver is allowed, and only with the system-only permission.
        assertEquals(1, Regex("<receiver").findAll(manifest).count())
        assertTrue(manifest.contains("android.permission.BIND_DEVICE_ADMIN"))
        assertFalse(manifest.contains("<service"))
        assertFalse(manifest.contains("EXACT_ALARM"))
        assertFalse(manifest.contains("POST_NOTIFICATIONS"))
        assertFalse(manifest.contains("SYSTEM_ALERT_WINDOW"))
    }

    @Test
    fun `the boundary job needs no network and only replaces itself`() {
        val scheduler = RepoFiles.read("$kt/work/WorkScheduler.kt")
        val body = scheduler.substringAfter("fun scheduleBoundary").substringBefore("fun cancelScheduleBoundary")
        assertTrue(body.contains("setInitialDelay"))
        assertTrue(body.contains("ExistingWorkPolicy.REPLACE"))
        assertFalse(body.contains("networkConstraints"))
    }

    @Test
    fun `the schedules are re-checked on resume, on every tick, on a rules change and after a boundary`() {
        val container = RepoFiles.read("$kt/di/AppContainer.kt")
        // definition + the config collector + the foreground refresh + resume
        assertEquals(4, Regex("""\bcheckSchedules\(\)""").findAll(container).count())
        assertTrue(container.contains("ScheduleStatusStore()"))
        assertTrue(container.contains("workScheduler.cancelScheduleBoundary()"))
        assertTrue(RepoFiles.read("$kt/work/ScheduleBoundaryWorker.kt").contains("container.checkSchedules()"))
        assertTrue(RepoFiles.read("$kt/MainActivity.kt").contains("container.refreshLimitStatus()"))
    }

    @Test
    fun `the schedule strings tell the truth about what the app can do`() {
        val lines = strings.lines().filter {
            it.contains("name=\"quiet_") || it.contains("name=\"schedules_") || it.contains("name=\"schedule_type_")
        }
        assertTrue(lines.size >= 15)
        val banned = Regex(
            """\b(secure|safe|protected|guaranteed|prevent|prevents)\b|cannot be bypassed|locked out|stops you|""" +
                """reported to your parent""",
            RegexOption.IGNORE_CASE,
        )
        lines.forEach { assertFalse(banned.containsMatchIn(it), it) }
        assertTrue(strings.contains("It cannot lock the phone or close other apps"))
        assertTrue(strings.contains("The check runs on this phone and sends nothing"))
    }

    @Test
    fun `the old not applied yet claim is gone`() {
        assertFalse(strings.contains("not applied yet"))
        assertFalse(strings.contains("Schedules are not applied"))
    }
}
