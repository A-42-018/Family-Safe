package app.familysafe.child.domain

import app.familysafe.child.data.SuspendedPackagesStore
import app.familysafe.child.testutil.MapSecureStore
import org.junit.jupiter.api.Assertions.assertEquals
import org.junit.jupiter.api.Assertions.assertFalse
import org.junit.jupiter.api.Assertions.assertNull
import org.junit.jupiter.api.Assertions.assertTrue
import org.junit.jupiter.api.Test

/** A phone that pauses what it is told and records every call. */
class FakeSuspender : PackageSuspender {
    val paused = linkedSetOf<String>()
    val refuse = mutableSetOf<String>()
    val gone = mutableSetOf<String>()
    val calls = mutableListOf<Pair<Set<String>, Boolean>>()

    override fun setSuspended(packages: Set<String>, suspended: Boolean): Set<String> {
        calls += packages to suspended
        val failed = mutableSetOf<String>()
        for (p in packages) {
            if (p in refuse || p in gone) failed += p else if (suspended) paused += p else paused -= p
        }
        return failed
    }

    override fun isSuspended(packageName: String): Boolean? = if (packageName in gone) null else packageName in paused
}

class EnforcementPlannerTest {
    private fun app(pkg: String, system: Boolean = false) = InstalledApp(pkg, pkg, null, system)
    private val installed = listOf(
        app("com.game.a"),
        app("com.video.b"),
        app("com.android.dialer", system = true),
        app("app.familysafe.child"),
    )

    private fun rule(pkg: String, blocked: Boolean = true, limit: Int? = null) =
        AppRule.validated(pkg, blocked, limit)!!

    private fun config(vararg rules: AppRule) = ScreenTimeConfig.validated(1, null, emptyMap(), rules.toList())!!

    private fun limitActive(level: LimitLevel) = LimitStatus.Active(
        ScreenTimeEvaluation(level, "2026-10-05", 1, 60, 60),
        rulesStale = false,
        checkedAtEpochMillis = 1L,
    )

    private fun appRulesActive(vararg e: AppRuleEvaluation) =
        AppRuleStatus.Active("2026-10-05", e.toList(), rulesStale = false, checkedAtEpochMillis = 1L)

    private val quiet = ScheduleStatus.Active(
        scheduleCount = 1,
        active = listOf(
            ActiveWindow(
                ScheduleWindow.validated(
                    "00000000-0000-4000-8000-000000000001",
                    "N",
                    "BEDTIME",
                    listOf(1),
                    "22:00",
                    "07:00",
                )!!,
                java.time.LocalDate.parse("2026-10-05"),
                java.time.Instant.parse("2026-10-05T22:00:00Z"),
                java.time.Instant.parse("2026-10-06T07:00:00Z"),
            ),
        ),
        nextBoundaryEpochMillis = 1L,
        zoneId = "UTC",
        parentZone = false,
        rulesStale = false,
        checkedAtEpochMillis = 1L,
    )

    private fun inputs(
        config: ScreenTimeConfig? = null,
        appRules: AppRuleStatus = AppRuleStatus.Unchecked,
        limit: LimitStatus = LimitStatus.Unchecked,
        schedules: ScheduleStatus = ScheduleStatus.Unchecked,
    ) = EnforcementInputs(config, appRules, limit, schedules, installed)

    @Test
    fun `nothing in force means nothing paused`() {
        assertTrue(EnforcementPlanner.plan(inputs()).suspend.isEmpty())
        assertTrue(
            EnforcementPlanner.plan(inputs(config = config(), limit = limitActive(LimitLevel.WARN))).suspend.isEmpty(),
        )
    }

    @Test
    fun `a blocked app is paused even when usage cannot be read`() {
        val plan = EnforcementPlanner.plan(
            inputs(config = config(rule("com.game.a")), appRules = AppRuleStatus.Unchecked),
        )
        assertEquals(mapOf("com.game.a" to SuspendReason.APP_BLOCKED), plan.suspend)
    }

    @Test
    fun `a blocked system app can be paused because the parent named it`() {
        val plan = EnforcementPlanner.plan(inputs(config = config(rule("com.android.dialer"))))
        assertEquals(SuspendReason.APP_BLOCKED, plan.suspend["com.android.dialer"])
    }

    @Test
    fun `an app at its own limit is paused, one still under its limit is not`() {
        val status = appRulesActive(
            AppRuleEvaluation("com.game.a", AppRuleLevel.LIMIT, 60, 3, 60),
            AppRuleEvaluation("com.video.b", AppRuleLevel.WARN, 55, 2, 60),
        )
        val plan = EnforcementPlanner.plan(inputs(config = config(rule("com.game.a", false, 60)), appRules = status))
        assertEquals(mapOf("com.game.a" to SuspendReason.APP_LIMIT), plan.suspend)
    }

