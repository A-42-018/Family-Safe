package app.familysafe.child.ui.devicestatus

import androidx.compose.foundation.clickable
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.padding
import androidx.compose.material3.HorizontalDivider
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.Text
import androidx.compose.material3.TextButton
import androidx.compose.runtime.Composable
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.remember
import androidx.compose.runtime.saveable.rememberSaveable
import androidx.compose.runtime.setValue
import androidx.compose.ui.Modifier
import androidx.compose.ui.res.stringResource
import androidx.compose.ui.unit.dp
import app.familysafe.child.R
import app.familysafe.child.domain.AppInventoryReport
import app.familysafe.child.domain.AppRuleLabels
import app.familysafe.child.domain.AppRuleLevel
import app.familysafe.child.domain.AppRuleStatus
import app.familysafe.child.domain.CachedScreenTimeConfig
import app.familysafe.child.domain.ConfigFreshness
import app.familysafe.child.domain.DeviceAuthState
import app.familysafe.child.domain.DeviceInfoReport
import app.familysafe.child.domain.InstalledApp
import app.familysafe.child.domain.LimitLevel
import app.familysafe.child.domain.LimitStatus
import app.familysafe.child.domain.ScheduleStatus
import app.familysafe.child.domain.UsageDisplay
import app.familysafe.child.domain.UsageReport
import app.familysafe.child.ui.common.DisconnectedNotice
import app.familysafe.child.ui.common.NotEnrolledNotice
import app.familysafe.child.ui.common.ScreenBody
import app.familysafe.child.ui.common.ScreenScaffold
import app.familysafe.child.ui.common.minutesText
import app.familysafe.child.ui.navigation.Destination
import java.text.DateFormat
import java.util.Date

@Composable
fun DeviceStatusScreen(
    isEnrolled: Boolean,
    auth: DeviceAuthState,
    deviceInfo: DeviceInfoReport?,
    appInventory: AppInventoryReport?,
    usage: UsageReport?,
    screenTime: CachedScreenTimeConfig?,
    limit: LimitStatus,
    appRules: AppRuleStatus,
    schedules: ScheduleStatus,
    onOpen: (Destination) -> Unit,
) {
    ScreenScaffold(stringResource(R.string.title_device_status), onBack = null) { padding ->
        ScreenBody(padding) {
            if (!isEnrolled) {
                if (auth.isDisconnected) DisconnectedNotice(auth) else NotEnrolledNotice()
            }
            Text(
                stringResource(
                    if (isEnrolled) R.string.device_status_summary_enrolled else R.string.device_status_summary,
                ),
                style = MaterialTheme.typography.bodyMedium,
            )
            if (isEnrolled) {
                HorizontalDivider()
                SharedDetails(deviceInfo)
                HorizontalDivider()
                SharedApps(appInventory)
                HorizontalDivider()
                SharedUsage(usage)
                HorizontalDivider()
                TodayLimit(limit)
                HorizontalDivider()
                ParentRules(screenTime)
                HorizontalDivider()
                AppRules(appRules, appInventory)
                HorizontalDivider()
                ParentSchedules(screenTime, schedules)
            }
            HorizontalDivider()
            Text(stringResource(R.string.device_status_menu_header), style = MaterialTheme.typography.titleSmall)
            Destination.secondary.forEach { destination ->
                Text(
                    text = stringResource(titleOf(destination)),
                    style = MaterialTheme.typography.bodyLarge,
                    modifier = Modifier.clickable { onOpen(destination) }.padding(vertical = 12.dp),
                )
            }
        }
    }
}

fun titleOf(destination: Destination): Int = when (destination) {
    Destination.DeviceStatus -> R.string.title_device_status
    Destination.Permissions -> R.string.title_permissions
    Destination.Enrollment -> R.string.title_enrollment
    Destination.SyncStatus -> R.string.title_sync_status
    Destination.Safety -> R.string.title_safety
    Destination.About -> R.string.title_about
}

