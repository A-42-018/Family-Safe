package app.familysafe.child.di

import app.cash.turbine.test
import app.familysafe.child.data.CredentialStore
import app.familysafe.child.data.DeviceCredentials
import app.familysafe.child.data.EnrollmentApi
import app.familysafe.child.data.EnrollmentRepository
import app.familysafe.child.data.RedeemOutcome
import app.familysafe.child.data.RedeemRequest
import app.familysafe.child.domain.AppInventory
import app.familysafe.child.domain.AppInventoryReport
import app.familysafe.child.domain.AppRuleInactiveReason
import app.familysafe.child.domain.AppRuleStatus
import app.familysafe.child.domain.AppUsageEntry
import app.familysafe.child.domain.CachedScreenTimeConfig
import app.familysafe.child.domain.DayUsage
import app.familysafe.child.domain.DeviceAuthState
import app.familysafe.child.domain.DeviceDetails
import app.familysafe.child.domain.DeviceInfoReport
import app.familysafe.child.domain.InstalledApp
import app.familysafe.child.domain.LimitInactiveReason
import app.familysafe.child.domain.LimitStatus
import app.familysafe.child.domain.PermissionCatalog
import app.familysafe.child.domain.PermissionKey
import app.familysafe.child.domain.PermissionObservation
import app.familysafe.child.domain.PermissionSnapshot
import app.familysafe.child.domain.PermissionState
import app.familysafe.child.domain.PermissionSyncReport
import app.familysafe.child.domain.ScreenTimeConfig
import app.familysafe.child.domain.SyncStatus
import app.familysafe.child.domain.UsageAccess
import app.familysafe.child.domain.UsageReport
import app.familysafe.child.testutil.MapSecureStore
import kotlinx.coroutines.flow.MutableStateFlow
import kotlinx.coroutines.test.runTest
import org.junit.jupiter.api.Assertions.assertEquals
import org.junit.jupiter.api.Assertions.assertFalse
import org.junit.jupiter.api.Assertions.assertTrue
import org.junit.jupiter.api.Test

class AppStateHolderTest {
    private class NoApi : EnrollmentApi {
        override suspend fun redeem(request: RedeemRequest): RedeemOutcome = error("not used")
    }

    private val creds = CredentialStore(MapSecureStore())
    private val repository = EnrollmentRepository(NoApi(), creds)

    @Test
    fun `starts not enrolled with unknown auth`() = runTest {
        val holder = AppStateHolder(repository, MutableStateFlow(DeviceAuthState.Unknown), backgroundScope)
        holder.state.test {
            val first = awaitItem()
            assertFalse(first.isEnrolled)
            assertEquals(DeviceAuthState.Unknown, first.auth)
            assertFalse(first.isDisconnected)
            cancelAndIgnoreRemainingEvents()
        }
    }

    @Test
    fun `a discovered revocation reaches the state without any refresh call`() = runTest {
        val auth = MutableStateFlow(DeviceAuthState.Unknown)
        val holder = AppStateHolder(repository, auth, backgroundScope)
        holder.state.test {
            awaitItem()
            auth.value = DeviceAuthState.Revoked
            val next = awaitItem()
            assertTrue(next.isDisconnected)
            assertEquals(DeviceAuthState.Revoked, next.auth)
            cancelAndIgnoreRemainingEvents()
        }
    }

    @Test
    fun `refresh re-reads enrollment`() = runTest {
        val holder = AppStateHolder(repository, MutableStateFlow(DeviceAuthState.Unknown), backgroundScope)
        holder.state.test {
            assertFalse(awaitItem().isEnrolled)
            creds.save(DeviceCredentials("11111111-2222-3333-4444-555555555555", "S".repeat(43), 5L))
            holder.refresh()
            assertTrue(awaitItem().isEnrolled)
            cancelAndIgnoreRemainingEvents()
        }
    }

