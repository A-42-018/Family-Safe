package app.familysafe.child.data

import app.familysafe.child.domain.DeviceAuthState
import app.familysafe.child.testutil.MapSecureStore
import kotlinx.coroutines.CompletableDeferred
import kotlinx.coroutines.async
import kotlinx.coroutines.launch
import kotlinx.coroutines.test.advanceUntilIdle
import kotlinx.coroutines.test.runCurrent
import kotlinx.coroutines.test.runTest
import org.junit.jupiter.api.Assertions.assertEquals
import org.junit.jupiter.api.Assertions.assertFalse
import org.junit.jupiter.api.Assertions.assertInstanceOf
import org.junit.jupiter.api.Assertions.assertNull
import org.junit.jupiter.api.Test

class TokenProviderTest {
    private val device = "11111111-2222-3333-4444-555555555555"
    private val oldRefresh = "o".repeat(43)
    private var now = 1_000_000_000L
    private val thirtyDays = 30L * 24 * 3600 * 1000

    private class FakeApi : RefreshApi {
        val seen = mutableListOf<String>()
        val answers = ArrayDeque<RefreshOutcome>()
        var gate: CompletableDeferred<Unit>? = null
        var throwable: Throwable? = null

        override suspend fun refresh(refreshToken: String): RefreshOutcome {
            seen += refreshToken
            gate?.await()
            throwable?.let { throw it }
            return answers.removeFirst()
        }
    }

    private val store = MapSecureStore()
    private val creds = CredentialStore(store)
    private val api = FakeApi()

    init {
        creds.save(DeviceCredentials(device, oldRefresh, now + thirtyDays))
    }

    private fun provider() = TokenProvider(api, creds) { now }

    private fun refreshOf(n: Int) = "N$n".padEnd(43, 'x')

    private fun tokens(n: Int, deviceId: String = device, expiresIn: Int = 900) =
        RefreshedTokens(deviceId, "acc.ess.$n", expiresIn, refreshOf(n), now + thirtyDays)

    private fun ok(n: Int) = RefreshOutcome.Success(tokens(n))

    private fun fail(f: RefreshFailure) = RefreshOutcome.Failure(f)

    private fun AccessTokenResult.token(): String =
        assertInstanceOf(AccessTokenResult.Available::class.java, this).token

    private fun unavailable(reason: TokenUnavailable) = AccessTokenResult.Unavailable(reason)

    @Test
    fun `first call rotates, persists the new refresh token and then caches the access token`() = runTest {
        api.answers += ok(1)
        val p = provider()

        assertEquals("acc.ess.1", p.accessToken().token())
        assertEquals(refreshOf(1), creds.load()!!.refreshToken)
        assertEquals(DeviceAuthState.Connected, p.authState.value)

        assertEquals("acc.ess.1", p.accessToken().token())
        assertEquals(listOf(oldRefresh), api.seen)
    }

    @Test
    fun `the new access token is never exposed when the new refresh token cannot be saved`() = runTest {
        api.answers += ok(1)
        val p = provider()
        store.failPut = { it == "device_refresh_token" }

        assertEquals(unavailable(TokenUnavailable.Disconnected), p.accessToken())
        assertEquals(DeviceAuthState.Uncertain, p.authState.value)
        assertNull(creds.load())

        store.failPut = { false }
        assertEquals(unavailable(TokenUnavailable.Disconnected), p.accessToken())
        assertEquals(1, api.seen.size)
    }

    @Test
    fun `refreshes again with the ROTATED token once fewer than 60 seconds remain`() = runTest {
        api.answers += ok(1)
        api.answers += ok(2)
        val p = provider()
        p.accessToken()

        now += 900_000L - 61_000L
        assertEquals("acc.ess.1", p.accessToken().token())

        now += 2_000L
        assertEquals("acc.ess.2", p.accessToken().token())
        assertEquals(listOf(oldRefresh, refreshOf(1)), api.seen)
    }

    @Test
    fun `401 clears the credentials and remembers why across restarts`() = runTest {
        api.answers += fail(RefreshFailure.CredentialsRejected)
        val p = provider()

        assertEquals(unavailable(TokenUnavailable.Disconnected), p.accessToken())
        assertEquals(DeviceAuthState.Revoked, p.authState.value)
        assertNull(creds.load())

        assertEquals(unavailable(TokenUnavailable.Disconnected), p.accessToken())
        assertEquals(1, api.seen.size)
        assertEquals(DeviceAuthState.Revoked, provider().authState.value)
    }

    @Test
    fun `a locally expired refresh token disconnects without sending anything`() = runTest {
        now += thirtyDays + 1
        val p = provider()

        assertEquals(unavailable(TokenUnavailable.Disconnected), p.accessToken())
        assertEquals(DeviceAuthState.Expired, p.authState.value)
        assertEquals(emptyList<String>(), api.seen)
        assertNull(creds.load())
    }

    @Test
    fun `offline keeps the token and the same token may be retried`() = runTest {
        api.answers += fail(RefreshFailure.Unreachable)
        api.answers += ok(1)
        val p = provider()

        assertEquals(unavailable(TokenUnavailable.Retry(RetryReason.Offline)), p.accessToken())
        assertEquals(oldRefresh, creds.load()!!.refreshToken)
        assertEquals(DeviceAuthState.Unknown, p.authState.value)

        assertEquals("acc.ess.1", p.accessToken().token())
        assertEquals(listOf(oldRefresh, oldRefresh), api.seen)
    }

