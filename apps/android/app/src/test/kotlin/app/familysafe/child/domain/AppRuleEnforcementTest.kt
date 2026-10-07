package app.familysafe.child.domain

import java.time.Instant
import java.time.ZoneId
import org.junit.jupiter.api.Assertions.assertEquals
import org.junit.jupiter.api.Assertions.assertFalse
import org.junit.jupiter.api.Assertions.assertInstanceOf
import org.junit.jupiter.api.Assertions.assertNotNull
import org.junit.jupiter.api.Assertions.assertNull
import org.junit.jupiter.api.Assertions.assertTrue
import org.junit.jupiter.api.Test

class AppRuleEnforcementTest {
    private val utc = ZoneId.of("UTC")
    private val noon = Instant.parse("2026-10-01T12:00:00Z").toEpochMilli()
    private val minute = 60_000L
    private val hour = 3_600_000L

    private fun rule(pkg: String, blocked: Boolean, limit: Int? = null) = AppRule.validated(pkg, blocked, limit)!!

    private fun config(vararg rules: AppRule, version: Int = 5) =
        ScreenTimeConfig.validated(version, null, emptyMap(), rules.toList())!!

    private fun cached(config: ScreenTimeConfig, validatedAt: Long = noon) = CachedScreenTimeConfig(config, validatedAt)

    private fun fg(pkg: String, at: Long) = UsageEvent(UsageEventKind.FOREGROUND, pkg, at)
    private fun bg(pkg: String, at: Long) = UsageEvent(UsageEventKind.BACKGROUND, pkg, at)

    private class Source(var events: List<UsageEvent> = emptyList(), var failure: Exception? = null) :
        UsageEventsSource {
        val windows = mutableListOf<Pair<Long, Long>>()

        override fun events(windowStartMillis: Long, windowEndMillis: Long): List<UsageEvent> {
            windows += windowStartMillis to windowEndMillis
            failure?.let { throw it }
            return events
        }
    }

    private fun read(
        cache: CachedScreenTimeConfig?,
        access: UsageAccess = UsageAccess.GRANTED,
        source: Source = Source(),
        now: Long = noon,
        scanFrom: Long = noon - 10 * minute,
    ) = AppRuleStatusEvaluator.read(cache, access, source, now, utc, scanFrom)

    // --- engine ---

    @Test
    fun `blocked wins over a stored limit and carries no limit`() {
        val e = AppRuleEngine.evaluate(rule("com.example.a", true, 60), AppUsageEntry("com.example.a", 5, 2))
        assertEquals(AppRuleLevel.BLOCKED, e.level)
        assertNull(e.limitMinutes)
        assertTrue(e.openedToday)
    }

    @Test
    fun `a limit warns ten minutes before 60 and limits at 60, like the screen-time rule`() {
        val r = rule("com.example.a", false, 60)
        fun level(used: Int) = AppRuleEngine.evaluate(r, AppUsageEntry("com.example.a", used, 1)).level
        assertEquals(AppRuleLevel.ALLOW, level(49))
        assertEquals(AppRuleLevel.WARN, level(50))
        assertEquals(AppRuleLevel.WARN, level(59))
        assertEquals(AppRuleLevel.LIMIT, level(60))
        assertEquals(AppRuleLevel.LIMIT, level(600))
    }

    @Test
    fun `a limit of zero is the limit from the first minute`() {
        val r = rule("com.example.a", false, 0)
        assertEquals(AppRuleLevel.LIMIT, AppRuleEngine.evaluate(r, null).level)
        // ...but only an app that was really opened produces a notice
        assertFalse(AppRuleEngine.evaluate(r, null).openedToday)
    }

    @Test
    fun `no usage reads as zero, negative values never go below zero`() {
        val r = rule("com.example.a", false, 30)
        val none = AppRuleEngine.evaluate(r, null)
        assertEquals(0, none.usedMinutes)
        assertEquals(AppRuleLevel.ALLOW, none.level)
        val odd = AppRuleEngine.evaluate(r, AppUsageEntry("com.example.a", -5, -1))
        assertEquals(0, odd.usedMinutes)
        assertEquals(0, odd.launchesToday)
    }

