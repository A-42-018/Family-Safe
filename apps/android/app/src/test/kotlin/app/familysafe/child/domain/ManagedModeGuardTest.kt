package app.familysafe.child.domain

import app.familysafe.child.testutil.RepoFiles
import org.junit.jupiter.api.Assertions.assertEquals
import org.junit.jupiter.api.Assertions.assertFalse
import org.junit.jupiter.api.Assertions.assertTrue
import org.junit.jupiter.api.Test

/** Guards for Track B (T2-T4): one API, one receiver, no permission, no hiding, no anti-removal. */
class ManagedModeGuardTest {
    private val base = "apps/android/app/src/main/kotlin/app/familysafe/child"
    private fun src(path: String) = RepoFiles.read("$base/$path")
    private val manifest = RepoFiles.read("apps/android/app/src/main/AndroidManifest.xml")

    @Test
    fun `the device-admin receiver is the only added component and is protected by the system permission`() {
        val receiver = manifest.substringAfter("<receiver").substringBefore("</receiver>")
        assertTrue(receiver.contains("android:name=\".admin.FamilySafeAdminReceiver\""))
        assertTrue(receiver.contains("android:permission=\"android.permission.BIND_DEVICE_ADMIN\""))
        assertEquals(1, Regex("<receiver").findAll(manifest).count())
        assertEquals(1, Regex("<activity").findAll(manifest).count())
        assertFalse(manifest.contains("<service"))
        assertFalse(manifest.contains("<provider"))
    }

    @Test
    fun `no new permission is requested`() {
        assertEquals(
            setOf("INTERNET", "ACCESS_NETWORK_STATE", "RECEIVE_BOOT_COMPLETED", "PACKAGE_USAGE_STATS"),
            RepoFiles.declaredPermissions(manifest),
        )
        assertFalse(manifest.contains("MANAGE_DEVICE_POLICY"))
        assertFalse(manifest.contains("QUERY_ALL_PACKAGES"))
    }

    @Test
    fun `the receiver has no logic and the policy file requests no device-admin policy`() {
        val receiver = src("admin/FamilySafeAdminReceiver.kt")
        assertFalse(receiver.contains("override fun"))
        val policies = RepoFiles.read("apps/android/app/src/main/res/xml/device_admin.xml")
        assertTrue(policies.contains("<uses-policies />"))
        assertFalse(
            Regex(
                "<(limit-password|watch-login|reset-password|force-lock|wipe-data|disable-camera)",
            ).containsMatchIn(policies),
        )
    }

    @Test
    fun `only the Android adapter touches Device Policy APIs and only suspends`() {
        val adapter = src("data/AndroidManagedMode.kt")
        val onlyHere = Regex("DevicePolicyManager|setPackagesSuspended|isDeviceOwnerApp")
        val everyKotlinFile = RepoFiles.root().resolve(base).walkTopDown().filter { it.extension == "kt" }
        val users = everyKotlinFile.filter { onlyHere.containsMatchIn(it.readText()) }.map { it.name }.toSet()
        assertEquals(setOf("AndroidManagedMode.kt"), users)
        val banned = Regex(
            "setUninstallBlocked|setLockTaskPackages|startLockTask|setApplicationHidden|lockNow|wipeData|" +
                "resetPassword|" +
                "setCameraDisabled|setKeyguardDisabled|addUserRestriction|setUserControlDisabledPackages|" +
                "setPermittedAccessibilityServices|setGlobalSetting|setSecureSetting|installExistingPackage|" +
                "clearDeviceOwnerApp",
        )
        assertFalse(banned.containsMatchIn(adapter))
    }

    @Test
    fun `no managed-mode file logs, stores secrets or talks to the network`() {
        val files = listOf("domain/ManagedMode.kt", "data/AndroidManagedMode.kt", "admin/FamilySafeAdminReceiver.kt")
        val banned = Regex("""Log\.|println|Timber|printStackTrace|bearerAuth|Authorization|HttpClient""")
        files.forEach { assertFalse(banned.containsMatchIn(src(it)), "$it must stay quiet") }
    }

    @Test
    fun `enforcement runs on every trigger, in the background only while managed, and releases on disconnect`() {
        val container = src("di/AppContainer.kt")
        // config collector + foreground refresh + resume + the background pass (definition excluded)
        assertEquals(4, Regex("""\breconcileEnforcement\(\)""").findAll(container).count() - 1)
        assertTrue(container.contains("enforcementRunner.releaseAll()"))
        assertTrue(container.contains("workScheduler.cancelEnforcement()"))
        assertTrue(container.contains("enforcementRunner.isManaged()"))
        val body = RepoFiles.read("$base/work/WorkScheduler.kt").substringAfter("fun ensureEnforcement")
            .substringBefore("fun cancelEnforcement")
        assertFalse(body.contains("networkConstraints"))
        assertTrue(src("work/EnforcementWorker.kt").contains("runBackgroundChecks()"))
    }

    @Test
    fun `the enforcement files never log, store outside the paused list or reach the network`() {
        val files = listOf(
            "domain/Enforcement.kt",
            "data/SuspendedPackagesStore.kt",
            "work/EnforcementRunner.kt",
            "work/EnforcementWorker.kt",
        )
        val banned =
            Regex("""Log\.|println|Timber|printStackTrace|bearerAuth|Authorization|HttpClient|Ktor|DeviceHttp""")
        files.forEach { assertFalse(banned.containsMatchIn(src(it)), "$it must stay local and quiet") }
        assertFalse(src("domain/Enforcement.kt").contains("android."))
    }
}
