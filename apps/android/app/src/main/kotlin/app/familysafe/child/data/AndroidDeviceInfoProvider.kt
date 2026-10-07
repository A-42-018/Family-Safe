package app.familysafe.child.data

import android.os.Build
import app.familysafe.child.domain.DeviceInfo
import app.familysafe.child.domain.DeviceInfoProvider

/** Public `Build` fields only: no serial number, IMEI, advertising id or any other hardware identifier. */
class AndroidDeviceInfoProvider(private val appVersionName: String) : DeviceInfoProvider {
    override fun current(): DeviceInfo = DeviceInfo(
        name = DeviceInfo.defaultName(Build.MANUFACTURER, Build.MODEL),
        manufacturer = Build.MANUFACTURER,
        model = Build.MODEL,
        androidVersion = Build.VERSION.RELEASE,
        appVersion = appVersionName,
    )
}