@Composable
private fun SharedDetails(report: DeviceInfoReport?) {
    Text(stringResource(R.string.device_info_header), style = MaterialTheme.typography.titleSmall)
    Text(stringResource(R.string.device_info_intro), style = MaterialTheme.typography.bodyMedium)
    if (report == null) {
        Text(stringResource(R.string.device_info_not_sent), style = MaterialTheme.typography.labelLarge)
        return
    }
    val details = report.details
    Text(
        stringResource(R.string.device_info_api_level, details.sdkLevel),
        style = MaterialTheme.typography.bodyMedium,
    )
    Text(
        details.securityPatch?.let { stringResource(R.string.device_info_patch, it) }
            ?: stringResource(R.string.device_info_patch_unknown),
        style = MaterialTheme.typography.bodyMedium,
    )
    val total = details.storageTotalMb
    val free = details.storageFreeMb
    Text(
        if (total != null && free != null) {
            stringResource(
                R.string.device_info_storage,
                DeviceInfoFormat.gigabytes(free),
                DeviceInfoFormat.gigabytes(total),
            )
        } else {
            stringResource(R.string.device_info_storage_unknown)
        },
        style = MaterialTheme.typography.bodyMedium,
    )
    Text(
        stringResource(
            R.string.device_info_sent_at,
            DateFormat.getDateTimeInstance(DateFormat.MEDIUM, DateFormat.SHORT).format(Date(report.sentAtEpochMillis)),
        ),
        style = MaterialTheme.typography.labelLarge,
    )
}

@Composable
private fun SharedApps(report: AppInventoryReport?) {
    Text(stringResource(R.string.app_inventory_header), style = MaterialTheme.typography.titleSmall)
    Text(stringResource(R.string.app_inventory_intro), style = MaterialTheme.typography.bodyMedium)
    if (report == null) {
        Text(stringResource(R.string.app_inventory_not_sent), style = MaterialTheme.typography.labelLarge)
        return
    }
    val inventory = report.inventory
    Text(
        stringResource(R.string.app_inventory_count, inventory.apps.size),
        style = MaterialTheme.typography.bodyMedium,
    )
    if (inventory.omittedCount > 0) {
        Text(
            stringResource(R.string.app_inventory_omitted, inventory.omittedCount),
            style = MaterialTheme.typography.bodyMedium,
        )
    }
    // Up to 500 rows: collapsed by default so the screen stays light; the child can open the full list.
    var expanded by rememberSaveable { mutableStateOf(false) }
    val sorted = remember(inventory) { AppInventoryFormat.byName(inventory.apps) }
    TextButton(onClick = { expanded = !expanded }) {
        Text(stringResource(if (expanded) R.string.app_inventory_hide else R.string.app_inventory_show))
    }
    if (expanded) {
        sorted.forEach { app -> AppRow(app) }
    }
    Text(
        stringResource(
            R.string.app_inventory_sent_at,
            DateFormat.getDateTimeInstance(DateFormat.MEDIUM, DateFormat.SHORT).format(Date(report.sentAtEpochMillis)),
        ),
        style = MaterialTheme.typography.labelLarge,
    )
}

@Composable
private fun AppRow(app: InstalledApp) {
    Column {
        Text(app.label, style = MaterialTheme.typography.bodyLarge)
        val version = app.versionName.orEmpty()
        Text(
            when (AppInventoryFormat.detailOf(app)) {
                AppRowDetail.Plain -> app.packageName
                AppRowDetail.Version -> stringResource(R.string.app_inventory_row_version, app.packageName, version)
                AppRowDetail.System -> stringResource(R.string.app_inventory_row_system, app.packageName)
                AppRowDetail.VersionAndSystem ->
                    stringResource(R.string.app_inventory_row_system_version, app.packageName, version)
            },
            style = MaterialTheme.typography.bodySmall,
        )
    }
}

@Composable
private fun SharedUsage(report: UsageReport?) {
    Text(stringResource(R.string.usage_header), style = MaterialTheme.typography.titleSmall)
    Text(stringResource(R.string.usage_intro), style = MaterialTheme.typography.bodyMedium)
    if (report == null) {
        Text(stringResource(R.string.usage_not_sent), style = MaterialTheme.typography.labelLarge)
        return
    }
    val usage = report.usage
    Text(stringResource(R.string.usage_day, usage.day), style = MaterialTheme.typography.bodyMedium)
    Text(screenOnText(usage.totalScreenMinutes), style = MaterialTheme.typography.bodyMedium)
    Text(stringResource(R.string.usage_unlocks, usage.unlockCount), style = MaterialTheme.typography.bodyMedium)
    Text(stringResource(R.string.usage_apps_count, usage.apps.size), style = MaterialTheme.typography.bodyMedium)
    val top = remember(usage) { UsageDisplay.topApps(usage.apps) }
    if (top.isNotEmpty()) {
        Text(stringResource(R.string.usage_top_header), style = MaterialTheme.typography.labelLarge)
        top.forEach { app ->
            val (hours, minutes) = UsageDisplay.hoursAndMinutes(app.foregroundMinutes)
            Text(
                if (hours > 0) {
                    stringResource(R.string.usage_app_row_hm, app.packageName, hours, minutes, app.launchCount)
                } else {
                    stringResource(R.string.usage_app_row_m, app.packageName, minutes, app.launchCount)
                },
                style = MaterialTheme.typography.bodySmall,
            )
        }
    }
    if (usage.omittedCount > 0) {
        Text(
            stringResource(R.string.usage_omitted, usage.omittedCount),
            style = MaterialTheme.typography.bodyMedium,
        )
    }
    Text(
        stringResource(
            R.string.usage_sent_at,
            DateFormat.getDateTimeInstance(DateFormat.MEDIUM, DateFormat.SHORT).format(Date(report.sentAtEpochMillis)),
        ),
        style = MaterialTheme.typography.labelLarge,
    )
}

