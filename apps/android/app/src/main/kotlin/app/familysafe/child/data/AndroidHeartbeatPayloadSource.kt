package app.familysafe.child.data

import android.content.Context
import android.content.Intent
import android.content.IntentFilter
import android.net.ConnectivityManager
import android.net.NetworkCapabilities
import android.os.BatteryManager
import android.os.Build
import app.familysafe.child.domain.BatteryMath
import app.familysafe.child.domain.HeartbeatPayload
import app.familysafe.child.domain.HeartbeatPayloadSource
import app.familysafe.child.domain.NetworkType
import app.familysafe.child.domain.NetworkTypeMapper

/**
 * Reads coarse device state that needs NO runtime permission: the sticky battery broadcast, the active network's
 * transport (ACCESS_NETWORK_STATE, already declared), and public version strings. No identifiers, no location.
 */
class AndroidHeartbeatPayloadSource(
    private val context: Context,
    private val appVersionName: String,
) : HeartbeatPayloadSource {
    override fun current(): HeartbeatPayload {
        val battery = context.registerReceiver(null, IntentFilter(Intent.ACTION_BATTERY_CHANGED))
        val level = BatteryMath.percent(
            battery?.getIntExtra(BatteryManager.EXTRA_LEVEL, -1) ?: -1,
            battery?.getIntExtra(BatteryManager.EXTRA_SCALE, -1) ?: -1,
        )
        return HeartbeatPayload(
            appVersion = appVersionName,
            androidVersion = Build.VERSION.RELEASE.orEmpty(),
            // No reading is reported as 0 rather than invented; the server contract has no "unknown" battery.
            batteryLevel = level ?: 0,
            isCharging = BatteryMath.isCharging(
                battery?.getIntExtra(BatteryManager.EXTRA_STATUS, -1) ?: -1,
                battery?.getIntExtra(BatteryManager.EXTRA_PLUGGED, 0) ?: 0,
            ),
            networkType = networkType(),
        )
    }

    private fun networkType(): NetworkType = try {
        val manager = context.getSystemService(ConnectivityManager::class.java)
        val network = manager?.activeNetwork
        val caps = network?.let { manager.getNetworkCapabilities(it) }
        NetworkTypeMapper.from(
            hasActiveNetwork = caps != null,
            vpn = caps?.hasTransport(NetworkCapabilities.TRANSPORT_VPN) == true,
            wifi = caps?.hasTransport(NetworkCapabilities.TRANSPORT_WIFI) == true,
            cellular = caps?.hasTransport(NetworkCapabilities.TRANSPORT_CELLULAR) == true,
            ethernet = caps?.hasTransport(NetworkCapabilities.TRANSPORT_ETHERNET) == true,
        )
    } catch (_: Exception) {
        NetworkType.Unknown
    }
}
