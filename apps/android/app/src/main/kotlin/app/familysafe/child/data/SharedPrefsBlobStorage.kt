package app.familysafe.child.data

import android.content.Context
import androidx.core.content.edit

/** App-private SharedPreferences holding only sealed blobs. Excluded from backup by data_extraction_rules.xml. */
class SharedPrefsBlobStorage(context: Context) : BlobStorage {
    private val prefs = context.applicationContext.getSharedPreferences("familysafe_secure", Context.MODE_PRIVATE)

    override fun read(name: String): String? = prefs.getString(name, null)
    override fun write(name: String, value: String) = prefs.edit { putString(name, value) }
    override fun delete(name: String) = prefs.edit { remove(name) }
    override fun deleteAll() = prefs.edit { clear() }
}
