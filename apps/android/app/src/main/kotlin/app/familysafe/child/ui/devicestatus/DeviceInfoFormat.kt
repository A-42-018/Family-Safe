package app.familysafe.child.ui.devicestatus

import java.util.Locale

/** Pure formatting for the "what has been shared" list, so it is JVM-testable and identical in every locale test. */
object DeviceInfoFormat {
    private const val MB_PER_GB = 1024.0

    /** `"12.3"` for 12 595 MiB; one decimal in the given locale. */
    fun gigabytes(mb: Long, locale: Locale = Locale.getDefault()): String =
        String.format(locale, "%.1f", mb / MB_PER_GB)

    /** Share of the partition that is in use, 0..100, or null when the pair is not usable. */
    fun usedPercent(totalMb: Long?, freeMb: Long?): Int? {
        if (totalMb == null || freeMb == null || totalMb < 1 || freeMb < 0 || freeMb > totalMb) return null
        return (((totalMb - freeMb) * 100) / totalMb).toInt()
    }
}
