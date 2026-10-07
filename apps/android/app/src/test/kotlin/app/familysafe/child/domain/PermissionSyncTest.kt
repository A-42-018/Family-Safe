package app.familysafe.child.domain

import org.junit.jupiter.api.Assertions.assertEquals
import org.junit.jupiter.api.Assertions.assertFalse
import org.junit.jupiter.api.Assertions.assertNotNull
import org.junit.jupiter.api.Assertions.assertNull
import org.junit.jupiter.api.Assertions.assertTrue
import org.junit.jupiter.api.Test

class PermissionSyncTest {
    private fun observation(state: (PermissionKey) -> PermissionState = { PermissionState.NOT_REQUESTED }) =
        PermissionObservation.create(PermissionCatalog.SYNCED.associateWith(state))!!

    private fun facts(
        available: Boolean = true,
        granted: Boolean = false,
        everGranted: Boolean = false,
        requested: Boolean = false,
    ) = PermissionFacts(available, granted, everGranted, requested)

    @Test
    fun `mapper covers every combination of the four facts`() {
        assertEquals(PermissionState.NOT_AVAILABLE, PermissionStateMapper.map(facts(available = false)))
        assertEquals(
            PermissionState.NOT_AVAILABLE,
            PermissionStateMapper.map(facts(available = false, granted = true, everGranted = true, requested = true)),
        )
        assertEquals(PermissionState.GRANTED, PermissionStateMapper.map(facts(granted = true)))
        assertEquals(PermissionState.GRANTED, PermissionStateMapper.map(facts(granted = true, everGranted = true)))
        assertEquals(PermissionState.REVOKED, PermissionStateMapper.map(facts(everGranted = true)))
        assertEquals(PermissionState.REVOKED, PermissionStateMapper.map(facts(everGranted = true, requested = true)))
        assertEquals(PermissionState.DENIED, PermissionStateMapper.map(facts(requested = true)))
        assertEquals(PermissionState.NOT_REQUESTED, PermissionStateMapper.map(facts()))
    }

    @Test
    fun `the mapper never invents RESTRICTED`() {
        val all = listOf(true, false)
        for (a in all) for (g in all) for (e in all) for (r in all) {
            assertFalse(PermissionStateMapper.map(facts(a, g, e, r)) == PermissionState.RESTRICTED)
        }
    }

    @Test
    fun `synced keys are exactly the ones with a wire name, each once`() {
        assertEquals(PermissionKey.entries.filter { it.wireName != null }.toSet(), PermissionCatalog.SYNCED.toSet())
        assertEquals(PermissionCatalog.SYNCED.size, PermissionCatalog.SYNCED.toSet().size)
        assertEquals(8, PermissionCatalog.SYNCED.size)
    }

    @Test
    fun `an observation must hold exactly the synced keys`() {
        assertNull(PermissionObservation.create(emptyMap()))
        val missingOne = PermissionCatalog.SYNCED.drop(1).associateWith { PermissionState.GRANTED }
        assertNull(PermissionObservation.create(missingOne))
        val extra = PermissionCatalog.SYNCED.associateWith { PermissionState.GRANTED } +
            (PermissionKey.USAGE_ACCESS to PermissionState.GRANTED)
        assertNull(PermissionObservation.create(extra))
        assertNotNull(PermissionObservation.create(PermissionCatalog.SYNCED.associateWith { PermissionState.GRANTED }))
    }

    @Test
    fun `observations compare by content and never print their states`() {
        assertEquals(observation(), observation())
        assertFalse(observation() == observation { PermissionState.GRANTED })
        assertEquals("PermissionObservation", observation().toString())
    }

    @Test
    fun `the report codec round-trips every state`() {
        val states = PermissionState.entries
        val obs = observation { states[PermissionCatalog.SYNCED.indexOf(it) % states.size] }
        val text = PermissionSyncReportCodec.encode(PermissionSyncReport(obs, 42L))
        val decoded = PermissionSyncReportCodec.decode(text)!!
        assertEquals(obs, decoded.observation)
        assertEquals(42L, decoded.sentAtEpochMillis)
    }

    @Test
    fun `the report codec writes one line in the contract order`() {
        val text = PermissionSyncReportCodec.encode(PermissionSyncReport(observation(), 7L))
        assertEquals("7;" + List(8) { "NOT_REQUESTED" }.joinToString(","), text)
    }

    @Test
    fun `junk or tampered report text decodes to nothing`() {
        val ok = List(8) { "GRANTED" }.joinToString(",")
        val junk = listOf(
            null,
            "",
            "yesterday",
            "0;$ok",
            "-5;$ok",
            "x;$ok",
            "5;",
            "5;GRANTED",
            "5;${List(7) { "GRANTED" }.joinToString(",")}",
            "5;${List(9) { "GRANTED" }.joinToString(",")}",
            "5;${List(8) { "MAYBE" }.joinToString(",")}",
            "5;$ok;extra",
        )
        for (text in junk) assertNull(PermissionSyncReportCodec.decode(text), text)
    }

    @Test
    fun `the snapshot lists every key, preferring the current reading over the report`() {
        val current = observation { PermissionState.GRANTED }
        val report = PermissionSyncReport(observation { PermissionState.DENIED }, 9L)
        val snap = PermissionSnapshot.of(current, report)
        assertEquals(PermissionKey.entries, snap.entries.map { it.key })
        assertEquals(9L, snap.sharedAtEpochMillis)
        for (entry in snap.entries) {
            val expected = if (entry.key.wireName != null) PermissionState.GRANTED else PermissionState.NOT_REQUESTED
            assertEquals(expected, entry.state, entry.key.name)
        }
    }

    @Test
    fun `without a current reading the snapshot falls back to the report, then to not requested`() {
        val report = PermissionSyncReport(observation { PermissionState.DENIED }, 9L)
        val fromReport = PermissionSnapshot.of(null, report)
        assertEquals(PermissionState.DENIED, fromReport.entries.first { it.key == PermissionKey.CAMERA }.state)
        val empty = PermissionSnapshot.of(null, null)
        assertTrue(empty.entries.all { it.state == PermissionState.NOT_REQUESTED })
        assertNull(empty.sharedAtEpochMillis)
    }

    @Test
    fun `policy uploads on resume when nothing was acknowledged, the state changed or the sync is stale`() {
        val now = 10_000_000_000L
        val same = observation { PermissionState.GRANTED }
        val fresh = PermissionSyncReport(same, now - 60_000L)
        assertTrue(PermissionSyncPolicy.needsUploadNow(null, same, now))
        assertFalse(PermissionSyncPolicy.needsUploadNow(fresh, same, now))
        assertTrue(PermissionSyncPolicy.needsUploadNow(fresh, observation { PermissionState.REVOKED }, now))
        val thirtyMinutes = PermissionSyncLimits.RESUME_MIN_AGE_MINUTES * 60_000L
        assertFalse(PermissionSyncPolicy.needsUploadNow(PermissionSyncReport(same, now - thirtyMinutes + 1), same, now))
        assertTrue(PermissionSyncPolicy.needsUploadNow(PermissionSyncReport(same, now - thirtyMinutes), same, now))
    }

    @Test
    fun `a report stamped in the future (wrong clock) does not trigger an upload by age`() {
        val same = observation()
        assertFalse(PermissionSyncPolicy.needsUploadNow(PermissionSyncReport(same, 2_000L), same, 1_000L))
    }
}