    @Test
    fun `a recorded sync reaches the state`() = runTest {
        val sync = MutableStateFlow(SyncStatus())
        val holder = AppStateHolder(repository, MutableStateFlow(DeviceAuthState.Unknown), backgroundScope, sync)
        holder.state.test {
            assertFalse(awaitItem().sync.hasSynced)
            sync.value = SyncStatus(1_700_000_000_000L)
            assertEquals(1_700_000_000_000L, awaitItem().sync.lastSyncEpochMillis)
            cancelAndIgnoreRemainingEvents()
        }
    }

    @Test
    fun `a recorded device info report reaches the state and clears again`() = runTest {
        val info = MutableStateFlow<DeviceInfoReport?>(null)
        val holder = AppStateHolder(
            repository,
            MutableStateFlow(DeviceAuthState.Unknown),
            backgroundScope,
            deviceInfo = info,
        )
        holder.state.test {
            assertEquals(null, awaitItem().deviceInfo)
            info.value = DeviceInfoReport(DeviceDetails(34, "2025-09-05", 100, 50), 5L)
            assertEquals(34, awaitItem().deviceInfo!!.details.sdkLevel)
            info.value = null
            assertEquals(null, awaitItem().deviceInfo)
            cancelAndIgnoreRemainingEvents()
        }
    }

    @Test
    fun `a recorded app list reaches the state next to the device details and clears again`() = runTest {
        val info = MutableStateFlow<DeviceInfoReport?>(null)
        val apps = MutableStateFlow<AppInventoryReport?>(null)
        val holder = AppStateHolder(
            repository,
            MutableStateFlow(DeviceAuthState.Unknown),
            backgroundScope,
            deviceInfo = info,
            appInventory = apps,
        )
        holder.state.test {
            val first = awaitItem()
            assertEquals(null, first.appInventory)
            assertEquals(null, first.deviceInfo)
            apps.value = AppInventoryReport(AppInventory(listOf(InstalledApp("com.a.a", "Ay", "1", false)), 2), 9L)
            val withApps = awaitItem()
            assertEquals("com.a.a", withApps.appInventory!!.inventory.apps.single().packageName)
            assertEquals(2, withApps.appInventory!!.inventory.omittedCount)
            assertEquals(null, withApps.deviceInfo)
            info.value = DeviceInfoReport(DeviceDetails(34, "2025-09-05", 100, 50), 5L)
            val both = awaitItem()
            assertEquals(34, both.deviceInfo!!.details.sdkLevel)
            assertEquals(1, both.appInventory!!.inventory.apps.size)
            apps.value = null
            assertEquals(null, awaitItem().appInventory)
            cancelAndIgnoreRemainingEvents()
        }
    }

    @Test
    fun `permission states and the time they were shared reach the state`() = runTest {
        val permissions = MutableStateFlow(PermissionSnapshot.initial())
        val holder = AppStateHolder(
            repository,
            MutableStateFlow(DeviceAuthState.Unknown),
            backgroundScope,
            permissions = permissions,
        )
        holder.state.test {
            val first = awaitItem()
            assertTrue(first.permissions.all { it.state == PermissionState.NOT_REQUESTED })
            assertEquals(null, first.permissionsSharedAtEpochMillis)
            val all = PermissionCatalog.SYNCED.associateWith { PermissionState.GRANTED }
            val reading = PermissionObservation.create(all)!!
            permissions.value = PermissionSnapshot.of(reading, PermissionSyncReport(reading, 9L))
            val next = awaitItem()
            assertEquals(PermissionState.GRANTED, next.permissions.first { it.key == PermissionKey.CAMERA }.state)
            assertEquals(9L, next.permissionsSharedAtEpochMillis)
            cancelAndIgnoreRemainingEvents()
        }
    }

