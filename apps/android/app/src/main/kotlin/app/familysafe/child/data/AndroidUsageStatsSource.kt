package app.familysafe.child.data

import android.app.AppOpsManager
import android.app.usage.UsageEvents
import android.app.usage.UsageStatsManager
import android.content.Context
import android.content.pm.PackageManager
import android.os.Process
import app.familysafe.child.domain.UsageAccess
import app.familysafe.child.domain.UsageAccessProbe
import app.familysafe.child.domain.UsageEvent
import app.familysafe.child.domain.UsageEventKind
import app.familysafe.child.domain.UsageEventsSource

/**
 * Reads Android's own usage events for one time window with `UsageStatsManager.queryEvents`. It works only while
 * the child has switched on Usage Access for this app in system settings; this class never grants or requests it.
 * Only event type, package name and time are kept; no class names, no shortcut or notification events, no content.
 * The `UsageEvents.Event` constants used here exist from API 29 (`SCREEN_*`, `KEYGUARD_*` since API 28); minSdk is 31.
 */
class AndroidUsageStatsSource(context: Context) : UsageEventsSource {
    private val context: Context = context.applicationContext

    override fun events(windowStartMillis: Long, windowEndMillis: Long): List<UsageEvent> {
        val manager = context.getSystemService(Context.USAGE_STATS_SERVICE) as UsageStatsManager
        val raw = manager.queryEvents(windowStartMillis, windowEndMillis)
        val out = ArrayList<UsageEvent>()
        val event = UsageEvents.Event()
        while (raw.hasNextEvent()) {
            raw.getNextEvent(event)
            val kind = kindOf(event.eventType) ?: continue
            val usesPackage = kind == UsageEventKind.FOREGROUND || kind == UsageEventKind.BACKGROUND
            out += UsageEvent(kind, if (usesPackage) event.packageName else null, event.timeStamp)
        }
        return out
    }

    private fun kindOf(type: Int): UsageEventKind? = when (type) {
        UsageEvents.Event.ACTIVITY_RESUMED -> UsageEventKind.FOREGROUND
        UsageEvents.Event.ACTIVITY_PAUSED -> UsageEventKind.BACKGROUND
        UsageEvents.Event.SCREEN_INTERACTIVE -> UsageEventKind.SCREEN_ON
        UsageEvents.Event.SCREEN_NON_INTERACTIVE -> UsageEventKind.SCREEN_OFF
        UsageEvents.Event.KEYGUARD_HIDDEN -> UsageEventKind.UNLOCK
        else -> null
    }
}

/**
 * Asks Android whether Usage Access is switched on for this app. `AppOpsManager` answers without any prompt and
 * without any permission of its own. Anything unexpected reads as [UsageAccess.UNKNOWN], never as granted.
 */
class AndroidUsageAccessProbe(context: Context) : UsageAccessProbe {
    private val context: Context = context.applicationContext

    override fun state(): UsageAccess = try {
        val ops = context.getSystemService(Context.APP_OPS_SERVICE) as AppOpsManager
        val mode = ops.unsafeCheckOpNoThrow(AppOpsManager.OPSTR_GET_USAGE_STATS, Process.myUid(), context.packageName)
        // MODE_DEFAULT means "ask the permission system"; the special-access toggle in settings sets MODE_ALLOWED.
        val allowed = if (mode == AppOpsManager.MODE_DEFAULT) {
            context.checkCallingOrSelfPermission("android.permission.PACKAGE_USAGE_STATS") ==
                PackageManager.PERMISSION_GRANTED
        } else {
            mode == AppOpsManager.MODE_ALLOWED
        }
        if (allowed) UsageAccess.GRANTED else UsageAccess.NOT_GRANTED
    } catch (_: Exception) {
        UsageAccess.UNKNOWN
    }
}
