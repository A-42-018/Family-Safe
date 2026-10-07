package app.familysafe.child.domain

import org.junit.jupiter.api.Assertions.assertEquals
import org.junit.jupiter.api.Assertions.assertFalse
import org.junit.jupiter.api.Assertions.assertNotNull
import org.junit.jupiter.api.Assertions.assertNull
import org.junit.jupiter.api.Assertions.assertTrue
import org.junit.jupiter.api.Test

class AppRulesTest {
    @Test
    fun `a rule must block or limit, and a limit stays within a day`() {
        assertNotNull(AppRule.validated("com.example.game", true, null))
        assertNotNull(AppRule.validated("com.example.game", true, 30))
        assertNotNull(AppRule.validated("com.example.game", false, 0))
        assertNotNull(AppRule.validated("com.example.game", false, 1_440))
        assertNull(AppRule.validated("com.example.game", false, null))
        assertNull(AppRule.validated("com.example.game", false, 1_441))
        assertNull(AppRule.validated("com.example.game", false, -1))
    }

    @Test
    fun `package names follow the contract pattern and the child app can never be restricted`() {
        val bad = listOf(
            "", "x", "1com.a", "com..a", "com.a b", "com.a;b", "com.a,b", "com.a=b", "a".repeat(256) + ".b",
        )
        for (name in bad) {
            assertNull(AppRule.validated(name, true, null), name)
        }
        assertNull(AppRule.validated(AppRuleLimits.CHILD_APP_PACKAGE, true, null))
        assertNotNull(AppRule.validated("com.example.child", true, null))
    }

    @Test
    fun `the wire form is validated the same way`() {
        assertNotNull(AppRule.validated(RawAppRule("com.example.game", true, null)))
        assertNull(AppRule.validated(RawAppRule("com.example.game", false, null)))
    }

    @Test
    fun `toString never names the package`() {
        assertEquals("AppRule", AppRule.validated("com.example.secret", true, null).toString())
        assertEquals("RawAppRule", RawAppRule("com.example.secret", true, null).toString())
    }

    @Test
    fun `equality covers every field`() {
        val a = AppRule.validated("com.example.a", true, 10)!!
        assertEquals(a, AppRule.validated("com.example.a", true, 10))
        assertFalse(a == AppRule.validated("com.example.a", true, 11))
        assertFalse(a == AppRule.validated("com.example.a", false, 10))
        assertFalse(a == AppRule.validated("com.example.b", true, 10))
    }

    @Test
    fun `a list is sorted, capped and has no duplicates`() {
        val a = AppRule.validated("com.example.a", true, null)!!
        val b = AppRule.validated("com.example.b", false, 5)!!
        assertEquals(listOf(a, b), AppRuleList.validated(listOf(b, a)))
        assertNull(AppRuleList.validated(listOf(a, a)))
        val many = (0 until AppRuleLimits.MAX_RULES + 1).map { AppRule.validated("com.example.app$it", true, null)!! }
        assertNull(AppRuleList.validated(many))
        assertNotNull(AppRuleList.validated(many.take(AppRuleLimits.MAX_RULES)))
        assertEquals(emptyList<AppRule>(), AppRuleList.validated(emptyList()))
    }

    @Test
    fun `the storage form round-trips blocked, limited and blocked-with-kept-limit`() {
        val rules = listOf(
            AppRule.validated("com.example.a", true, null)!!,
            AppRule.validated("com.example.b", true, 60)!!,
            AppRule.validated("com.example.c", false, 0)!!,
            AppRule.validated("com.example.d", false, 1_440)!!,
        )
        val text = AppRuleList.encode(rules)
        assertEquals("com.example.a=B,com.example.b=B60,com.example.c=L0,com.example.d=L1440", text)
        assertEquals(rules, AppRuleList.decode(text))
        assertEquals(emptyList<AppRule>(), AppRuleList.decode(""))
        assertEquals("", AppRuleList.encode(emptyList()))
    }

    @Test
    fun `the storage form rejects anything encode would not write`() {
        val junk = listOf(
            ",", "com.a.b", "com.a.b=", "com.a.b=X", "com.a.b=B1441x", "com.a.b=L", "com.a.b=b", "com.a.b=B12345",
            "com.a.b=L1441", "com.a.b=B,", ",com.a.b=B", "com.a.b=B=B", "x=B", "app.familysafe.child=B",
            "com.a.b=B;com.c.d=B", " com.a.b=B",
        )
        for (text in junk) assertNull(AppRuleList.decode(text), text)
    }

    @Test
    fun `a duplicate package decodes but never validates, so a config with it is refused`() {
        val decoded = AppRuleList.decode("com.a.b=B,com.a.b=L5")!!
        assertEquals(2, decoded.size)
        assertNull(AppRuleList.validated(decoded))
        assertNull(ScreenTimeConfig.validated(1, null, emptyMap(), null, false, decoded))
    }

    @Test
    fun `limits are the contract numbers`() {
        assertEquals(200, AppRuleLimits.MAX_RULES)
        assertEquals("app.familysafe.child", AppRuleLimits.CHILD_APP_PACKAGE)
        assertEquals(20, AppRuleLimits.EVENTS_MAX)
        assertEquals(86_400L, AppRuleLimits.EVENT_PAST_SECONDS)
        assertEquals(300L, AppRuleLimits.EVENT_FUTURE_SECONDS)
        assertEquals(60L, AppRuleLimits.EVENT_EDGE_MARGIN_SECONDS)
        assertEquals(300L, AppRuleLimits.ATTEMPT_DEDUPE_SECONDS)
        // the scan never reaches further back than the narrowed server window minus the client margin
        assertEquals((86_400L - 60L - 60L) * 1_000L, AppRuleLimits.SCAN_MAX_MILLIS)
        assertTrue(AppRuleLimits.SCAN_MAX_MILLIS < AppRuleLimits.EVENT_PAST_SECONDS * 1_000L)
    }
}
