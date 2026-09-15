package com.movieserver.tv.utils

import android.content.Context
import android.content.SharedPreferences
import android.net.Uri
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.withContext
import java.net.HttpURLConnection
import java.net.URL

/**
 * Manages the server configuration and saved server list in SharedPreferences.
 */
class ServerUrlManager(context: Context) {

    companion object {
        private const val PREFS_NAME = "movie_server_prefs"
        private const val KEY_SERVER_URL = "server_url"
        private const val KEY_HOST = "server_host"
        private const val KEY_PORT = "server_port"
        private const val KEY_SAVED_SERVERS = "saved_servers"

        const val DEFAULT_HOST = "192.168.0.10"
        const val DEFAULT_PORT = 5000

        val DEFAULT_SAVED_SERVERS = listOf(
            "http://106.51.20.114:8001",
            "http://106.51.20.114:5000",
            "http://192.168.0.2:5000",
            "http://192.168.0.7:5000",
            "http://192.168.0.5:5000",
            "http://192.168.0.5:8001"
        )

        fun normalizeUrl(raw: String): String {
            var trimmed = raw.trim()
            if (!trimmed.startsWith("http://") && !trimmed.startsWith("https://")) {
                trimmed = "http://$trimmed"
            }
            return trimmed.trimEnd('/')
        }

        fun isValidServerUrl(raw: String): Boolean {
            if (raw.isBlank()) return false
            val normalized = normalizeUrl(raw)
            return try {
                val uri = Uri.parse(normalized)
                val scheme = uri.scheme
                val host = uri.host
                (scheme == "http" || scheme == "https") && !host.isNullOrBlank()
            } catch (e: Exception) {
                false
            }
        }

        fun checkHealth(serverUrl: String): Boolean {
            return try {
                val endpoint = "${serverUrl.trimEnd('/')}/health"
                val conn = URL(endpoint).openConnection() as HttpURLConnection
                conn.connectTimeout = 2000
                conn.readTimeout = 2000
                conn.requestMethod = "GET"
                val code = conn.responseCode
                conn.disconnect()
                code == 200
            } catch (e: Exception) {
                false
            }
        }
    }

    private val prefs: SharedPreferences =
        context.getSharedPreferences(PREFS_NAME, Context.MODE_PRIVATE)

    var host: String
        get() = prefs.getString(KEY_HOST, DEFAULT_HOST) ?: DEFAULT_HOST
        set(value) = prefs.edit().putString(KEY_HOST, value.trim()).apply()

    var port: Int
        get() = prefs.getInt(KEY_PORT, DEFAULT_PORT)
        set(value) = prefs.edit().putInt(KEY_PORT, value).apply()

    /** Returns the current full base URL, e.g. "http://192.168.0.10:5000" */
    var serverUrl: String
        get() {
            val savedUrl = prefs.getString(KEY_SERVER_URL, null)
            if (!savedUrl.isNullOrBlank()) return normalizeUrl(savedUrl)
            return "http://${host}:${port}"
        }
        set(value) {
            val normalized = normalizeUrl(value)
            prefs.edit().putString(KEY_SERVER_URL, normalized).apply()
            try {
                val uri = Uri.parse(normalized)
                uri.host?.let { host = it }
                if (uri.port > 0) port = uri.port
            } catch (_: Exception) {}
        }

    val baseUrl: String
        get() = serverUrl

    /** Get list of saved servers */
    fun getSavedServers(): List<String> {
        val rawSet = prefs.getStringSet(KEY_SAVED_SERVERS, null)
        if (rawSet == null) {
            saveSavedServers(DEFAULT_SAVED_SERVERS)
            return DEFAULT_SAVED_SERVERS
        }
        val list = rawSet.map { normalizeUrl(it) }.toMutableList()
        DEFAULT_SAVED_SERVERS.forEach { defaultServer ->
            if (!list.contains(defaultServer)) {
                list.add(defaultServer)
            }
        }
        return list
    }

    /** Find first active available server from the saved list */
    suspend fun findFirstAvailableServer(): String? {
        return withContext(Dispatchers.IO) {
            val servers = getSavedServers()
            for (url in servers) {
                if (checkHealth(url)) {
                    return@withContext url
                }
            }
            null
        }
    }

    /** Add server to saved list */
    fun addSavedServer(url: String) {
        val normalized = normalizeUrl(url)
        val current = getSavedServers().toMutableList()
        if (!current.contains(normalized)) {
            current.add(0, normalized)
            saveSavedServers(current)
        }
    }

    /** Remove server from saved list */
    fun removeSavedServer(url: String) {
        val normalized = normalizeUrl(url)
        val current = getSavedServers().toMutableList()
        current.remove(normalized)
        saveSavedServers(current)
    }

    private fun saveSavedServers(servers: List<String>) {
        prefs.edit().putStringSet(KEY_SAVED_SERVERS, servers.toSet()).apply()
    }

    /** Returns the full URL for a relative path returned by the server API */
    fun resolveUrl(relativePath: String): String {
        val cleaned = if (relativePath.startsWith("/")) relativePath else "/$relativePath"
        return "${baseUrl.trimEnd('/')}${cleaned}"
    }
}
