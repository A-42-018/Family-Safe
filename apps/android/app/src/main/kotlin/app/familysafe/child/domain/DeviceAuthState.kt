package app.familysafe.child.domain

/**
 * What this device knows about its own server-side credential.
 *
 * - [Unknown]: nothing has been checked yet in this process (e.g. right after start-up or right after enrolling).
 * - [Connected]: the last refresh succeeded.
 * - [Revoked]: the server answered 401 to the refresh token (revoked, replaced, reused or unknown).
 * - [Expired]: the refresh token's own expiry passed while the device was away; nothing was sent.
 * - [Uncertain]: a refresh may have been processed but the answer never arrived (or could not be saved), so the old
 *   token must not be presented again.
 * The last three mean "disconnected": local credentials are gone and the child must be paired again.
 */
enum class DeviceAuthState {
    Unknown,
    Connected,
    Revoked,
    Expired,
    Uncertain,
    ;

    val isDisconnected: Boolean get() = this == Revoked || this == Expired || this == Uncertain
}