    @Test
    fun `rate limit, gateway outage and incompatibility keep the token`() = runTest {
        api.answers += fail(RefreshFailure.RateLimited(30))
        api.answers += fail(RefreshFailure.ServerUnavailable)
        api.answers += fail(RefreshFailure.Rejected)
        val p = provider()

        assertEquals(unavailable(TokenUnavailable.Retry(RetryReason.RateLimited, 30)), p.accessToken())
        assertEquals(unavailable(TokenUnavailable.Retry(RetryReason.ServerBusy)), p.accessToken())
        assertEquals(unavailable(TokenUnavailable.Retry(RetryReason.Incompatible)), p.accessToken())
        assertEquals(oldRefresh, creds.load()!!.refreshToken)
    }

    @Test
    fun `a lost answer clears the token instead of ever presenting it again`() = runTest {
        api.answers += fail(RefreshFailure.Uncertain)
        val p = provider()

        assertEquals(unavailable(TokenUnavailable.Disconnected), p.accessToken())
        assertEquals(DeviceAuthState.Uncertain, p.authState.value)
        assertNull(creds.load())
        p.accessToken()
        assertEquals(1, api.seen.size)
    }

    @Test
    fun `an unexpected exception from the api is treated as uncertain`() = runTest {
        api.throwable = IllegalStateException("boom")
        val p = provider()
        assertEquals(unavailable(TokenUnavailable.Disconnected), p.accessToken())
        assertEquals(DeviceAuthState.Uncertain, p.authState.value)
    }

    @Test
    fun `an answer for another device is discarded and disconnects`() = runTest {
        api.answers += RefreshOutcome.Success(tokens(1, deviceId = "99999999-2222-3333-4444-555555555555"))
        val p = provider()
        assertEquals(unavailable(TokenUnavailable.Disconnected), p.accessToken())
        assertEquals(DeviceAuthState.Uncertain, p.authState.value)
        assertNull(creds.load())
    }

    @Test
    fun `concurrent callers share one refresh`() = runTest {
        api.gate = CompletableDeferred()
        api.answers += ok(1)
        val p = provider()

        val a = async { p.accessToken() }
        val b = async { p.accessToken() }
        runCurrent()
        assertEquals(1, api.seen.size)

        api.gate!!.complete(Unit)
        assertEquals("acc.ess.1", a.await().token())
        assertEquals("acc.ess.1", b.await().token())
        assertEquals(1, api.seen.size)
    }

    @Test
    fun `a caller that gives up mid-request still leaves the rotated token saved`() = runTest {
        api.gate = CompletableDeferred()
        api.answers += ok(1)
        val p = provider()

        val job = launch { p.accessToken() }
        runCurrent()
        job.cancel()
        api.gate!!.complete(Unit)
        advanceUntilIdle()

        assertEquals(refreshOf(1), creds.load()!!.refreshToken)
        assertEquals(DeviceAuthState.Connected, p.authState.value)
    }

    @Test
    fun `after a 401 a token another caller already replaced is reused without a request`() = runTest {
        api.answers += ok(1)
        val p = provider()
        p.accessToken()

        assertEquals("acc.ess.1", p.refreshAfterUnauthorized("acc.ess.stale").token())
        assertEquals(1, api.seen.size)
    }

    @Test
    fun `after a 401 on the current token it refreshes once with the rotated refresh token`() = runTest {
        api.answers += ok(1)
        api.answers += ok(2)
        val p = provider()
        p.accessToken()

        assertEquals("acc.ess.2", p.refreshAfterUnauthorized("acc.ess.1").token())
        assertEquals(listOf(oldRefresh, refreshOf(1)), api.seen)
    }

    @Test
    fun `a discarded token forces the next call to refresh`() = runTest {
        api.answers += ok(1)
        api.answers += fail(RefreshFailure.CredentialsRejected)
        val p = provider()
        p.accessToken()

        p.discard("acc.ess.1")
        assertEquals(unavailable(TokenUnavailable.Disconnected), p.accessToken())
        assertEquals(DeviceAuthState.Revoked, p.authState.value)
    }

    @Test
    fun `unreadable storage is a retry and changes nothing`() = runTest {
        val p = provider()
        store.failGet = true
        assertEquals(unavailable(TokenUnavailable.Retry(RetryReason.StorageUnavailable)), p.accessToken())
        assertEquals(emptyList<String>(), api.seen)
        assertEquals(DeviceAuthState.Unknown, p.authState.value)
    }

    @Test
    fun `a device that never enrolled is not enrolled and sends nothing`() = runTest {
        creds.clear()
        val p = provider()
        assertEquals(unavailable(TokenUnavailable.NotEnrolled), p.accessToken())
        assertEquals(emptyList<String>(), api.seen)
    }

    @Test
    fun `enrolling again resets the remembered disconnect`() = runTest {
        api.answers += fail(RefreshFailure.CredentialsRejected)
        val p = provider()
        p.accessToken()
        assertEquals(DeviceAuthState.Revoked, p.authState.value)

        creds.save(DeviceCredentials(device, refreshOf(7), now + thirtyDays))
        p.onEnrolled()
        assertEquals(DeviceAuthState.Unknown, p.authState.value)
        assertEquals(DeviceAuthState.Unknown, provider().authState.value)
    }

    @Test
    fun `nothing printable contains token material`() = runTest {
        api.answers += ok(1)
        val p = provider()
        val result = p.accessToken()
        assertFalse(result.toString().contains("acc.ess"))
        assertFalse(p.authState.value.toString().contains("acc"))
    }
}