    @Test
    fun `only packages with a rule are evaluated, blocked first then by package`() {
        val rules = listOf(rule("com.z.z", false, 10), rule("com.b.b", true), rule("com.a.a", false, 10))
        val usage = listOf(AppUsageEntry("com.other.app", 500, 9), AppUsageEntry("com.a.a", 3, 1))
        val all = AppRuleEngine.evaluateAll(rules, usage)
        assertEquals(listOf("com.b.b", "com.a.a", "com.z.z"), all.map { it.packageName })
        assertEquals(listOf(AppRuleLevel.BLOCKED, AppRuleLevel.ALLOW, AppRuleLevel.ALLOW), all.map { it.level })
    }

    @Test
    fun `evaluation toString names no package`() {
        val evaluation = AppRuleEngine.evaluate(rule("com.secret.app", true), null)
        assertEquals("AppRuleEvaluation(BLOCKED)", evaluation.toString())
    }

    // --- status evaluator ---

    @Test
    fun `no cache and no rules are explicit inactive reasons and nothing is read`() {
        val source = Source()
        val none = read(null, source = source)
        assertEquals(AppRuleInactiveReason.NO_RULES, (none.status as AppRuleStatus.Inactive).reason)
        assertNull(none.config)
        val bare = read(cached(config()), source = source)
        assertEquals(AppRuleInactiveReason.NO_APP_RULES, (bare.status as AppRuleStatus.Inactive).reason)
        assertNotNull(bare.config)
        assertTrue(source.windows.isEmpty())
    }

    @Test
    fun `expired rules are not applied and not read`() {
        val source = Source()
        val old = cached(config(rule("com.a.a", true)), noon - ScreenTimeLimits.EXPIRY_MILLIS - 1)
        val r = read(old, source = source)
        assertEquals(AppRuleInactiveReason.RULES_EXPIRED, (r.status as AppRuleStatus.Inactive).reason)
        assertTrue(source.windows.isEmpty())
    }

    @Test
    fun `usage access off or unknown is never read as allowed`() {
        val source = Source()
        for (access in listOf(UsageAccess.NOT_GRANTED, UsageAccess.UNKNOWN)) {
            val r = read(cached(config(rule("com.a.a", true))), access, source)
            assertEquals(AppRuleInactiveReason.NO_USAGE_ACCESS, (r.status as AppRuleStatus.Inactive).reason)
        }
        assertTrue(source.windows.isEmpty())
    }

    @Test
    fun `an unreadable source is an explicit reason, not allow`() {
        val r = read(cached(config(rule("com.a.a", true))), source = Source(failure = IllegalStateException("x")))
        assertEquals(AppRuleInactiveReason.CANNOT_READ_USAGE, (r.status as AppRuleStatus.Inactive).reason)
        assertNotNull(r.config)
    }

    @Test
    fun `an active reading measures today only and hands the raw events on`() {
        val events = listOf(
            fg("com.a.a", noon - 3 * hour),
            bg("com.a.a", noon - 3 * hour + 30 * minute),
            fg("com.b.b", noon - 2 * hour),
        )
        val source = Source(events)
        val r = read(cached(config(rule("com.a.a", false, 20), rule("com.b.b", true))), source = source)
        val active = assertInstanceOf(AppRuleStatus.Active::class.java, r.status)
        assertEquals("2026-10-01", active.day)
        val byPkg = active.entries.associateBy { it.packageName }
        assertEquals(AppRuleLevel.LIMIT, byPkg.getValue("com.a.a").level)
        assertEquals(30, byPkg.getValue("com.a.a").usedMinutes)
        assertEquals(AppRuleLevel.BLOCKED, byPkg.getValue("com.b.b").level)
        assertTrue(byPkg.getValue("com.b.b").openedToday)
        assertEquals(events, r.events)
        // read from the earlier of "start of today" and the attempt scan point, never past "now"
        val (from, to) = source.windows.single()
        assertEquals(minOf(Instant.parse("2026-10-01T00:00:00Z").toEpochMilli(), noon - 10 * minute), from)
        assertEquals(noon, to)
    }

