package com.movieserver.tv.data.api

import com.movieserver.tv.data.model.Movie
import com.movieserver.tv.data.model.SubtitleTrack
import retrofit2.http.GET
import retrofit2.http.Path

interface MovieApiService {

    /** Returns the full list of discovered movies */
    @GET("videos")
    suspend fun getVideos(): List<Movie>

    /** Returns a single movie by ID */
    @GET("videos/{id}")
    suspend fun getVideo(@Path("id") id: String): Movie

    /** Returns available subtitle tracks for a movie */
    @GET("videos/{id}/subtitles")
    suspend fun getSubtitles(@Path("id") id: String): List<SubtitleTrack>
}
