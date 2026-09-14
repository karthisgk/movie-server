package com.movieserver.tv.data.api

import com.movieserver.tv.utils.ServerUrlManager
import okhttp3.OkHttpClient
import okhttp3.logging.HttpLoggingInterceptor
import retrofit2.Retrofit
import retrofit2.converter.gson.GsonConverterFactory
import java.util.concurrent.TimeUnit

/**
 * Provides a Retrofit-backed [MovieApiService] that targets the server URL
 * configured in [ServerUrlManager].
 *
 * Call [rebuild] whenever the server URL changes (e.g. after saving Settings).
 */
object MovieApiClient {

    private var serverUrlManager: ServerUrlManager? = null
    private var _service: MovieApiService? = null

    /** Must be called once before any API calls, typically in Application.onCreate */
    fun init(urlManager: ServerUrlManager) {
        serverUrlManager = urlManager
        rebuild()
    }

    /** Rebuilds the Retrofit client with the current URL. Call after settings change. */
    fun rebuild() {
        val manager = serverUrlManager ?: return
        val baseUrl = "${manager.baseUrl}/"   // Retrofit requires trailing slash

        val logging = HttpLoggingInterceptor().apply {
            level = HttpLoggingInterceptor.Level.BASIC
        }

        val client = OkHttpClient.Builder()
            .addInterceptor(logging)
            .connectTimeout(10, TimeUnit.SECONDS)
            .readTimeout(30, TimeUnit.SECONDS)
            .build()

        val retrofit = Retrofit.Builder()
            .baseUrl(baseUrl)
            .client(client)
            .addConverterFactory(GsonConverterFactory.create())
            .build()

        _service = retrofit.create(MovieApiService::class.java)
    }

    val service: MovieApiService
        get() = _service ?: throw IllegalStateException("MovieApiClient not initialized. Call init() first.")
}
