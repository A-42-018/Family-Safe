package app.familysafe.child.work

import app.familysafe.child.data.EnforcementStatusStore
import app.familysafe.child.domain.EnforcementInputs
import app.familysafe.child.domain.EnforcementPlanner
import app.familysafe.child.domain.EnforcementStatus
import app.familysafe.child.domain.Enforcer
import app.familysafe.child.domain.ManagedModeDetector
import app.familysafe.child.domain.ManagedModeState

/**
 * One enforcement pass: plan from what is already known on this phone, then hand the plan to the right [Enforcer]
 * (managed mode pauses apps; everything else only informs). Local only: no network, nothing stored except the
 * managed enforcer's own paused-set. [onNotManaged] runs when the phone is not (or no longer) managed, so a stale
 * paused-set from a removed Device Owner is forgotten instead of being "resumed" without rights.
 */
class EnforcementRunner(
    private val detector: ManagedModeDetector,
    private val consumer: Enforcer,
    private val managed: Enforcer,
    private val inputs: () -> EnforcementInputs,
    private val status: EnforcementStatusStore,
    private val onNotManaged: () -> Unit = {},
    private val clock: () -> Long = { System.currentTimeMillis() },
) {
    fun isManaged(): Boolean = detector.state() == ManagedModeState.DEVICE_OWNER

    fun run(): EnforcementStatus {
        val now = clock()
        val result = if (isManaged()) {
            managed.reconcile(EnforcementPlanner.plan(inputs()), now)
        } else {
            onNotManaged()
            consumer.reconcile(EnforcementPlanner.plan(inputs()), now)
        }
        status.record(result)
        return result
    }

    /** Disconnect, revoke or rules gone: resume everything this app paused. */
    fun releaseAll(): EnforcementStatus {
        val now = clock()
        val result = if (isManaged()) {
            managed.releaseAll(now)
        } else {
            onNotManaged()
            consumer.releaseAll(now)
        }
        status.record(result)
        return result
    }
}
