package app.familysafe.child.ui.devicestatus

import app.familysafe.child.domain.InstalledApp
import org.junit.jupiter.api.Assertions.assertEquals
import org.junit.jupiter.api.Test

class AppInventoryFormatTest {
    @Test
    fun `row detail covers all four combinations`() {
        assertEquals(AppRowDetail.Plain, AppInventoryFormat.detailOf(InstalledApp("a.b", "A", null, false)))
        assertEquals(AppRowDetail.Version, AppInventoryFormat.detailOf(InstalledApp("a.b", "A", "1", false)))
        assertEquals(AppRowDetail.System, AppInventoryFormat.detailOf(InstalledApp("a.b", "A", null, true)))
        assertEquals(AppRowDetail.VersionAndSystem, AppInventoryFormat.detailOf(InstalledApp("a.b", "A", "1", true)))
    }

    @Test
    fun `the list is shown by app name, ignoring case, and is stable for equal names`() {
        val apps = listOf(
            InstalledApp("com.z.z", "zebra", null, false),
            InstalledApp("com.a.a", "Mango", null, false),
            InstalledApp("com.b.b", "apple", null, false),
            InstalledApp("com.c.c", "Mango", null, true),
        )
        assertEquals(
            listOf("com.b.b", "com.a.a", "com.c.c", "com.z.z"),
            AppInventoryFormat.byName(apps).map { it.packageName },
        )
    }
}