    @Test
    fun `events from before today do not add to today's minutes`() {
        val yesterday = noon - 20 * hour
        val events = listOf(fg("com.a.a", yesterday), bg("com.a.a", yesterday + 50 * minute))
        val r = read(cached(config(rule("com.a.a", false, 20))), source = Source(events), scanFrom = noon - 23 * hour)
        val entry = (r.status as AppRuleStatus.Active).entries.single()
        assertEquals(0, entry.usedMinutes)
        assertFalse(entry.openedToday)
    }

    @Test
    fun `stale rules are still applied and flagged`() {
        val stale = cached(config(rule("com.a.a", true)), noon - ScreenTimeLimits.STALE_MILLIS - 1)
        assertTrue((read(stale).status as AppRuleStatus.Active).rulesStale)
        assertFalse((read(cached(config(rule("com.a.a", true)))).status as AppRuleStatus.Active).rulesStale)
    }

    // --- notices ---

    private fun active(vararg entries: AppRuleEvaluation) =
        AppRuleStatus.Active("2026-10-01", entries.toList(), false, noon)

    private fun ev(pkg: String, level: AppRuleLevel, used: Int, launches: Int, limit: Int? = null) =
        AppRuleEvaluation(pkg, level, used, launches, limit)

    @Test
    fun `a notice needs a blocked or limited app that was really opened today`() {
        val status = active(
            ev("com.a.a", AppRuleLevel.BLOCKED, 0, 0),
            ev("com.b.b", AppRuleLevel.BLOCKED, 0, 1),
            ev("com.c.c", AppRuleLevel.LIMIT, 40, 3, 30),
            ev("com.d.d", AppRuleLevel.WARN, 25, 3, 30),
            ev("com.e.e", AppRuleLevel.ALLOW, 1, 1, 30),
            ev("com.f.f", AppRuleLevel.LIMIT, 0, 0, 0),
        )
        assertEquals(listOf("com.b.b", "com.c.c"), AppRuleNotices.all(status).map { it.packageName })
    }

    @Test
    fun `only an active status produces notices`() {
        assertTrue(AppRuleNotices.all(AppRuleStatus.Unchecked).isEmpty())
        assertTrue(AppRuleNotices.all(AppRuleStatus.Inactive(AppRuleInactiveReason.NO_RULES, noon)).isEmpty())
    }

    @Test
    fun `dismissal is per day, package, level and limit`() {
        val a = AppRuleNotice("com.a.a", AppRuleLevel.LIMIT, "2026-10-01", 30, 31)
        assertEquals("2026-10-01:com.a.a:LIMIT:30", a.dismissKey)
        assertFalse(a.dismissKey == AppRuleNotice("com.a.a", AppRuleLevel.LIMIT, "2026-10-02", 30, 31).dismissKey)
        assertFalse(a.dismissKey == AppRuleNotice("com.a.a", AppRuleLevel.LIMIT, "2026-10-01", 45, 31).dismissKey)
        assertFalse(a.dismissKey == AppRuleNotice("com.a.a", AppRuleLevel.BLOCKED, "2026-10-01", null, 31).dismissKey)
        val blockedNotice = AppRuleNotice("com.a.a", AppRuleLevel.BLOCKED, "2026-10-01", null, 0)
        assertEquals("2026-10-01:com.a.a:BLOCKED:-", blockedNotice.dismissKey)
        assertEquals("AppRuleNotice(LIMIT)", a.toString())
    }

