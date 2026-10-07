package app.familysafe.child.data

import android.content.Context
import android.content.Intent
import android.content.pm.ApplicationInfo
import android.content.pm.PackageManager
import android.content.pm.ResolveInfo
import android.os.Build
import app.familysafe.child.domain.InstalledApp
import app.familysafe.child.domain.InstalledAppsSource

/**
 * Reads the apps that have a launcher entry (what the child sees on the home screen) with `PackageManager`. It
 * needs no permission: the manifest `<queries>` element declares the launcher intent, which is the narrow,
 * Play-compliant alternative to the broad "see all apps" permission. Only package name, label, version name and
 * the system flag are read. No icons, install times, signing data or usage. The `Flags` overloads exist from
 * API 33; minSdk is 31, so older releases use the int overloads (deprecated, same behaviour).
 */
class AndroidInstalledAppsSource(private val context: Context) : InstalledAppsSource {
    override fun current(): List<InstalledApp> {
        val pm = context.packageManager
        val launcher = Intent(Intent.ACTION_MAIN).addCategory(Intent.CATEGORY_LAUNCHER)
        val activities = launcherActivities(pm, launcher)
        val seen = HashSet<String>()
        val apps = ArrayList<InstalledApp>(activities.size)
        for (info in activities) {
            val app = info.activityInfo?.applicationInfo ?: continue
            if (!seen.add(app.packageName)) continue
            apps += InstalledApp(
                packageName = app.packageName,
                label = labelOf(pm, info, app),
                versionName = versionOf(pm, app.packageName),
                isSystem = (app.flags and ApplicationInfo.FLAG_SYSTEM) != 0,
            )
        }
        return apps
    }

    private fun launcherActivities(pm: PackageManager, launcher: Intent): List<ResolveInfo> =
        if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.TIRAMISU) {
            pm.queryIntentActivities(launcher, PackageManager.ResolveInfoFlags.of(0L))
        } else {
            @Suppress("DEPRECATION")
            pm.queryIntentActivities(launcher, 0)
        }

    private fun labelOf(pm: PackageManager, info: ResolveInfo, app: ApplicationInfo): String = try {
        info.loadLabel(pm).toString()
    } catch (_: Exception) {
        app.packageName
    }

    private fun versionOf(pm: PackageManager, packageName: String): String? = try {
        if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.TIRAMISU) {
            pm.getPackageInfo(packageName, PackageManager.PackageInfoFlags.of(0L)).versionName
        } else {
            @Suppress("DEPRECATION")
            pm.getPackageInfo(packageName, 0).versionName
        }
    } catch (_: Exception) {
        null
    }
}
