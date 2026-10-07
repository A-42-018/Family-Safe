package app.familysafe.child.data

import android.os.Build
import android.os.Environment
import android.os.StatFs
import app.familysafe.child.domain.DeviceDetails
import app.familysafe.child.domain.DeviceDetailsSource
import app.familysafe.child.domain.StorageMath

/**
 * Reads three facts that need NO permission: API level, security patch date and the size/free space of the
 * app-visible internal data partition. No identifiers, no file or app names, no location.
 */
class AndroidDeviceDetailsSource : DeviceDetailsSource {
    override fun current(): DeviceDetails {
        val storage = try {
            val stat = StatFs(Environment.getDataDirectory().path)
            StorageMath.fromBytes(
                totalBytes = stat.blockCountLong * stat.blockSizeLong,
                freeBytes = stat.availableBlocksLong * stat.blockSizeLong,
            )
        } catch (_: Exception) {
            null
        }
        return DeviceDetails(
            sdkLevel = Build.VERSION.SDK_INT,
            securityPatch = Build.VERSION.SECURITY_PATCH,
            storageTotalMb = storage?.first,
            storageFreeMb = storage?.second,
        )
    }
}
