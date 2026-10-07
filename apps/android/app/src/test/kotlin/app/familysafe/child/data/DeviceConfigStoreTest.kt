package app.familysafe.child.data

import app.familysafe.child.domain.AppRule
import app.familysafe.child.domain.ScheduleWindow
import app.familysafe.child.domain.ScreenTimeConfig
import app.familysafe.child.testutil.MapSecureStore
import org.junit.jupiter.api.Assertions.assertEquals
import org.junit.jupiter.api.Assertions.assertFalse
import org.junit.jupiter.api.Assertions.assertNull
import org.junit.jupiter.api.Assertions.assertTrue
import org.junit.jupiter.api.Test

class DeviceConfigStoreTest {
    private fun config(version: Int = 3) = ScreenTimeConfig.validated(
        version,
        90,
        mapOf(6 to 180),
        emptyList(),
        "Asia/Dhaka",
        listOf(
            ScheduleWindow.validated(
                "00000000-0000-4000-8000-000000000001",
                "Night",
                "BEDTIME",
                listOf(1),
                "21:00",
                "07:00",
            )!!,
        ),
    )!!

    @Test
    fun `starts empty`() {
        assertNull(DeviceConfigStore(MapSecureStore()).cached.value)
    }

    @Test
    fun `records and survives a restart`() {
        val backing = MapSecureStore()
        DeviceConfigStore(backing).record(config(), 1_700_000_000_000L)
        val reopened = DeviceConfigStore(backing).cached.value!!
        assertEquals(config(), reopened.config)
        assertEquals(1_700_000_000_000L, reopened.validatedAtEpochMillis)
    }

    @Test
    fun `writes one key only so a restart cannot see half a config`() {
        val backing = MapSecureStore()
        val store = DeviceConfigStore(backing)
        store.record(config(), 5L)
        store.confirm(3, 9L)
        assertEquals(listOf("screen_time_config", "screen_time_config"), backing.putKeys)
    }

    @Test
    fun `confirm moves only the confirmation time, and only for the cached version`() {
        val store = DeviceConfigStore(MapSecureStore())
        assertFalse(store.confirm(3, 9L)) // nothing cached
        store.record(config(3), 5L)
        assertFalse(store.confirm(4, 9L)) // the server's version is not ours
        assertEquals(5L, store.cached.value!!.validatedAtEpochMillis)
        assertTrue(store.confirm(3, 9L))
        assertEquals(9L, store.cached.value!!.validatedAtEpochMillis)
        assertEquals(config(3), store.cached.value!!.config)
    }

    @Test
    fun `a new config replaces the old one completely`() {
        val store = DeviceConfigStore(MapSecureStore())
        store.record(config(3), 5L)
        store.record(ScreenTimeConfig.validated(4, null, emptyMap())!!, 8L)
        val now = store.cached.value!!
        assertEquals(4, now.config.version)
        assertNull(now.config.dailyLimitMinutes)
        assertTrue(now.config.dayOverrides.isEmpty())
        assertNull(now.config.timezone)
        assertTrue(now.config.schedules.isEmpty())
    }

    @Test
    fun `clear forgets it in memory and in storage`() {
        val backing = MapSecureStore()
        val store = DeviceConfigStore(backing)
        store.record(config(), 5L)
        store.clear()
        assertNull(store.cached.value)
        assertNull(DeviceConfigStore(backing).cached.value)
    }

    @Test
    fun `junk or tampered storage reads as no rules`() {
        val backing = MapSecureStore()
        val junkValues = listOf(
            "yesterday",
            "v3;5;0;90;;;;",
            "v3;5;3;99999;;;;",
            "v3;5;3;90;9=1;;;",
            "v3;5;3;90;;EST;;",
            "v3;5;3;90;;;bad;",
            "v3;5;3;90;;;;x=B",
            // older forms: v2 (bedtime/school) and the pre-18c six-field form
            "v2;5;3;90;;;0;",
            "5;3;90;;;0",
        )
        for (junk in junkValues) {
            backing.map["screen_time_config"] = junk
            assertNull(DeviceConfigStore(backing).cached.value, junk)
        }
    }

    @Test
    fun `broken storage never throws and still reports this process's value`() {
        val backing = MapSecureStore().apply {
            failGet = true
            failPut = { true }
        }
        val store = DeviceConfigStore(backing)
        assertNull(store.cached.value)
        store.record(config(), 5L)
        assertEquals(config(), store.cached.value!!.config)
        store.clear()
        assertNull(store.cached.value)
    }

    @Test
    fun `app rules survive a restart and a pre-18c cache is ignored`() {
        val backing = MapSecureStore()
        val rules = listOf(AppRule.validated("com.example.game", true, null)!!)
        val withRules = ScreenTimeConfig.validated(4, 90, emptyMap(), rules)!!
        DeviceConfigStore(backing).record(withRules, 9L)
        assertEquals(rules, DeviceConfigStore(backing).cached.value!!.config.appRules)
        backing.map["screen_time_config"] = "9;4;90;;;0"
        assertNull(DeviceConfigStore(backing).cached.value)
    }
}
