package app.familysafe.child.work

import app.familysafe.child.data.EnforcementStatusStore
import app.familysafe.child.data.SuspendedPackagesStore
import app.familysafe.child.domain.AppRule
import app.familysafe.child.domain.AppRuleStatus
import app.familysafe.child.domain.ConsumerEnforcer
import app.familysafe.child.domain.EnforcementInputs
import app.familysafe.child.domain.FakeSuspender
import app.familysafe.child.domain.LimitStatus
import app.familysafe.child.domain.ManagedEnforcer
import app.familysafe.child.domain.ManagedModeDetector
import app.familysafe.child.domain.ManagedModeState
import app.familysafe.child.domain.ScheduleStatus
import app.familysafe.child.domain.ScreenTimeConfig
import app.familysafe.child.domain.SuspendReason
import app.familysafe.child.testutil.MapSecureStore
import org.junit.jupiter.api.Assertions.assertEquals
import org.junit.jupiter.api.Assertions.assertNull
import org.junit.jupiter.api.Assertions.assertTrue
import org.junit.jupiter.api.Test

class EnforcementRunnerTest {
    private var mode = ManagedModeState.NOT_MANAGED
    private val detector = object : ManagedModeDetector {
        override fun state() = mode
    }
    private val suspender = FakeSuspender()
    private val backing = MapSecureStore()
    private val store = SuspendedPackagesStore(backing)
    private val status = EnforcementStatusStore()
    private var config: ScreenTimeConfig? =
        ScreenTimeConfig.validated(1, null, emptyMap(), listOf(AppRule.validated("a.b.c", true, null)!!))
    private val runner = EnforcementRunner(
        detector = detector,
        consumer = ConsumerEnforcer(),
        managed = ManagedEnforcer(suspender, store),
        inputs = {
            EnforcementInputs(
                config,
                AppRuleStatus.Unchecked,
                LimitStatus.Unchecked,
                ScheduleStatus.Unchecked,
                emptyList(),
            )
        },
        status = status,
        onNotManaged = { store.clear() },
        clock = { 9L },
    )

    @Test
    fun `a normal phone only informs and never calls the suspender`() {
        val result = runner.run()
        assertEquals(ManagedModeState.NOT_MANAGED, result.mode)
        assertTrue(result.paused.isEmpty())
        assertTrue(suspender.calls.isEmpty())
        assertEquals(result, status.status.value)
    }

    @Test
    fun `a managed phone pauses the blocked app`() {
        mode = ManagedModeState.DEVICE_OWNER
        val result = runner.run()
        assertEquals(mapOf("a.b.c" to SuspendReason.APP_BLOCKED), result.paused)
        assertEquals(setOf("a.b.c"), suspender.paused)
        assertTrue(runner.isManaged())
    }

    @Test
    fun `removing the rule resumes the app on the next pass`() {
        mode = ManagedModeState.DEVICE_OWNER
        runner.run()
        config = null
        val result = runner.run()
        assertTrue(result.paused.isEmpty())
        assertTrue(suspender.paused.isEmpty())
    }

    @Test
    fun `disconnect releases everything`() {
        mode = ManagedModeState.DEVICE_OWNER
        runner.run()
        val released = runner.releaseAll()
        assertTrue(released.paused.isEmpty())
        assertTrue(suspender.paused.isEmpty())
        assertTrue(store.read().isEmpty())
    }

    @Test
    fun `losing Device Owner status forgets the paused list instead of pretending to resume`() {
        mode = ManagedModeState.DEVICE_OWNER
        runner.run()
        mode = ManagedModeState.NOT_MANAGED
        suspender.calls.clear()
        val result = runner.run()
        assertEquals(ManagedModeState.NOT_MANAGED, result.mode)
        assertTrue(suspender.calls.isEmpty())
        assertTrue(store.read().isEmpty())
        assertNull(backing.map["managed_suspended"])
    }
}
