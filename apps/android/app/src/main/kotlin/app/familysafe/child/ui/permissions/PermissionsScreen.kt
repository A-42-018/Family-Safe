package app.familysafe.child.ui.permissions

import androidx.compose.material3.HorizontalDivider
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.OutlinedButton
import androidx.compose.material3.Text
import androidx.compose.runtime.Composable
import androidx.compose.ui.res.stringResource
import app.familysafe.child.R
import app.familysafe.child.domain.PermissionEntry
import app.familysafe.child.domain.PermissionKey
import app.familysafe.child.domain.PermissionState
import app.familysafe.child.domain.UsageAccess
import app.familysafe.child.domain.UsageDisplay
import app.familysafe.child.ui.common.ScreenBody
import app.familysafe.child.ui.common.ScreenScaffold
import java.text.DateFormat
import java.util.Date

@Composable
fun PermissionsScreen(
    isEnrolled: Boolean,
    entries: List<PermissionEntry>,
    sharedAtEpochMillis: Long?,
    usageAccess: UsageAccess,
    onOpenUsageAccessSettings: () -> Unit,
    onBack: () -> Unit,
) {
    ScreenScaffold(stringResource(R.string.title_permissions), onBack) { padding ->
        ScreenBody(padding) {
            Text(stringResource(R.string.permissions_intro), style = MaterialTheme.typography.bodyMedium)
            Text(sharedText(isEnrolled, sharedAtEpochMillis), style = MaterialTheme.typography.labelLarge)
            // The Usage Access row shows the live reading (it is a settings switch, not a runtime permission).
            UsageDisplay.withUsageAccess(entries, usageAccess).forEach { entry ->
                Text(stringResource(nameOf(entry.key)), style = MaterialTheme.typography.titleSmall)
                Text(stringResource(whyOf(entry.key)), style = MaterialTheme.typography.bodyMedium)
                Text(stringResource(statusOf(entry.state)), style = MaterialTheme.typography.labelMedium)
                Text(stringResource(helpOf(entry.state)), style = MaterialTheme.typography.bodySmall)
                val shared = entry.key.wireName != null
                val tag = if (shared) R.string.permission_tag_shared else R.string.permission_tag_local
                Text(stringResource(tag), style = MaterialTheme.typography.bodySmall)
            }
            HorizontalDivider()
            UsageAccessGuide(isEnrolled, usageAccess, onOpenUsageAccessSettings)
        }
    }
}

/**
 * Explains Usage Access and sends the child to the Android settings page where only the child can switch it on.
 * The app never grants it and never asks for it any other way.
 */
@Composable
private fun UsageAccessGuide(isEnrolled: Boolean, access: UsageAccess, onOpenSettings: () -> Unit) {
    Text(stringResource(R.string.usage_guide_header), style = MaterialTheme.typography.titleSmall)
    Text(stringResource(R.string.usage_guide_why), style = MaterialTheme.typography.bodyMedium)
    Text(stringResource(R.string.usage_guide_steps), style = MaterialTheme.typography.bodyMedium)
    Text(
        stringResource(
            when (access) {
                UsageAccess.GRANTED -> R.string.usage_guide_status_granted
                UsageAccess.NOT_GRANTED -> R.string.usage_guide_status_off
                UsageAccess.UNKNOWN -> R.string.usage_guide_status_unknown
            },
        ),
        style = MaterialTheme.typography.labelLarge,
    )
    if (isEnrolled) {
        OutlinedButton(onClick = onOpenSettings) { Text(stringResource(R.string.usage_guide_open)) }
    } else {
        Text(stringResource(R.string.usage_guide_not_connected), style = MaterialTheme.typography.bodySmall)
    }
}

@Composable
private fun sharedText(isEnrolled: Boolean, sharedAtEpochMillis: Long?): String = when {
    !isEnrolled -> stringResource(R.string.permissions_shared_not_connected)
    sharedAtEpochMillis == null -> stringResource(R.string.permissions_shared_never)
    else -> stringResource(
        R.string.permissions_shared_at,
        DateFormat.getDateTimeInstance(DateFormat.MEDIUM, DateFormat.SHORT).format(Date(sharedAtEpochMillis)),
    )
}

private fun statusOf(state: PermissionState): Int = when (state) {
    PermissionState.GRANTED -> R.string.permission_status_granted
    PermissionState.DENIED -> R.string.permission_status_denied
    PermissionState.REVOKED -> R.string.permission_status_revoked
    PermissionState.RESTRICTED -> R.string.permission_status_restricted
    PermissionState.NOT_AVAILABLE -> R.string.permission_status_not_available
    PermissionState.NOT_REQUESTED -> R.string.permission_status_not_requested
}

private fun helpOf(state: PermissionState): Int = when (state) {
    PermissionState.GRANTED -> R.string.permission_status_granted_help
    PermissionState.DENIED -> R.string.permission_status_denied_help
    PermissionState.REVOKED -> R.string.permission_status_revoked_help
    PermissionState.RESTRICTED -> R.string.permission_status_restricted_help
    PermissionState.NOT_AVAILABLE -> R.string.permission_status_not_available_help
    PermissionState.NOT_REQUESTED -> R.string.permission_status_not_requested_help
}

private fun nameOf(key: PermissionKey): Int = when (key) {
    PermissionKey.LOCATION -> R.string.permission_location_name
    PermissionKey.PRECISE_LOCATION -> R.string.permission_precise_location_name
    PermissionKey.BACKGROUND_LOCATION -> R.string.permission_background_location_name
    PermissionKey.CAMERA -> R.string.permission_camera_name
    PermissionKey.MICROPHONE -> R.string.permission_microphone_name
    PermissionKey.CONTACTS -> R.string.permission_contacts_name
    PermissionKey.SMS -> R.string.permission_sms_name
    PermissionKey.CALL_LOG -> R.string.permission_call_log_name
    PermissionKey.USAGE_ACCESS -> R.string.permission_usage_access_name
    PermissionKey.APP_LIST -> R.string.permission_app_list_name
    PermissionKey.NOTIFICATIONS -> R.string.permission_notifications_name
}

private fun whyOf(key: PermissionKey): Int = when (key) {
    PermissionKey.LOCATION -> R.string.permission_location_why
    PermissionKey.PRECISE_LOCATION -> R.string.permission_precise_location_why
    PermissionKey.BACKGROUND_LOCATION -> R.string.permission_background_location_why
    PermissionKey.CAMERA -> R.string.permission_camera_why
    PermissionKey.MICROPHONE -> R.string.permission_microphone_why
    PermissionKey.CONTACTS -> R.string.permission_contacts_why
    PermissionKey.SMS -> R.string.permission_sms_why
    PermissionKey.CALL_LOG -> R.string.permission_call_log_why
    PermissionKey.USAGE_ACCESS -> R.string.permission_usage_access_why
    PermissionKey.APP_LIST -> R.string.permission_app_list_why
    PermissionKey.NOTIFICATIONS -> R.string.permission_notifications_why
}
