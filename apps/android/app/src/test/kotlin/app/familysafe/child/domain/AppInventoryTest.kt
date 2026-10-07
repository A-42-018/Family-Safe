package app.familysafe.child.domain

import org.junit.jupiter.api.Assertions.assertEquals
import org.junit.jupiter.api.Assertions.assertFalse
import org.junit.jupiter.api.Assertions.assertNotEquals
import org.junit.jupiter.api.Assertions.assertNull
import org.junit.jupiter.api.Assertions.assertTrue
import org.junit.jupiter.api.Test

class AppInventoryTest {
    private fun app(pkg: String, label: String = "App", version: String? = "1.0", system: Boolean = false) =
        InstalledApp(pkg, label, version, system)

    private fun sanitize(vararg apps: InstalledApp) = AppInventorySanitizer.sanitize(apps.toList())

    // ---- sanitizer ----

    @Test
    fun `a valid app passes through unchanged`() {
        val inventory = sanitize(app("com.example.chat", "Chat", "2.3.1", system = true))
        assertEquals(listOf(app("com.example.chat", "Chat", "2.3.1", system = true)), inventory.apps)
        assertEquals(0, inventory.omittedCount)
    }

    @Test
    fun `label and version are trimmed like JavaScript trim, including the byte order mark`() {
        val one = AppInventorySanitizer.normalize(app("com.a.b", "\uFEFF  Chat \u00A0", "\u2003 1.0 \uFEFF"))!!
        assertEquals("Chat", one.label)
        assertEquals("1.0", one.versionName)
    }

    @Test
    fun `control characters become spaces, then the text is trimmed`() {
        val one = AppInventorySanitizer.normalize(app("com.a.b", "Ca\u0000t\u009f", "\u0007v1\u007f"))!!
        assertEquals("Ca t", one.label)
        assertEquals("v1", one.versionName)
        assertFalse(Regex("[\\u0000-\\u001f\\u007f-\\u009f]").containsMatchIn(one.label))
    }

    @Test
    fun `a blank label falls back to the package name`() {
        assertEquals("com.a.b", AppInventorySanitizer.normalize(app("com.a.b", "   \u0000  "))!!.label)
        assertEquals("com.a.b", AppInventorySanitizer.normalize(app("com.a.b", ""))!!.label)
    }

    @Test
    fun `a blank or missing version becomes null, never an empty string`() {
        assertNull(AppInventorySanitizer.normalize(app("com.a.b", "A", "  "))!!.versionName)
        assertNull(AppInventorySanitizer.normalize(app("com.a.b", "A", ""))!!.versionName)
        assertNull(AppInventorySanitizer.normalize(app("com.a.b", "A", null))!!.versionName)
    }

    @Test
    fun `too long label and version are cut to the contract limits`() {
        val one = AppInventorySanitizer.normalize(app("com.a.b", "x".repeat(500), "9".repeat(500)))!!
        assertEquals(AppInventoryLimits.LABEL_MAX, one.label.length)
        assertEquals(AppInventoryLimits.VERSION_MAX, one.versionName!!.length)
    }

    @Test
    fun `a cut never splits a surrogate pair and never ends in a space`() {
        val emoji = "\uD83D\uDE00"
        val label = "a".repeat(AppInventoryLimits.LABEL_MAX - 1) + emoji
        val one = AppInventorySanitizer.normalize(app("com.a.b", label))!!
        assertEquals("a".repeat(AppInventoryLimits.LABEL_MAX - 1), one.label)
        val spaced = "a".repeat(AppInventoryLimits.LABEL_MAX - 1) + " b"
        val cutAtSpace = AppInventorySanitizer.normalize(app("com.a.b", spaced))!!.label
        assertEquals("a".repeat(AppInventoryLimits.LABEL_MAX - 1), cutAtSpace)
    }

    @Test
    fun `package names the contract cannot carry leave the app out and are counted`() {
        val bad = listOf(
            "", "single", "1com.example", "com..example", "com.example.", ".com.example", "com.exa mple",
            "com.exämple", "com.example-app", "a".repeat(AppInventoryLimits.PACKAGE_MAX) + ".x",
        )
        val inventory = AppInventorySanitizer.sanitize(bad.map { app(it) } + app("com.ok.app"))
        assertEquals(listOf("com.ok.app"), inventory.apps.map { it.packageName })
        assertEquals(bad.size, inventory.omittedCount)
    }

    @Test
    fun `the pattern accepts the shapes Android really uses`() {
        for (pkg in listOf("com.android.chrome", "org.a_b.c1", "A.b", "com.example.App_2")) {
            assertEquals(pkg, AppInventorySanitizer.normalize(app(pkg))?.packageName, pkg)
        }
    }

    @Test
    fun `the package limit is exactly 255 characters`() {
        val ok = "a." + "b".repeat(AppInventoryLimits.PACKAGE_MAX - 2)
        assertEquals(AppInventoryLimits.PACKAGE_MAX, ok.length)
        assertEquals(ok, AppInventorySanitizer.normalize(app(ok))?.packageName)
        assertNull(AppInventorySanitizer.normalize(app(ok + "c")))
    }

