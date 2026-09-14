package com.movieserver.tv.data.repository

import com.movieserver.tv.data.api.MovieApiClient
import com.movieserver.tv.data.model.Movie
import com.movieserver.tv.data.model.SubtitleTrack
import com.movieserver.tv.utils.ServerUrlManager

class MovieRepository(private val serverUrlManager: ServerUrlManager) {

    private val service get() = MovieApiClient.service

    /** Fetches all movies from the server */
    suspend fun getMovies(): List<Movie> = service.getVideos()

    /** Fetches a single movie by ID */
    suspend fun getMovie(id: String): Movie = service.getVideo(id)

    /** Fetches available subtitle tracks for a movie */
    suspend fun getSubtitles(id: String): List<SubtitleTrack> =
        try { service.getSubtitles(id) } catch (e: Exception) { emptyList() }

    /**
     * Resolves a relative URL from the server (e.g. "/hls/movie-id/master.m3u8")
     * to a full URL using the configured server base URL.
     */
    fun resolveUrl(relativePath: String): String = serverUrlManager.resolveUrl(relativePath)

    /**
     * Returns the full HLS stream URL for a movie.
     * This is the URL ExoPlayer will load — it resolves the /play redirect manually
     * by constructing the HLS master.m3u8 URL directly.
     */
    fun getHlsUrl(movieId: String): String =
        serverUrlManager.resolveUrl("/hls/$movieId/master.m3u8")

    /** Returns the full URL for a subtitle .vtt file */
    fun getSubtitleUrl(relativePath: String): String =
        serverUrlManager.resolveUrl(relativePath)
}
