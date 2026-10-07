package app.familysafe.child.ui

import androidx.compose.foundation.layout.Box
import androidx.compose.runtime.Composable
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.saveable.rememberSaveable
import androidx.compose.runtime.setValue
import androidx.compose.ui.platform.LocalContext
import androidx.lifecycle.ViewModelProvider
import androidx.lifecycle.viewmodel.compose.viewModel
import androidx.navigation.compose.NavHost
import androidx.navigation.compose.composable
import androidx.navigation.compose.rememberNavController
import app.familysafe.child.domain.AppRuleLabels
import app.familysafe.child.domain.AppRuleNotices
import app.familysafe.child.domain.ChildAppState
import app.familysafe.child.domain.LimitNotice
import app.familysafe.child.domain.LimitStatus
import app.familysafe.child.domain.NoticeKeys
import app.familysafe.child.ui.about.AboutScreen
import app.familysafe.child.ui.devicestatus.DeviceStatusScreen
import app.familysafe.child.ui.enrollment.EnrolledScreen
import app.familysafe.child.ui.enrollment.EnrollmentScreen
import app.familysafe.child.ui.enrollment.EnrollmentViewModel
import app.familysafe.child.ui.limit.AppRuleNoticeScreen
import app.familysafe.child.ui.limit.LimitReachedScreen
import app.familysafe.child.ui.navigation.Destination
import app.familysafe.child.ui.permissions.PermissionsScreen
import app.familysafe.child.ui.permissions.UsageAccessSettings
import app.familysafe.child.ui.safety.SafetyScreen
import app.familysafe.child.ui.syncstatus.SyncStatusScreen
import app.familysafe.child.ui.theme.FamilySafeTheme

@Composable
fun ChildApp(state: ChildAppState, versionName: String, enrollmentViewModelFactory: ViewModelProvider.Factory) {
    FamilySafeTheme {
        val nav = rememberNavController()
        val back: () -> Unit = { nav.popBackStack() }
        val context = LocalContext.current
        // Dismissed per day and per limit (see LimitNotice); survives rotation, not a process restart.
        var dismissedKey by rememberSaveable { mutableStateOf<String?>(null) }
        // Dismissed app-rule notices as one saveable string (see NoticeKeys).
        var dismissedAppNotices by rememberSaveable { mutableStateOf("") }
        val evaluation = (state.limit as? LimitStatus.Active)?.evaluation
        val appNotice = AppRuleNotices.pending(state.appRules, dismissedAppNotices)
        Box {
            NavHost(navController = nav, startDestination = Destination.start.route) {
                composable(Destination.DeviceStatus.route) {
                    DeviceStatusScreen(
                        state.isEnrolled,
                        state.auth,
                        state.deviceInfo,
                        state.appInventory,
                        state.usage,
                        state.screenTime,
                        state.limit,
                        state.appRules,
                    ) {
                        nav.navigate(it.route)
                    }
                }
                composable(Destination.Permissions.route) {
                    PermissionsScreen(
                        isEnrolled = state.isEnrolled,
                        entries = state.permissions,
                        sharedAtEpochMillis = state.permissionsSharedAtEpochMillis,
                        usageAccess = state.usageAccess,
                        onOpenUsageAccessSettings = { UsageAccessSettings.open(context) },
                        onBack = back,
                    )
                }
                composable(Destination.Enrollment.route) {
                    if (state.isEnrolled) {
                        EnrolledScreen(back)
                    } else {
                        val viewModel: EnrollmentViewModel = viewModel(factory = enrollmentViewModelFactory)
                        EnrollmentScreen(viewModel, state.auth, back)
                    }
                }
                composable(Destination.SyncStatus.route) {
                    SyncStatusScreen(state.isEnrolled, state.auth, state.sync, back)
                }
                composable(Destination.Safety.route) { SafetyScreen(back) }
                composable(Destination.About.route) { AboutScreen(versionName, back) }
            }
            if (evaluation != null && LimitNotice.showsFullScreen(state.limit, dismissedKey)) {
                LimitReachedScreen(evaluation) { dismissedKey = LimitNotice.dismissKey(evaluation) }
            } else if (appNotice != null) {
                AppRuleNoticeScreen(appNotice, AppRuleLabels.labelFor(appNotice.packageName, state.appInventory)) {
                    dismissedAppNotices = NoticeKeys.add(dismissedAppNotices, appNotice.dismissKey)
                }
            }
        }
    }
}
