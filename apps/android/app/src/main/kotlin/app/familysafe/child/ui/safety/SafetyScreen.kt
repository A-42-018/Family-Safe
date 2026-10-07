package app.familysafe.child.ui.safety

import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.Text
import androidx.compose.runtime.Composable
import androidx.compose.ui.res.stringResource
import app.familysafe.child.R
import app.familysafe.child.ui.common.ScreenBody
import app.familysafe.child.ui.common.ScreenScaffold

@Composable
fun SafetyScreen(onBack: () -> Unit) {
    ScreenScaffold(stringResource(R.string.title_safety), onBack) { padding ->
        ScreenBody(padding) {
            Text(stringResource(R.string.safety_intro), style = MaterialTheme.typography.titleSmall)
            Text(stringResource(R.string.safety_item_visible))
            Text(stringResource(R.string.safety_item_no_messages))
            Text(stringResource(R.string.safety_item_no_secret_audio))
            Text(stringResource(R.string.safety_item_removal))
        }
    }
}
