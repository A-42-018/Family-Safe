package app.familysafe.child

import android.app.Application
import app.familysafe.child.di.AppContainer

class FamilySafeApp : Application() {
    lateinit var container: AppContainer
        private set

    override fun onCreate() {
        super.onCreate()
        container = AppContainer(this)
        container.startBackgroundWork()
    }
}