    @Test
    fun `the daily limit pauses every non-system app but never system apps or FamilySafe`() {
        val plan = EnforcementPlanner.plan(inputs(limit = limitActive(LimitLevel.LIMIT)))
        assertEquals(
            setOf("com.game.a", "com.video.b", "app.familysafe.child").minus("app.familysafe.child"),
            plan.packages,
        )
        assertTrue(plan.suspend.values.all { it == SuspendReason.DAILY_LIMIT })
        assertFalse("com.android.dialer" in plan.packages)
        assertFalse("app.familysafe.child" in plan.packages)
    }

    @Test
    fun `a schedule in force pauses the same broad set`() {
        val plan = EnforcementPlanner.plan(inputs(schedules = quiet))
        assertEquals(setOf("com.game.a", "com.video.b"), plan.packages)
        assertTrue(plan.suspend.values.all { it == SuspendReason.SCHEDULE })
    }

    @Test
    fun `priority is blocked, then app limit, then daily limit, then schedule`() {
        val status = appRulesActive(AppRuleEvaluation("com.video.b", AppRuleLevel.LIMIT, 60, 1, 60))
        val plan = EnforcementPlanner.plan(
            inputs(
                config = config(rule("com.game.a")),
                appRules = status,
                limit = limitActive(LimitLevel.LIMIT),
                schedules = quiet,
            ),
        )
        assertEquals(SuspendReason.APP_BLOCKED, plan.suspend["com.game.a"])
        assertEquals(SuspendReason.APP_LIMIT, plan.suspend["com.video.b"])
        val onlyLimitAndSchedule = EnforcementPlanner.plan(
            inputs(limit = limitActive(LimitLevel.LIMIT), schedules = quiet),
        )
        assertTrue(onlyLimitAndSchedule.suspend.values.all { it == SuspendReason.DAILY_LIMIT })
    }

    @Test
    fun `expired or missing rules pause nothing`() {
        val inactive = ScheduleStatus.Inactive(ScheduleInactiveReason.RULES_EXPIRED, 1L)
        assertTrue(EnforcementPlanner.plan(inputs(config = null, schedules = inactive)).suspend.isEmpty())
    }

    @Test
    fun `plans compare and print without leaking package names`() {
        val plan = EnforcementPlan(mapOf("com.game.a" to SuspendReason.SCHEDULE))
        assertEquals(plan, EnforcementPlan(mapOf("com.game.a" to SuspendReason.SCHEDULE)))
        assertFalse(plan.toString().contains("com.game"))
    }
}

class ManagedEnforcerTest {
    private val suspender = FakeSuspender()
    private val store = SuspendedPackagesStore(MapSecureStore())
    private val enforcer = ManagedEnforcer(suspender, store)

    private fun plan(vararg pairs: Pair<String, SuspendReason>) = EnforcementPlan(mapOf(*pairs))

    @Test
    fun `pauses what the plan lists and remembers it`() {
        val status = enforcer.reconcile(plan("a.b.c" to SuspendReason.APP_BLOCKED), 5L)
        assertEquals(setOf("a.b.c"), suspender.paused)
        assertEquals(ManagedModeState.DEVICE_OWNER, status.mode)
        assertEquals(mapOf("a.b.c" to SuspendReason.APP_BLOCKED), status.paused)
        assertEquals(mapOf("a.b.c" to SuspendReason.APP_BLOCKED), store.read())
    }

    @Test
    fun `an unchanged plan makes no further calls`() {
        enforcer.reconcile(plan("a.b.c" to SuspendReason.APP_BLOCKED), 5L)
        suspender.calls.clear()
        enforcer.reconcile(plan("a.b.c" to SuspendReason.APP_BLOCKED), 6L)
        assertTrue(suspender.calls.isEmpty())
    }

    @Test
    fun `an app that leaves the plan is resumed and forgotten`() {
        enforcer.reconcile(plan("a.b.c" to SuspendReason.APP_BLOCKED, "d.e.f" to SuspendReason.APP_LIMIT), 5L)
        val status = enforcer.reconcile(plan("d.e.f" to SuspendReason.APP_LIMIT), 6L)
        assertEquals(setOf("d.e.f"), suspender.paused)
        assertEquals(setOf("d.e.f"), status.paused.keys)
        assertEquals(setOf("d.e.f"), store.read().keys)
    }

    @Test
    fun `an empty plan resumes everything this app paused`() {
        enforcer.reconcile(plan("a.b.c" to SuspendReason.SCHEDULE, "d.e.f" to SuspendReason.SCHEDULE), 5L)
        val status = enforcer.reconcile(EnforcementPlan(emptyMap()), 6L)
        assertTrue(suspender.paused.isEmpty())
        assertTrue(status.paused.isEmpty())
        assertTrue(store.read().isEmpty())
    }

    @Test
    fun `it only resumes packages it paused itself`() {
        suspender.paused += "someone.else"
        enforcer.reconcile(plan("a.b.c" to SuspendReason.APP_BLOCKED), 5L)
        enforcer.reconcile(EnforcementPlan(emptyMap()), 6L)
        assertEquals(setOf("someone.else"), suspender.paused)
    }

