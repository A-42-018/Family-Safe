package app.familysafe.child.data

import app.familysafe.child.domain.EnrollmentFailure
import java.io.IOException
import java.net.ConnectException
import java.net.SocketTimeoutException
import java.net.UnknownHostException
import javax.net.ssl.SSLException
import javax.net.ssl.SSLHandshakeException
import org.junit.jupiter.api.Assertions.assertEquals
import org.junit.jupiter.api.Test

/** Same simple name as Ktor's connect-timeout exception (matched by name on purpose). */
private class ConnectTimeoutException : IOException("connect timeout")

class NetworkFailureClassifierTest {
    private fun classify(t: Throwable) = NetworkFailureClassifier.classify(t)

    @Test
    fun `failures before the request could be sent are unreachable`() {
        assertEquals(EnrollmentFailure.Unreachable, classify(UnknownHostException("h")))
        assertEquals(EnrollmentFailure.Unreachable, classify(ConnectException("refused")))
        assertEquals(EnrollmentFailure.Unreachable, classify(SSLHandshakeException("tls")))
        assertEquals(EnrollmentFailure.Unreachable, classify(ConnectTimeoutException()))
    }

    @Test
    fun `wrapped causes are found`() {
        assertEquals(EnrollmentFailure.Unreachable, classify(RuntimeException("x", UnknownHostException("h"))))
    }

    @Test
    fun `failures that may have happened after sending are uncertain`() {
        assertEquals(EnrollmentFailure.Uncertain, classify(SocketTimeoutException("read timed out")))
        assertEquals(EnrollmentFailure.Uncertain, classify(IOException("unexpected end of stream")))
        assertEquals(EnrollmentFailure.Uncertain, classify(SSLException("closed")))
        assertEquals(EnrollmentFailure.Uncertain, classify(IllegalStateException("boom")))
    }

    @Test
    fun `cause cycles terminate`() {
        val a = RuntimeException("a")
        val b = RuntimeException("b")
        a.initCause(b)
        b.initCause(a)
        assertEquals(EnrollmentFailure.Uncertain, classify(a))
    }

    @Test
    fun `isBeforeSend is the boolean form of the same rule`() {
        assertEquals(true, NetworkFailureClassifier.isBeforeSend(UnknownHostException("h")))
        assertEquals(true, NetworkFailureClassifier.isBeforeSend(RuntimeException("x", ConnectException("c"))))
        assertEquals(false, NetworkFailureClassifier.isBeforeSend(SocketTimeoutException("read")))
    }
}
