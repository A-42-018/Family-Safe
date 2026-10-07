package app.familysafe.child.data

import app.familysafe.child.domain.AppInventoryLimits
import app.familysafe.child.domain.AppInventorySanitizer
import app.familysafe.child.domain.InstalledApp
import kotlin.coroutines.cancellation.CancellationException

/**
 * Sends one app-inventory upload through [DeviceHttp] (the only code that adds a bearer token). The raw reading
 * is sanitized here, before anything is encoded, so the request always satisfies the contract. A full replace is
 * idempotent on the server, so ANY network failure is simply "try again later". Nothing here logs.
 */
class AppInventoryRepository(private val http: DeviceHttp) {
    suspend fun send(raw: List<InstalledApp>): AppInventoryResult {
        val inventory = AppInventorySanitizer.sanitize(raw)
        // An empty reading means the read failed (a phone always has a launcher); never wipe the parent's list.
        if (inventory.apps.isEmpty()) return AppInventoryResult.Rejected
        val body = AppInventoryWire.encode(
            AppInventoryRequestDto(
                inventory.apps.map { AppInventoryEntryDto(it.packageName, it.label, it.versionName, it.isSystem) },
            ),
        )
        // Sized for the Edge limit; with 500 capped entries this cannot trigger, it guards future field growth.
        if (body.toByteArray(Charsets.UTF_8).size > AppInventoryLimits.MAX_BODY_BYTES) {
            return AppInventoryResult.Rejected
        }
        val outcome = try {
            http.postJson(ENDPOINT, body)
        } catch (e: CancellationException) {
            throw e
        } catch (_: Exception) {
            return AppInventoryResult.RetryLater()
        }
        return when (outcome) {
            is AuthedOutcome.Completed -> {
                val response = outcome.response
                AppInventoryHttpMapper.map(response.status, response.retryAfterHeader, response.body, inventory)
            }
            is AuthedOutcome.NoToken -> when (val reason = outcome.reason) {
                TokenUnavailable.NotEnrolled -> AppInventoryResult.NotEnrolled
                TokenUnavailable.Disconnected -> AppInventoryResult.Disconnected
                is TokenUnavailable.Retry -> AppInventoryResult.RetryLater(reason.retryAfterSeconds)
            }
        }
    }

    companion object {
        const val ENDPOINT = "device-apps"
    }
}