    @Test
    fun `a refused package is reported and not retried every pass`() {
        suspender.refuse += "a.b.c"
        val first = enforcer.reconcile(plan("a.b.c" to SuspendReason.APP_BLOCKED), 5L)
        assertEquals(setOf("a.b.c"), first.refused)
        assertTrue(first.paused.isEmpty())
        suspender.calls.clear()
        enforcer.reconcile(plan("a.b.c" to SuspendReason.APP_BLOCKED), 6L)
        assertTrue(suspender.calls.isEmpty())
        // After it leaves the plan and comes back it is tried again.
        enforcer.reconcile(EnforcementPlan(emptyMap()), 7L)
        suspender.refuse.clear()
        val again = enforcer.reconcile(plan("a.b.c" to SuspendReason.APP_BLOCKED), 8L)
        assertEquals(setOf("a.b.c"), again.paused.keys)
    }

    @Test
    fun `a package that vanished is dropped, a still-paused one is retried`() {
        enforcer.reconcile(plan("a.b.c" to SuspendReason.APP_BLOCKED, "d.e.f" to SuspendReason.APP_BLOCKED), 5L)
        suspender.gone += "a.b.c" // uninstalled meanwhile: resume fails, isSuspended = null
        suspender.refuse += "d.e.f" // refuses to resume while still paused
        val status = enforcer.reconcile(EnforcementPlan(emptyMap()), 6L)
        assertEquals(setOf("d.e.f"), status.paused.keys)
        assertEquals(setOf("d.e.f"), store.read().keys)
        suspender.refuse.clear()
        enforcer.reconcile(EnforcementPlan(emptyMap()), 7L)
        assertFalse("d.e.f" in suspender.paused)
        assertTrue(store.read().isEmpty())
    }

    @Test
    fun `a reason change keeps the app paused and updates the reason`() {
        enforcer.reconcile(plan("a.b.c" to SuspendReason.SCHEDULE), 5L)
        suspender.calls.clear()
        val status = enforcer.reconcile(plan("a.b.c" to SuspendReason.APP_BLOCKED), 6L)
        assertTrue(suspender.calls.isEmpty())
        assertEquals(SuspendReason.APP_BLOCKED, status.paused["a.b.c"])
    }

    @Test
    fun `release resumes everything and clears the store`() {
        enforcer.reconcile(plan("a.b.c" to SuspendReason.APP_BLOCKED, "d.e.f" to SuspendReason.SCHEDULE), 5L)
        val status = enforcer.releaseAll(6L)
        assertTrue(suspender.paused.isEmpty())
        assertTrue(status.paused.isEmpty())
        assertTrue(store.read().isEmpty())
    }

    @Test
    fun `release keeps what Android would not resume so a later pass retries`() {
        enforcer.reconcile(plan("a.b.c" to SuspendReason.APP_BLOCKED), 5L)
        suspender.refuse += "a.b.c"
        val status = enforcer.releaseAll(6L)
        assertEquals(setOf("a.b.c"), status.paused.keys)
        assertEquals(setOf("a.b.c"), store.read().keys)
    }

    @Test
    fun `a restart remembers what was paused`() {
        val backing = MapSecureStore()
        ManagedEnforcer(
            suspender,
            SuspendedPackagesStore(backing),
        ).reconcile(plan("a.b.c" to SuspendReason.APP_BLOCKED), 5L)
        val afterRestart = ManagedEnforcer(suspender, SuspendedPackagesStore(backing))
        afterRestart.reconcile(EnforcementPlan(emptyMap()), 6L)
        assertTrue(suspender.paused.isEmpty())
    }
}

class SuspendedCodecTest {
    @Test
    fun `round trip and the documented string`() {
        val paused = linkedMapOf("b.b.b" to SuspendReason.SCHEDULE, "a.a.a" to SuspendReason.APP_BLOCKED)
        assertEquals("v1;a.a.a=B,b.b.b=S", SuspendedCodec.encode(paused))
        assertEquals(
            paused.toSortedMap().toMap(),
            SuspendedCodec.decode(SuspendedCodec.encode(paused))!!.toSortedMap().toMap(),
        )
        assertEquals(emptyMap<String, SuspendReason>(), SuspendedCodec.decode(SuspendedCodec.encode(emptyMap())))
    }

    @Test
    fun `junk reads as nothing paused`() {
        val junk = listOf(
            null, "", "v1", "v2;a.a.a=B", "v1;a.a.a", "v1;a.a.a=X", "v1;a.a.a=BB", "v1;x=B", "v1;a.a.a=B,a.a.a=S",
            "v1;app.familysafe.child=B", "v1;a.a.a=B;extra",
        )
        for (text in junk) assertNull(SuspendedCodec.decode(text), text.toString())
        assertEquals(
            emptyMap<String, SuspendReason>(),
            SuspendedPackagesStore(
                MapSecureStore().apply {
                    map["managed_suspended"] = "junk"
                },
            ).read(),
        )
    }

    @Test
    fun `broken storage never throws`() {
        val backing = MapSecureStore().apply {
            failGet = true
            failPut = { true }
        }
        val store = SuspendedPackagesStore(backing)
        assertTrue(store.read().isEmpty())
        store.write(mapOf("a.a.a" to SuspendReason.APP_BLOCKED))
        store.clear()
    }
}
