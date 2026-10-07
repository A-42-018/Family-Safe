package app.familysafe.child.data

import app.familysafe.child.domain.PermissionCatalog
import app.familysafe.child.domain.PermissionFacts
import app.familysafe.child.domain.PermissionKey
import app.familysafe.child.domain.PermissionObservation
import app.familysafe.child.domain.PermissionProbe
import app.familysafe.child.domain.PermissionState
import app.familysafe.child.domain.PermissionStateMapper

/** Reads the eight synced permissions from the OS, without ever showing a prompt, and keeps the history current. */
class PermissionStateReader(private val probe: PermissionProbe, private val history: PermissionHistoryStore) {
    fun read(): PermissionObservation {
        val states = LinkedHashMap<PermissionKey, PermissionState>()
        val grantedNow = mutableListOf<PermissionKey>()
        for (key in PermissionCatalog.SYNCED) {
            val available = probe.isAvailable(key)
            val granted = available && probe.isGranted(key)
            if (granted) grantedNow += key
            states[key] = PermissionStateMapper.map(
                PermissionFacts(
                    available = available,
                    granted = granted,
                    everGranted = history.everGranted(key),
                    requested = history.wasRequested(key),
                ),
            )
        }
        history.markGranted(grantedNow)
        return checkNotNull(PermissionObservation.create(states)) { "incomplete reading" }
    }
}
