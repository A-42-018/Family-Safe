package app.familysafe.child.data

import app.familysafe.child.domain.EnrollmentFailure
import java.net.ConnectException
import java.net.NoRouteToHostException
import java.net.PortUnreachableException
import java.net.UnknownHostException
import javax.net.ssl.SSLHandshakeException

/**
 * Decides whether a thrown failure happened BEFORE the request could reach the server ([EnrollmentFailure.Unreachable],
 * safe to retry the same code) or possibly AFTER ([EnrollmentFailure.Uncertain], the code may be spent).
 * When in doubt it answers Uncertain: that only costs the child one extra step, never a stuck device.
 */
object NetworkFailureClassifier {
    private const val MAX_DEPTH = 8

    fun classify(error: Throwable): EnrollmentFailure =
        if (isBeforeSend(error)) EnrollmentFailure.Unreachable else EnrollmentFailure.Uncertain

    /** True only when the failure (or one of its causes) proves the request never left this device. */
    fun isBeforeSend(error: Throwable): Boolean {
        var current: Throwable? = error
        var depth = 0
        while (current != null && depth < MAX_DEPTH) {
            if (isBeforeSendType(current)) return true
            current = current.cause?.takeIf { it !== current }
            depth++
        }
        return false
    }

    private fun isBeforeSendType(t: Throwable): Boolean = t is UnknownHostException ||
        t is ConnectException ||
        t is NoRouteToHostException ||
        t is PortUnreachableException ||
        t is SSLHandshakeException ||
        // Ktor's connect timeout; matched by name so this file stays free of engine types.
        t.javaClass.simpleName == "ConnectTimeoutException"
}
