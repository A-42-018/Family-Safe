package app.familysafe.child.ui.permissions

import android.content.ActivityNotFoundException
import android.content.Context
import android.content.Intent
import android.provider.Settings

/**
 * Opens Android's own Usage Access list. This is the only way Usage Access is ever switched on: the child does it
 * there. The app cannot grant it, and opening the page shows no prompt and changes nothing by itself.
 */
object UsageAccessSettings {
    fun intent(): Intent = Intent(Settings.ACTION_USAGE_ACCESS_SETTINGS)

    /** Returns false when the device has no such settings page (some managed or stripped builds). */
    fun open(context: Context): Boolean = try {
        context.startActivity(intent().addFlags(Intent.FLAG_ACTIVITY_NEW_TASK))
        true
    } catch (_: ActivityNotFoundException) {
        false
    }
}