@Composable
private fun TodayLimit(limit: LimitStatus) {
    Text(stringResource(R.string.limit_header), style = MaterialTheme.typography.titleSmall)
    when (limit) {
        LimitStatus.Unchecked ->
            Text(stringResource(R.string.limit_checking), style = MaterialTheme.typography.labelLarge)
        is LimitStatus.Inactive -> Text(
            stringResource(LimitStatusFormat.inactiveMessage(limit.reason)),
            style = MaterialTheme.typography.bodyMedium,
        )
        is LimitStatus.Active -> {
            val evaluation = limit.evaluation
            if (evaluation.noScreenTimeToday) {
                Text(stringResource(R.string.limit_no_screen_time), style = MaterialTheme.typography.bodyMedium)
            } else {
                Text(
                    stringResource(
                        R.string.limit_used_of,
                        minutesText(evaluation.usedMinutes),
                        minutesText(evaluation.limitMinutes),
                    ),
                    style = MaterialTheme.typography.bodyMedium,
                )
                if (evaluation.level != LimitLevel.LIMIT) {
                    Text(
                        stringResource(R.string.limit_remaining, minutesText(evaluation.remainingMinutes)),
                        style = MaterialTheme.typography.bodyMedium,
                    )
                }
            }
            Text(
                stringResource(LimitStatusFormat.levelMessage(evaluation.level)),
                style = MaterialTheme.typography.labelLarge,
            )
            if (limit.rulesStale) {
                Text(stringResource(R.string.rules_stale), style = MaterialTheme.typography.bodyMedium)
            }
        }
    }
    Text(stringResource(R.string.limit_check_note), style = MaterialTheme.typography.bodySmall)
}

@Composable
private fun ParentRules(cached: CachedScreenTimeConfig?) {
    Text(stringResource(R.string.rules_header), style = MaterialTheme.typography.titleSmall)
    Text(stringResource(R.string.rules_intro), style = MaterialTheme.typography.bodyMedium)
    if (cached == null) {
        Text(stringResource(R.string.rules_none_yet), style = MaterialTheme.typography.labelLarge)
        return
    }
    val now = System.currentTimeMillis()
    val config = cached.config
    when (cached.freshness(now)) {
        ConfigFreshness.FRESH -> Unit
        ConfigFreshness.STALE ->
            Text(stringResource(R.string.rules_stale), style = MaterialTheme.typography.bodyMedium)
        ConfigFreshness.EXPIRED ->
            Text(stringResource(R.string.rules_expired), style = MaterialTheme.typography.bodyMedium)
    }
    if (!config.hasAnyLimit) {
        Text(stringResource(R.string.rules_no_limit), style = MaterialTheme.typography.bodyMedium)
    } else {
        ScreenTimeFormat.plan(config).forEach { line ->
            val limit = line.minutes?.let { minutesText(it) } ?: stringResource(R.string.rules_limit_none)
            Text(
                if (line.dayName == null) {
                    stringResource(R.string.rules_every_day, limit)
                } else {
                    stringResource(R.string.rules_day_row, line.dayName, limit)
                },
                style = MaterialTheme.typography.bodyMedium,
            )
        }
    }
    Text(stringResource(R.string.rules_applies_note), style = MaterialTheme.typography.bodyMedium)
    Text(
        stringResource(
            R.string.rules_checked_at,
            DateFormat.getDateTimeInstance(DateFormat.MEDIUM, DateFormat.SHORT)
                .format(Date(cached.validatedAtEpochMillis)),
        ),
        style = MaterialTheme.typography.labelLarge,
    )
}

