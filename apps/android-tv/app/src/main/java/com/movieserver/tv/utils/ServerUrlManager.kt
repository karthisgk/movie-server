package com.movieserver.tv.utils

import android.content.Context
import android.content.SharedPreferences

/**
 * Manages the server host and port configuration stored in SharedPreferences.
 * Default: host = 192.168.0.10, port = 5000
 */
class ServerUrlManager(context: Context) {

    companion object {
        private const val PREFS_NAME = "movie_server_prefs"
        private const val KEY_HOST = "server_host"
        private const val KEY_PORT = "server_port"
        const val DEFAULT_HOST = "192.168.0.10"
        const val DEFAULT_PORT = 5000
    }

    private val prefs: SharedPreferences =
        context.getSharedPreferences(PREFS_NAME, Context.MODE_PRIVATE)

    var host: String
        get() = prefs.getString(KEY_HOST, DEFAULT_HOST) ?: DEFAULT_HOST
        set(value) = prefs.edit().putString(KEY_HOST, value.trim()).apply()

    var port: Int
        get() = prefs.getInt(KEY_PORT, DEFAULT_PORT)
        set(value) = prefs.edit().putInt(KEY_PORT, value).apply()

    /** Returns the full base URL, e.g. "http://192.168.0.10:5000" */
    val baseUrl: String
        get() = "http://${host}:${port}"

    /** Returns the full URL for a relative path returned by the server API */
    fun resolveUrl(relativePath: String): String {
        val cleaned = if (relativePath.startsWith("/")) relativePath else "/$relativePath"
        return "${baseUrl}${cleaned}"
    }
}
