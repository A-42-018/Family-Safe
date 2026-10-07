package app.familysafe.child.data

import android.content.Context
import android.content.pm.PackageManager
import app.familysafe.child.domain.PermissionKey
import app.familysafe.child.domain.PermissionProbe

/**
 * Asks Android whether a permission is currently granted. `checkSelfPermission` never prompts and needs no
 * permission itself; anything not declared in the manifest simply reads as "not granted".
 *
 * SMS and call log are reported as not available: they are Play-restricted and this distribution (Track A) never
 * declares or asks for them (docs/ANDROID_PERMISSIONS.md).
 */
class AndroidPermissionProbe(context: Context) : PermissionProbe {
    private val context: Context = context.applicationContext

    override fun isAvailable(key: PermissionKey): Boolean = when (key) {
        PermissionKey.SMS, PermissionKey.CALL_LOG -> false
        PermissionKey.CAMERA -> hasFeature(PackageManager.FEATURE_CAMERA_ANY)
        PermissionKey.MICROPHONE -> hasFeature(PackageManager.FEATURE_MICROPHONE)
        PermissionKey.LOCATION, PermissionKey.PRECISE_LOCATION, PermissionKey.BACKGROUND_LOCATION ->
            hasFeature(PackageManager.FEATURE_LOCATION)
        else -> true
    }

    override fun isGranted(key: PermissionKey): Boolean = when (key) {
        PermissionKey.CAMERA -> granted("android.permission.CAMERA")
        PermissionKey.MICROPHONE -> granted("android.permission.RECORD_AUDIO")
        PermissionKey.CONTACTS -> granted("android.permission.READ_CONTACTS")
        PermissionKey.LOCATION ->
            granted("android.permission.ACCESS_FINE_LOCATION") || granted("android.permission.ACCESS_COARSE_LOCATION")
        PermissionKey.PRECISE_LOCATION -> granted("android.permission.ACCESS_FINE_LOCATION")
        // minSdk is 31, so this permission always exists.
        PermissionKey.BACKGROUND_LOCATION -> granted("android.permission.ACCESS_BACKGROUND_LOCATION")
        else -> false
    }

    private fun hasFeature(feature: String): Boolean = try {
        context.packageManager.hasSystemFeature(feature)
    } catch (_: Exception) {
        false
    }

    private fun granted(permission: String): Boolean =
        context.checkSelfPermission(permission) == PackageManager.PERMISSION_GRANTED
}