    @Test
    fun `pending is the first notice not yet put away`() {
        val status = active(ev("com.a.a", AppRuleLevel.BLOCKED, 1, 1), ev("com.b.b", AppRuleLevel.BLOCKED, 1, 1))
        val first = AppRuleNotices.pending(status, "")!!
        assertEquals("com.a.a", first.packageName)
        val next = AppRuleNotices.pending(status, NoticeKeys.add("", first.dismissKey))!!
        assertEquals("com.b.b", next.packageName)
        val both = NoticeKeys.add(NoticeKeys.add("", first.dismissKey), next.dismissKey)
        assertNull(AppRuleNotices.pending(status, both))
    }

    @Test
    fun `notice keys are a bounded newline separated set`() {
        assertFalse(NoticeKeys.contains("", "a"))
        val one = NoticeKeys.add("", "a")
        assertEquals(one, NoticeKeys.add(one, "a"))
        assertTrue(NoticeKeys.contains(NoticeKeys.add(one, "b"), "a"))
        var joined = ""
        for (i in 0 until 80) joined = NoticeKeys.add(joined, "k$i")
        assertEquals(50, joined.split("\n").size)
        assertTrue(NoticeKeys.contains(joined, "k79"))
        assertFalse(NoticeKeys.contains(joined, "k0"))
    }

    // --- detector ---

    private val rulesVersion = 5
    private val blockedSet = setOf("com.a.a")

    private fun state(
        watermark: Long?,
        version: Int? = rulesVersion,
        lastSeen: Map<String, Long> = emptyMap(),
        pending: List<AppAttempt> = emptyList(),
    ) = AppAttemptState(version, watermark, lastSeen, pending)

    @Test
    fun `a new rule version starts at now without scanning, so an earlier open is no attempt`() {
        val events = listOf(fg("com.a.a", noon - 5 * minute))
        val result = AppAttemptDetector.detect(state(noon - hour, version = 4), rulesVersion, blockedSet, events, noon)
        assertEquals(rulesVersion, result.rulesVersion)
        assertEquals(noon, result.watermarkMillis)
        assertTrue(result.pending.isEmpty())
        val first = AppAttemptDetector.detect(AppAttemptState(), rulesVersion, blockedSet, events, noon)
        assertTrue(first.pending.isEmpty())
        assertEquals(noon, first.watermarkMillis)
    }

    @Test
    fun `only blocked foreground events strictly after the watermark and not after now count`() {
        val w = noon - 10 * minute
        val events = listOf(
            // at the watermark: already looked at
            fg("com.a.a", w),
            fg("com.a.a", w + minute),
            // not blocked
            fg("com.x.x", w + 2 * minute),
            // not a foreground event
            bg("com.a.a", w + 3 * minute),
            UsageEvent(UsageEventKind.SCREEN_ON, null, w + 4 * minute),
            // in the future
            fg("com.a.a", noon + minute),
        )
        val result = AppAttemptDetector.detect(state(w), rulesVersion, blockedSet, events, noon)
        assertEquals(listOf(AppAttempt("com.a.a", w + minute)), result.pending)
        assertEquals(noon, result.watermarkMillis)
    }

    @Test
    fun `the same package is counted once per five minutes, across checks too`() {
        val w = noon - 20 * minute
        val events = listOf(fg("com.a.a", w + minute), fg("com.a.a", w + 3 * minute), fg("com.a.a", w + 6 * minute))
        val first = AppAttemptDetector.detect(state(w), rulesVersion, blockedSet, events, w + 5 * minute)
        // the third event is after "now" of that first check, the second is inside the dedupe window
        assertEquals(listOf(AppAttempt("com.a.a", w + minute)), first.pending)
        val second = AppAttemptDetector.detect(first, rulesVersion, blockedSet, events, noon)
        assertEquals(listOf(AppAttempt("com.a.a", w + minute), AppAttempt("com.a.a", w + 6 * minute)), second.pending)
        // exactly five minutes apart is counted again (the server drops only "within" five minutes)
        val edge = AppAttemptDetector.detect(
            state(w, lastSeen = mapOf("com.a.a" to w + minute)),
            rulesVersion,
            blockedSet,
            listOf(fg("com.a.a", w + 6 * minute)),
            noon,
        )
        assertEquals(1, edge.pending.size)
        val inside = AppAttemptDetector.detect(
            state(w, lastSeen = mapOf("com.a.a" to w + minute)),
            rulesVersion,
            blockedSet,
            listOf(fg("com.a.a", w + 6 * minute - 1)),
            noon,
        )
        assertTrue(inside.pending.isEmpty())
    }

