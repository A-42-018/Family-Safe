package app.familysafe.child.config

/** A validated Supabase Edge Functions base URL, without trailing slash. */
@JvmInline
value class ApiBaseUrl private constructor(val value: String) {
    fun endpoint(name: String): String {
        require(name.matches(Regex("[a-z][a-z0-9-]*"))) { "Invalid function name" }
        return "$value/$name"
    }

    // Never print the URL in logs by accident.
    override fun toString(): String = "ApiBaseUrl"

    companion object {
        private val loopbackHosts = setOf("10.0.2.2", "localhost", "127.0.0.1")

        /** https is required. Cleartext is accepted only for emulator/loopback hosts and only when [allowLoopbackHttp]. */
        fun parse(raw: String, allowLoopbackHttp: Boolean): Result<ApiBaseUrl> = runCatching {
            val trimmed = raw.trim().trimEnd('/')
            require(trimmed.isNotEmpty()) { "API base URL is empty" }
            require(trimmed.none { it.isWhitespace() || it == '?' || it == '#' }) { "API base URL is malformed" }
            val scheme = trimmed.substringBefore("://", missingDelimiterValue = "")
            val rest = trimmed.substringAfter("://", missingDelimiterValue = "")
            val authority = rest.substringBefore('/')
            require(authority.isNotEmpty() && '@' !in authority) { "API base URL is malformed" }
            val host = authority.substringBefore(':')
            when (scheme) {
                "https" -> Unit
                "http" -> require(allowLoopbackHttp && host in loopbackHosts) { "Cleartext HTTP is not allowed" }
                else -> throw IllegalArgumentException("API base URL must use https")
            }
            ApiBaseUrl(trimmed)
        }
    }
}
