package app.familysafe.child

import android.os.Bundle
import androidx.activity.ComponentActivity
import androidx.activity.compose.setContent
import androidx.activity.enableEdgeToEdge
import androidx.compose.runtime.getValue
import androidx.lifecycle.Lifecycle
import androidx.lifecycle.compose.collectAsStateWithLifecycle
import androidx.lifecycle.lifecycleScope
import androidx.lifecycle.repeatOnLifecycle
import app.familysafe.child.domain.LimitCheckTimings
import app.familysafe.child.ui.ChildApp
import kotlinx.coroutines.delay
import kotlinx.coroutines.launch

class MainActivity : ComponentActivity() {
    override fun onResume() {
        super.onResume()
        (application as FamilySafeApp).container.onAppResumed()
    }

    override fun onCreate(savedInstanceState: Bundle?) {
        super.onCreate(savedInstanceState)
        enableEdgeToEdge()
        val container = (application as FamilySafeApp).container
        // While the app is on screen the limit check repeats once a minute (a local read, nothing is sent). It stops
        // as soon as the app is no longer visible: this app has no background service and no overlay.
        lifecycleScope.launch {
            repeatOnLifecycle(Lifecycle.State.STARTED) {
                while (true) {
                    delay(LimitCheckTimings.FOREGROUND_TICK_MILLIS)
                    container.refreshLimitStatus()
                }
            }
        }
        setContent {
            val state by container.appState.state.collectAsStateWithLifecycle()
            ChildApp(
                state = state,
                versionName = container.config.versionName,
                enrollmentViewModelFactory = container.enrollmentViewModelFactory,
            )
        }
    }
}
