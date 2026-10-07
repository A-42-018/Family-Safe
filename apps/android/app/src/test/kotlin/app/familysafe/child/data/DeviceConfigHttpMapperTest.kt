package app.familysafe.child.data

import org.junit.jupiter.api.Assertions.assertEquals
import org.junit.jupiter.api.Assertions.assertInstanceOf
import org.junit.jupiter.api.Test

class DeviceConfigHttpMapperTest {
    private val body = """
        {"data":{"config_version":3,"daily_limit_minutes":120,"daily_limit_overrides":{"6":180},
        "bedtime_enabled":false,"bedtime_start":null,"bedtime_end":null,"school_mode_enabled":false,
        "app_rules":[],"server_time":"2026-10-01T09:30:00.000Z","next_interval_seconds":21600}}
    """.trimIndent()

    private fun appRuleJson(pkg: String, blocked: Boolean, limit: String) =
        "{\"package_name\":\"$pkg\",\"blocked\":$blocked,\"daily_limit_minutes\":$limit}"

    private fun appRulesJson(pkg: String, blocked: Boolean, limit: String) =
        "\"app_rules\":[" + appRuleJson(pkg, blocked, limit) + "]"

    private fun map(status: Int, text: String = "", retryAfter: String? = null, sent: Int? = 2) =
        DeviceConfigHttpMapper.map(status, retryAfter, text, sent)

    @Test
    fun `200 with a valid body is a fetched config`() {
        val result = assertInstanceOf(DeviceConfigResult.Fetched::class.java, map(200, body))
        assertEquals(3, result.parsed.config.version)
        assertEquals(180, result.parsed.config.limitFor(6))
    }

    @Test
    fun `200 with a body that is unreadable or off-contract is rejected, never fetched`() {
        val offContract = listOf(
            "", "not json", "{}", """{"data":{}}""",
            body.replace("\"config_version\":3", "\"config_version\":0"),
            body.replace("\"6\":180", "\"9\":180"),
            body.replace("21600", "3600"),
            body.replace("\"bedtime_end\":null", "\"bedtime_end\":\"07:00\""),
            // a dropped nullable key must not read as "no limit"
            body.replace("\"daily_limit_minutes\":120,", ""),
            body.replace("\"daily_limit_overrides\":{\"6\":180},", ""),
            // app rules are required too: a missing key must never read as "no app restrictions"
            body.replace("\"app_rules\":[],", ""),
            body.replace("\"app_rules\":[]", "\"app_rules\":null"),
            body.replace("\"app_rules\":[]", appRulesJson("x", true, "null")),
            body.replace("\"app_rules\":[]", appRulesJson("app.familysafe.child", true, "null")),
            body.replace("\"app_rules\":[]", appRulesJson("com.a.b", false, "null")),
            body.replace("\"app_rules\":[]", appRulesJson("com.a.b", false, "1441")),
            body.replace(
                "\"app_rules\":[]",
                "\"app_rules\":[" + appRuleJson("com.a.b", true, "null") + "," +
                    appRuleJson("com.a.b", true, "null") + "]",
            ),
        )
        for (text in offContract) assertEquals(DeviceConfigResult.Rejected, map(200, text), text)
    }

    @Test
    fun `200 with app rules carries them into the config`() {
        val text = body.replace(
            "\"app_rules\":[]",
            "\"app_rules\":[" + appRuleJson("com.example.video", false, "45") + "," +
                appRuleJson("com.example.game", true, "null") + "]",
        )
        val config = assertInstanceOf(DeviceConfigResult.Fetched::class.java, map(200, text)).parsed.config
        assertEquals(listOf("com.example.game", "com.example.video"), config.appRules.map { it.packageName })
        assertEquals(setOf("com.example.game"), config.blockedPackages)
        assertEquals(45, config.appRuleFor("com.example.video")!!.dailyLimitMinutes)
    }

    @Test
    fun `an extra unknown key does not break reading`() {
        val extra = body.replace("\"school_mode_enabled\":false,", "\"school_mode_enabled\":false,\"future\":1,")
        assertInstanceOf(DeviceConfigResult.Fetched::class.java, map(200, extra))
    }

    @Test
    fun `304 confirms the version that was sent, and means nothing without one`() {
        assertEquals(2, assertInstanceOf(DeviceConfigResult.NotModified::class.java, map(304, sent = 2)).version)
        assertEquals(DeviceConfigResult.Rejected, map(304, sent = null))
    }

    @Test
    fun `401, 429 and every 5xx are retryable, other statuses are rejected`() {
        assertEquals(DeviceConfigResult.RetryLater(null), map(401))
        assertEquals(DeviceConfigResult.RetryLater(30), map(429, retryAfter = "30"))
        assertEquals(DeviceConfigResult.RetryLater(null), map(429, retryAfter = "Wed, 21 Oct 2026 07:28:00 GMT"))
        for (status in listOf(500, 502, 503, 504, 599)) {
            assertEquals(DeviceConfigResult.RetryLater(null), map(status), "$status")
        }
        for (status in listOf(400, 403, 404, 301, 302, 204, 100)) {
            assertEquals(DeviceConfigResult.Rejected, map(status), "$status")
        }
    }

    @Test
    fun `results never print rule values`() {
        val fetched = map(200, body)
        assertEquals("Fetched", fetched.toString())
        assertEquals("NotModified", map(304).toString())
    }
}