    @Test
    fun `usage numbers and the Usage Access switch reach the state and clear again`() = runTest {
        val usage = MutableStateFlow<UsageReport?>(null)
        val access = MutableStateFlow(UsageAccess.UNKNOWN)
        val holder = AppStateHolder(
            repository,
            MutableStateFlow(DeviceAuthState.Unknown),
            backgroundScope,
            usage = usage,
            usageAccess = access,
        )
        holder.state.test {
            val first = awaitItem()
            assertEquals(null, first.usage)
            assertEquals(UsageAccess.UNKNOWN, first.usageAccess)
            access.value = UsageAccess.GRANTED
            val granted = awaitItem()
            assertEquals(UsageAccess.GRANTED, granted.usageAccess)
            assertEquals(null, granted.usage)
            usage.value = UsageReport(DayUsage("2026-09-30", 95, 12, listOf(AppUsageEntry("com.a.a", 40, 3)), 2), 7L)
            val withUsage = awaitItem()
            assertEquals(95, withUsage.usage!!.usage.totalScreenMinutes)
            assertEquals(12, withUsage.usage!!.usage.unlockCount)
            assertEquals("com.a.a", withUsage.usage!!.usage.apps.single().packageName)
            assertEquals(2, withUsage.usage!!.usage.omittedCount)
            assertEquals(UsageAccess.GRANTED, withUsage.usageAccess)
            access.value = UsageAccess.NOT_GRANTED
            val off = awaitItem()
            assertEquals(UsageAccess.NOT_GRANTED, off.usageAccess)
            assertEquals(95, off.usage!!.usage.totalScreenMinutes)
            usage.value = null
            assertEquals(null, awaitItem().usage)
            cancelAndIgnoreRemainingEvents()
        }
    }

    @Test
    fun `the cached rules reach the state and clear again`() = runTest {
        val rules = MutableStateFlow<CachedScreenTimeConfig?>(null)
        val holder = AppStateHolder(
            repository,
            MutableStateFlow(DeviceAuthState.Unknown),
            backgroundScope,
            screenTime = rules,
        )
        holder.state.test {
            assertEquals(null, awaitItem().screenTime)
            rules.value = CachedScreenTimeConfig(ScreenTimeConfig.validated(3, 90, mapOf(6 to 180))!!, 7L)
            val withRules = awaitItem().screenTime!!
            assertEquals(3, withRules.config.version)
            assertEquals(90, withRules.config.limitFor(1))
            assertEquals(180, withRules.config.limitFor(6))
            assertEquals(7L, withRules.validatedAtEpochMillis)
            rules.value = null
            assertEquals(null, awaitItem().screenTime)
            cancelAndIgnoreRemainingEvents()
        }
    }

    @Test
    fun `today's limit check reaches the state and resets with the store`() = runTest {
        val limit = MutableStateFlow<LimitStatus>(LimitStatus.Unchecked)
        val holder = AppStateHolder(
            repository,
            MutableStateFlow(DeviceAuthState.Unknown),
            backgroundScope,
            limit = limit,
        )
        holder.state.test {
            assertEquals(LimitStatus.Unchecked, awaitItem().limit)
            val inactive = LimitStatus.Inactive(LimitInactiveReason.NO_USAGE_ACCESS, 9L)
            limit.value = inactive
            assertEquals(inactive, awaitItem().limit)
            limit.value = LimitStatus.Unchecked
            assertEquals(LimitStatus.Unchecked, awaitItem().limit)
            cancelAndIgnoreRemainingEvents()
        }
    }

    @Test
    fun `the app-rule check reaches the state and resets`() = runTest {
        val appRules = MutableStateFlow<AppRuleStatus>(AppRuleStatus.Unchecked)
        val holder = AppStateHolder(
            repository,
            MutableStateFlow(DeviceAuthState.Unknown),
            backgroundScope,
            appRules = appRules,
        )
        holder.state.test {
            assertEquals(AppRuleStatus.Unchecked, awaitItem().appRules)
            val inactive = AppRuleStatus.Inactive(AppRuleInactiveReason.NO_USAGE_ACCESS, 9L)
            appRules.value = inactive
            assertEquals(inactive, awaitItem().appRules)
            appRules.value = AppRuleStatus.Unchecked
            assertEquals(AppRuleStatus.Unchecked, awaitItem().appRules)
            cancelAndIgnoreRemainingEvents()
        }
    }
}
