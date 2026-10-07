package app.familysafe.child.data

import android.app.admin.DevicePolicyManager
import android.content.ComponentName
import android.content.Context
import android.content.pm.PackageManager
import app.familysafe.child.admin.FamilySafeAdminReceiver
import app.familysafe.child.domain.ManagedModeDetector
import app.familysafe.child.domain.ManagedModeState
import app.familysafe.child.domain.PackageSuspender

/** Asks Android whether this app is the Device Owner. Needs no permission. */
class AndroidManagedModeDetector(private val context: Context) : ManagedModeDetector {
    override fun state(): ManagedModeState {
        val dpm = context.getSystemService(DevicePolicyManager::class.java) ?: return ManagedModeState.NOT_MANAGED
        return try {
            if (dpm.isDeviceOwnerApp(
                    context.packageName,
                )
            ) {
                ManagedModeState.DEVICE_OWNER
            } else {
                ManagedModeState.NOT_MANAGED
            }
        } catch (_: RuntimeException) {
            ManagedModeState.NOT_MANAGED
        }
    }
}

/**
 * The only place that calls `setPackagesSuspended`. Works only while this app is the Device Owner; otherwise Android
 * throws and every package counts as refused. The pause is visible to the child (Android shows a system dialog when
 * a paused app is opened) and reversible.
 */
class AndroidPackageSuspender(private val context: Context) : PackageSuspender {
    private val admin = ComponentName(context, FamilySafeAdminReceiver::class.java)

    private fun policy(): DevicePolicyManager? = context.getSystemService(DevicePolicyManager::class.java)

    override fun setSuspended(packages: Set<String>, suspended: Boolean): Set<String> {
        if (packages.isEmpty()) return emptySet()
        val dpm = policy() ?: return packages
        return try {
            dpm.setPackagesSuspended(admin, packages.toTypedArray(), suspended).toSet()
        } catch (_: SecurityException) {
            packages
        } catch (_: RuntimeException) {
            packages
        }
    }

    override fun isSuspended(packageName: String): Boolean? {
        val dpm = policy() ?: return null
        return try {
            dpm.isPackageSuspended(admin, packageName)
        } catch (_: PackageManager.NameNotFoundException) {
            null
        } catch (_: SecurityException) {
            null
        }
    }
}