    @Test
    fun `a watermark in the future (clock moved back) resets to now`() {
        val events = listOf(fg("com.a.a", noon - minute))
        val result = AppAttemptDetector.detect(state(noon + hour), rulesVersion, blockedSet, events, noon)
        assertTrue(result.pending.isEmpty())
        assertEquals(noon, result.watermarkMillis)
    }

    @Test
    fun `never looks back further than the scan limit`() {
        val old = noon - AppRuleLimits.SCAN_MAX_MILLIS - hour
        assertEquals(noon - AppRuleLimits.SCAN_MAX_MILLIS, AppAttemptDetector.scanFrom(state(old), noon))
        assertEquals(noon, AppAttemptDetector.scanFrom(AppAttemptState(), noon))
        assertEquals(noon - minute, AppAttemptDetector.scanFrom(state(noon - minute), noon))
        val events = listOf(fg("com.a.a", old + minute))
        val result = AppAttemptDetector.detect(state(old), rulesVersion, blockedSet, events, noon)
        assertTrue(result.pending.isEmpty())
    }

    @Test
    fun `the outbox and the dedupe memory are bounded`() {
        val pkgs = (0 until 60).map { "com.example.app$it" }
        val w = noon - hour
        val events = pkgs.mapIndexed { i, p -> fg(p, w + (i + 1) * 1_000L) }
        val result = AppAttemptDetector.detect(state(w), rulesVersion, pkgs.toSet(), events, noon)
        assertEquals(AppRuleLimits.OUTBOX_MAX, result.pending.size)
        // the newest attempts are kept
        assertEquals(pkgs.last(), result.pending.last().packageName)
        val many = (0 until 250).associate { "com.example.p$it" to (w + it + 1L) }
        val trimmed = AppAttemptDetector.detect(state(w, lastSeen = many), rulesVersion, blockedSet, emptyList(), noon)
        assertEquals(AppRuleLimits.LAST_SEEN_MAX, trimmed.lastSeen.size)
    }

    @Test
    fun `advance moves only the watermark`() {
        val before = state(noon - hour, lastSeen = mapOf("com.a.a" to 1L), pending = listOf(AppAttempt("com.a.a", 2L)))
        val after = AppAttemptDetector.advance(before, noon)
        assertEquals(noon, after.watermarkMillis)
        assertEquals(before.lastSeen, after.lastSeen)
        assertEquals(before.pending, after.pending)
        assertEquals(before.rulesVersion, after.rulesVersion)
    }

    // --- state codec ---

    @Test
    fun `the state codec round-trips and writes the documented string`() {
        val s = AppAttemptState(
            5,
            1_700_000_000_000L,
            mapOf("com.a.a" to 10L, "com.b.b" to 20L),
            listOf(AppAttempt("com.a.a", 10L), AppAttempt("com.b.b", 20L)),
        )
        val text = AppAttemptStateCodec.encode(s)
        assertEquals("v1;5;1700000000000;com.a.a=10,com.b.b=20;com.a.a=10,com.b.b=20", text)
        assertEquals(s, AppAttemptStateCodec.decode(text))
        assertEquals("v1;;;;", AppAttemptStateCodec.encode(AppAttemptState()))
        assertEquals(AppAttemptState(), AppAttemptStateCodec.decode("v1;;;;"))
    }