    @Test
    fun `duplicates keep one entry, chosen deterministically`() {
        val a = sanitize(app("com.a.b", "Zed"), app("com.a.b", "Alpha"))
        val b = sanitize(app("com.a.b", "Alpha"), app("com.a.b", "Zed"))
        assertEquals(listOf("Alpha"), a.apps.map { it.label })
        assertEquals(a, b)
        assertEquals(0, a.omittedCount)
    }

    @Test
    fun `the result is sorted by package name regardless of input order`() {
        val inventory = sanitize(app("org.z.z"), app("com.b.b"), app("com.a.a"), app("net.m.m"))
        assertEquals(listOf("com.a.a", "com.b.b", "net.m.m", "org.z.z"), inventory.apps.map { it.packageName })
    }

    @Test
    fun `exactly 500 apps are all kept`() {
        val raw = (1..500).map { app("com.example.app%04d".format(it)) }
        val inventory = AppInventorySanitizer.sanitize(raw)
        assertEquals(500, inventory.apps.size)
        assertEquals(0, inventory.omittedCount)
    }

    @Test
    fun `over the cap the first 500 by package name are kept and the rest is counted, never an error`() {
        val raw = (1..520).map { app("com.example.app%04d".format(it)) }.shuffled(java.util.Random(7))
        val inventory = AppInventorySanitizer.sanitize(raw)
        assertEquals(500, inventory.apps.size)
        assertEquals(20, inventory.omittedCount)
        assertEquals("com.example.app0001", inventory.apps.first().packageName)
        assertEquals("com.example.app0500", inventory.apps.last().packageName)
    }

    @Test
    fun `cap counting adds invalid packages to the overflow`() {
        val raw = (1..503).map { app("com.example.app%04d".format(it)) } + app("bad") + app("also bad")
        val inventory = AppInventorySanitizer.sanitize(raw)
        assertEquals(500, inventory.apps.size)
        assertEquals(3 + 2, inventory.omittedCount)
    }

    @Test
    fun `the same phone always produces the same list and fingerprint`() {
        val raw = (1..600).map { app("com.example.app%04d".format(it), "App $it") }
        val first = AppInventorySanitizer.sanitize(raw)
        val second = AppInventorySanitizer.sanitize(raw.shuffled(java.util.Random(3)))
        assertEquals(first, second)
        assertEquals(first.fingerprint, second.fingerprint)
    }

    @Test
    fun `sanitizing is idempotent`() {
        val raw = listOf(app("com.a.b", "  X\u0000Y  ", " 1 "), app("bad"), app("com.c.d", "", null, true))
        val once = AppInventorySanitizer.sanitize(raw)
        val twice = AppInventorySanitizer.sanitize(once.apps)
        assertEquals(once.apps, twice.apps)
        assertEquals(0, twice.omittedCount)
    }

    @Test
    fun `an empty reading is an empty inventory`() {
        val inventory = AppInventorySanitizer.sanitize(emptyList())
        assertTrue(inventory.apps.isEmpty())
        assertEquals(0, inventory.omittedCount)
    }

    // ---- fingerprint ----

    @Test
    fun `fingerprint changes with every field that is sent`() {
        val base = sanitize(app("com.a.b", "A", "1", false)).fingerprint
        assertEquals(base, sanitize(app("com.a.b", "A", "1", false)).fingerprint)
        for (changed in listOf(
            app("com.a.c", "A", "1", false),
            app("com.a.b", "B", "1", false),
            app("com.a.b", "A", "2", false),
            app("com.a.b", "A", null, false),
            app("com.a.b", "A", "1", true),
        )) {
            assertNotEquals(base, sanitize(changed).fingerprint)
        }
    }

    @Test
    fun `fingerprint includes the omitted count and is a 64 character hex string`() {
        val one = AppInventory(listOf(app("com.a.b")), 0)
        val other = AppInventory(listOf(app("com.a.b")), 1)
        assertNotEquals(one.fingerprint, other.fingerprint)
        assertTrue(Regex("[0-9a-f]{64}").matches(one.fingerprint))
    }

    @Test
    fun `fingerprint separates fields unambiguously`() {
        val a = AppInventory(listOf(app("com.a.b", "cd", "e")), 0).fingerprint
        val b = AppInventory(listOf(app("com.a.b", "c", "de")), 0).fingerprint
        val noVersion = AppInventory(listOf(app("com.a.b", "cd", null)), 0).fingerprint
        val emptyLikeVersion = AppInventory(listOf(app("com.a.b", "cd", "0")), 0).fingerprint
        assertNotEquals(a, b)
        assertNotEquals(noVersion, emptyLikeVersion)
    }

    @Test
    fun `toString never prints app data`() {
        val text = listOf(app("com.secret.game", "Secret Game").toString(), sanitize(app("com.secret.game")).toString())
        for (t in text) assertFalse(t.contains("secret", ignoreCase = true), t)
        assertFalse(AppInventoryReport(sanitize(app("com.secret.game")), 5L).toString().contains("secret"))
    }

    // ---- codec ----

