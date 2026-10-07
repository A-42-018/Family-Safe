package app.familysafe.child.ui.about

import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.Text
import androidx.compose.runtime.Composable
import androidx.compose.ui.res.stringResource
import app.familysafe.child.R
import app.familysafe.child.ui.common.ScreenBody
import app.familysafe.child.ui.common.ScreenScaffold

@Composable
fun AboutScreen(versionName: String, onBack: () -> Unit) {
    ScreenScaffold(stringResource(R.string.title_about), onBack) { padding ->
        ScreenBody(padding) {
            Text(stringResource(R.string.about_body), style = MaterialTheme.typography.bodyMedium)
            Text(stringResource(R.string.about_privacy), style = MaterialTheme.typography.bodyMedium)
            Text(stringResource(R.string.about_version, versionName), style = MaterialTheme.typography.labelLarge)
        }
    }
}
