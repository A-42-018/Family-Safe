package app.familysafe.child.domain

/** When the periodic heartbeat may exist at all. */
object HeartbeatPolicy {
    /** Enrolled and not known to be disconnected. Disconnected or not enrolled means no work is scheduled. */
    fun shouldRun(state: ChildAppState): Boolean = state.isEnrolled && !state.auth.isDisconnected
}
