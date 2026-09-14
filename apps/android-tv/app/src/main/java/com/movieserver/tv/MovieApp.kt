package com.movieserver.tv

import android.app.Application
import com.movieserver.tv.data.api.MovieApiClient
import com.movieserver.tv.utils.ServerUrlManager

class MovieApp : Application() {
    lateinit var serverUrlManager: ServerUrlManager
        private set

    override fun onCreate() {
        super.onCreate()
        serverUrlManager = ServerUrlManager(this)
        MovieApiClient.init(serverUrlManager)
    }
}
