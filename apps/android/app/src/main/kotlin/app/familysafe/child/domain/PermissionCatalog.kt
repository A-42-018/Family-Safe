package app.familysafe.child.domain

/** Mirrors the CHECK list on `device_permissions.*_status` in the database (packages/contracts `PERMISSION_STATES`). */
enum class PermissionState { GRANTED, DENIED, REVOKED, RESTRICTED, NOT_AVAILABLE, NOT_REQUESTED }

/**
 * Every permission the app may ever ask for. [wireName] is the key of `permissionSyncRequestSchema` for the eight
 * permissions whose on/off state is shared with the parent; `null` = stays on this device (a JVM test compares the
 * wire names with `packages/contracts/src/permissions.ts`). Phase 9 requests none of them; each later phase flips
 * its own.
 */
enum class PermissionKey(val wireName: String?) {
    LOCATION("location"),
    PRECISE_LOCATION("precise_location"),
    BACKGROUND_LOCATION("background_location"),
    CAMERA("camera"),
    MICROPHONE("microphone"),
    CONTACTS("contacts"),
    SMS("sms"),
    CALL_LOG("call_log"),
    USAGE_ACCESS(null),
    APP_LIST(null),
    NOTIFICATIONS(null),
}

data class PermissionEntry(val key: PermissionKey, val state: PermissionState)

object PermissionCatalog {
    /** The keys that are synced, in the contract's order (camera first). */
    val SYNCED: List<PermissionKey> = listOf(
        PermissionKey.CAMERA,
        PermissionKey.MICROPHONE,
        PermissionKey.CONTACTS,
        PermissionKey.SMS,
        PermissionKey.CALL_LOG,
        PermissionKey.LOCATION,
        PermissionKey.PRECISE_LOCATION,
        PermissionKey.BACKGROUND_LOCATION,
    )

    /** Before the first OS reading nothing has been requested. */
    fun initial(): List<PermissionEntry> =
        PermissionKey.entries.map { PermissionEntry(it, PermissionState.NOT_REQUESTED) }
}