@Composable
private fun screenOnText(totalMinutes: Int): String {
    val (hours, minutes) = UsageDisplay.hoursAndMinutes(totalMinutes)
    return if (hours > 0) {
        stringResource(R.string.usage_total_hm, hours, minutes)
    } else {
        stringResource(R.string.usage_total_m, minutes)
    }
}

@Composable
private fun AppRules(status: AppRuleStatus, inventory: AppInventoryReport?) {
    Text(stringResource(R.string.app_rules_header), style = MaterialTheme.typography.titleSmall)
    Text(stringResource(R.string.app_rules_intro), style = MaterialTheme.typography.bodyMedium)
    when (status) {
        AppRuleStatus.Unchecked ->
            Text(stringResource(R.string.app_rules_checking), style = MaterialTheme.typography.labelLarge)
        is AppRuleStatus.Inactive -> Text(
            stringResource(AppRuleStatusFormat.inactiveMessage(status.reason)),
            style = MaterialTheme.typography.bodyMedium,
        )
        is AppRuleStatus.Active -> {
            status.entries.forEach { entry ->
                val label = AppRuleLabels.labelFor(entry.packageName, inventory)
                val limit = entry.limitMinutes
                Text(
                    if (entry.level == AppRuleLevel.BLOCKED || limit == null) {
                        stringResource(R.string.app_rules_row_blocked, label)
                    } else {
                        stringResource(
                            R.string.app_rules_row_limit,
                            label,
                            minutesText(limit),
                            minutesText(entry.usedMinutes),
                        )
                    },
                    style = MaterialTheme.typography.bodyMedium,
                )
                Text(
                    stringResource(AppRuleStatusFormat.levelMessage(entry.level)),
                    style = MaterialTheme.typography.bodySmall,
                )
            }
            if (status.rulesStale) {
                Text(stringResource(R.string.rules_stale), style = MaterialTheme.typography.bodyMedium)
            }
        }
    }
    Text(stringResource(R.string.app_rules_note), style = MaterialTheme.typography.bodySmall)
}

@Composable
private fun ParentSchedules(cached: CachedScreenTimeConfig?, status: ScheduleStatus) {
    Text(stringResource(R.string.schedules_header), style = MaterialTheme.typography.titleSmall)
    Text(stringResource(R.string.schedules_intro), style = MaterialTheme.typography.bodyMedium)
    when (status) {
        is ScheduleStatus.Unchecked ->
            Text(stringResource(R.string.schedules_unchecked), style = MaterialTheme.typography.labelLarge)
        is ScheduleStatus.Inactive ->
            Text(
                stringResource(ScheduleFormat.inactiveMessage(status.reason)),
                style = MaterialTheme.typography.bodyMedium,
            )
        is ScheduleStatus.Active -> {
            cached?.config?.schedules?.forEach { window ->
                val days = if (ScheduleFormat.isEveryDay(window.days)) {
                    stringResource(R.string.schedules_every_day)
                } else {
                    ScheduleFormat.daysText(window.days)
                }
                Text(
                    stringResource(
                        R.string.schedules_row,
                        stringResource(ScheduleFormat.typeTitle(window.type)),
                        window.name,
                        days,
                        ScheduleFormat.clock(window.startMinute),
                        ScheduleFormat.clock(window.endMinute),
                    ),
                    style = MaterialTheme.typography.bodyMedium,
                )
            }
            val activeNames = status.active.map { stringResource(ScheduleFormat.typeTitle(it.window.type)) }
            Text(
                if (status.isQuiet) {
                    stringResource(R.string.schedules_now, activeNames.joinToString(", "))
                } else {
                    stringResource(R.string.schedules_none_now)
                },
                style = MaterialTheme.typography.bodyMedium,
            )
            status.nextBoundaryEpochMillis?.let {
                Text(
                    stringResource(
                        R.string.schedules_next,
                        DateFormat.getDateTimeInstance(DateFormat.MEDIUM, DateFormat.SHORT).format(Date(it)),
                    ),
                    style = MaterialTheme.typography.bodyMedium,
                )
            }
            Text(
                stringResource(
                    if (status.parentZone) R.string.schedules_zone_parent else R.string.schedules_zone_phone,
                    status.zoneId,
                ),
                style = MaterialTheme.typography.labelLarge,
            )
            if (status.rulesStale) {
                Text(stringResource(R.string.rules_stale), style = MaterialTheme.typography.labelLarge)
            }
        }
    }
}