    private fun report(vararg apps: InstalledApp, omitted: Int = 0, at: Long = 1_700_000_000_000L) =
        AppInventoryReport(AppInventory(sanitize(*apps).apps, omitted), at)

    @Test
    fun `codec round-trips, including nulls, system flags and unicode`() {
        val original = report(
            app("com.a.b", "Ärger \uD83D\uDE00", null, true),
            app("com.c.d", "Plain", "1.2", false),
            omitted = 7,
        )
        val back = AppInventoryReportCodec.decode(AppInventoryReportCodec.encode(original))!!
        assertEquals(original.inventory, back.inventory)
        assertEquals(original.sentAtEpochMillis, back.sentAtEpochMillis)
        assertEquals(original.fingerprint, back.fingerprint)
    }

    @Test
    fun `codec round-trips an empty list and a full list of 500`() {
        val empty = report()
        assertEquals(empty.inventory, AppInventoryReportCodec.decode(AppInventoryReportCodec.encode(empty))!!.inventory)
        val full = report(*(1..500).map { app("com.example.app%04d".format(it)) }.toTypedArray())
        assertEquals(500, AppInventoryReportCodec.decode(AppInventoryReportCodec.encode(full))!!.inventory.apps.size)
    }

    @Test
    fun `codec rejects everything it would not have written`() {
        val good = AppInventoryReportCodec.encode(report(app("com.a.b"), app("com.c.d")))
        val rs = '\u001e'
        val fs = '\u001f'
        val bad = listOf(
            "",
            "garbage",
            "v2${fs}5${fs}0",
            "v1${fs}0${fs}0",
            "v1$fs-5${fs}0",
            "v1${fs}5$fs-1",
            "v1${fs}5${fs}9999999",
            "v1${fs}abc${fs}0",
            "v1${fs}5",
            "v1${fs}5${fs}0${rs}com.a.b${fs}A${fs}${fs}2",
            "v1${fs}5${fs}0${rs}com.a.b${fs}A${fs}${fs}1${fs}x",
            "v1${fs}5${fs}0${rs}bad${fs}A${fs}${fs}0",
            "v1${fs}5${fs}0${rs}com.a.b$fs  A${fs}${fs}0",
            "v1${fs}5${fs}0${rs}com.c.d${fs}A${fs}${fs}0${rs}com.a.b${fs}A${fs}${fs}0",
            "v1${fs}5${fs}0${rs}com.a.b${fs}A${fs}${fs}0${rs}com.a.b${fs}A${fs}${fs}0",
            good + rs,
        )
        assertTrue(AppInventoryReportCodec.decode(good) != null)
        for (text in bad) assertNull(AppInventoryReportCodec.decode(text), text.replace(rs, '|').replace(fs, ';'))
        assertNull(AppInventoryReportCodec.decode(null))
    }

    @Test
    fun `codec refuses more than 500 records`() {
        val fs = '\u001f'
        val rs = '\u001e'
        val rows = (1..501).joinToString(rs.toString()) { "com.example.app%04d${fs}A${fs}${fs}0".format(it) }
        assertNull(AppInventoryReportCodec.decode("v1${fs}5${fs}0$rs$rows"))
    }

    // ---- policy ----

    @Test
    fun `no report yet is not a change`() {
        assertFalse(AppInventoryPolicy.needsUploadNow(null, sanitize(app("com.a.b"))))
    }

    @Test
    fun `an empty reading never triggers an upload`() {
        assertFalse(AppInventoryPolicy.needsUploadNow(report(app("com.a.b")), AppInventory(emptyList(), 0)))
    }

    @Test
    fun `a different list triggers an upload, an identical one does not`() {
        val last = report(app("com.a.b", "A", "1"))
        assertFalse(AppInventoryPolicy.needsUploadNow(last, sanitize(app("com.a.b", "A", "1"))))
        assertTrue(AppInventoryPolicy.needsUploadNow(last, sanitize(app("com.a.b", "A", "2"))))
        assertTrue(AppInventoryPolicy.needsUploadNow(last, sanitize(app("com.a.b", "A", "1"), app("com.c.d"))))
        assertTrue(AppInventoryPolicy.needsUploadNow(last, sanitize(app("com.c.d"))))
    }

    @Test
    fun `an app updating its version counts as a change`() {
        val last = report(app("com.a.b", "A", "1.0"))
        assertTrue(AppInventoryPolicy.needsUploadNow(last, sanitize(app("com.a.b", "A", "1.1"))))
    }

    @Test
    fun `opening the app checks at most every 15 minutes, a clock going backwards checks now`() {
        val gap = AppInventoryLimits.CHECK_MIN_GAP_MILLIS
        assertTrue(AppInventoryPolicy.shouldCheck(null, 1_000L))
        assertFalse(AppInventoryPolicy.shouldCheck(1_000L, 1_000L))
        assertFalse(AppInventoryPolicy.shouldCheck(1_000L, 1_000L + gap - 1))
        assertTrue(AppInventoryPolicy.shouldCheck(1_000L, 1_000L + gap))
        assertTrue(AppInventoryPolicy.shouldCheck(10_000L, 9_999L))
    }
}