    @Test
    fun `the state codec rejects junk`() {
        val junk = listOf(
            null, "", "v1", "v0;;;;", "v1;x;;;", "v1;;0;;", "v1;;-5;;", "v1;;x;;", "v1;;;com.a.a;", "v1;;;com.a.a=;",
            "v1;;;com.a.a=0;", "v1;;;x=1;", "v1;;;com.a.a=1,com.a.a=2;", "v1;;;;com.a.a=-1", "v1;;;;x=1",
            "v1;;;;;extra",
            "v1;;;com.a.a=1=2;",
        )
        for (text in junk) assertNull(AppAttemptStateCodec.decode(text), text.toString())
        val tooMany = (0 until AppRuleLimits.OUTBOX_MAX + 1).joinToString(",") { "com.a.a=${it + 1}" }
        assertNull(AppAttemptStateCodec.decode("v1;;;;$tooMany"))
    }

    @Test
    fun `state toString names nothing`() {
        assertEquals("AppAttemptState", AppAttemptState(1, 2L, mapOf("com.secret.app" to 1L)).toString())
        assertEquals("AppAttempt", AppAttempt("com.secret.app", 1L).toString())
    }

    // --- batch ---

    @Test
    fun `usable drops attempts the server would refuse and pulls the future back to now`() {
        val tooOld = AppAttempt("com.a.a", noon - (AppRuleLimits.EVENT_PAST_SECONDS - 120) * 1_000L - 1)
        val limit = AppAttempt("com.b.b", noon - (AppRuleLimits.EVENT_PAST_SECONDS - 120) * 1_000L)
        val future = AppAttempt("com.c.c", noon + 10 * minute)
        val usable = AppAttemptBatch.usable(listOf(future, tooOld, limit), noon)
        assertEquals(listOf(limit, AppAttempt("com.c.c", noon)), usable)
    }

    @Test
    fun `a batch is the oldest twenty usable attempts`() {
        val all = (0 until 30).map { AppAttempt("com.example.app$it", noon - 60 * minute + it * 1_000L) }
        val batch = AppAttemptBatch.next(all.reversed(), noon)
        assertEquals(20, batch.size)
        assertEquals(all.take(20), batch)
    }

    @Test
    fun `wire time is UTC whole seconds with a Z`() {
        assertEquals("2026-10-01T12:00:00Z", AppAttemptBatch.wireTime(noon))
        assertEquals("2026-10-01T12:00:00Z", AppAttemptBatch.wireTime(noon + 999))
        assertEquals("2026-10-01T12:00:01Z", AppAttemptBatch.wireTime(noon + 1_000))
        val pattern = Regex("""^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}Z$""")
        assertTrue(pattern.matches(AppAttemptBatch.wireTime(0L)))
    }

    // --- labels ---

    @Test
    fun `the label comes from the acknowledged app list, else the package`() {
        val inventory = AppInventoryReport(
            AppInventory(
                listOf(InstalledApp("com.a.a", "Alpha", "1.0", false), InstalledApp("com.b.b", " ", null, false)),
                0,
            ),
            noon,
        )
        assertEquals("Alpha", AppRuleLabels.labelFor("com.a.a", inventory))
        assertEquals("com.b.b", AppRuleLabels.labelFor("com.b.b", inventory))
        assertEquals("com.c.c", AppRuleLabels.labelFor("com.c.c", inventory))
        assertEquals("com.a.a", AppRuleLabels.labelFor("com.a.a", null))
    }

    @Test
    fun `status toString names no package`() {
        assertEquals("AppRuleStatus.Active(1)", active(ev("com.secret.app", AppRuleLevel.BLOCKED, 0, 0)).toString())
        assertEquals(
            "AppRuleStatus.Inactive(NO_RULES)",
            AppRuleStatus.Inactive(AppRuleInactiveReason.NO_RULES, 1L).toString(),
        )
        assertEquals("AppRuleReading", AppRuleReading(AppRuleStatus.Unchecked, emptyList(), null).toString())
    }
}
