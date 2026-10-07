package app.familysafe.child.admin

import android.app.admin.DeviceAdminReceiver

/**
 * Lets Android make FamilySafe the Device Owner of a device the family set up for it (see `ANDROID_PERMISSIONS.md`,
 * "Track B decision"). It has no logic: it never reacts to anything, never hides the app and never blocks removal.
 * The only thing Track B does with it is [app.familysafe.child.data.AndroidPackageSuspender].
 */
class FamilySafeAdminReceiver : DeviceAdminReceiver()
