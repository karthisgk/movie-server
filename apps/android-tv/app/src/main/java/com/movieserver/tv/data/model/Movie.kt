package com.movieserver.tv.data.model

import com.google.gson.annotations.SerializedName

data class Movie(
    @SerializedName("id")                  val rawId: String?,
    @SerializedName("title")               val rawTitle: String?,
    @SerializedName("filename")            val rawFilename: String?,
    @SerializedName("status")              val rawStatus: String?,
    @SerializedName("durationSeconds")     val durationSeconds: Double?,
    @SerializedName("width")               val width: Int?,
    @SerializedName("height")              val height: Int?,
    @SerializedName("videoCodec")          val videoCodec: String?,
    @SerializedName("audioCodec")          val audioCodec: String?,
    @SerializedName("playUrl")             val rawPlayUrl: String?,
    @SerializedName("sizeBytes")           val sizeBytes: Long?,
    @SerializedName("transcodingProgress") val transcodingProgress: Double?,
    @SerializedName("transcodingProfile")  val transcodingProfile: String?,
    @SerializedName("completedProfiles")   val completedProfiles: List<String>?,
    @SerializedName("error")               val error: String?
) {
    val id: String get() = rawId ?: ""
    val title: String get() = rawTitle ?: rawFilename ?: "Untitled"
    val filename: String get() = rawFilename ?: ""
    val status: String get() = rawStatus ?: "unknown"
    val playUrl: String get() = rawPlayUrl ?: ""

    /** True if the movie can be played right now */
    val isPlayable: Boolean
        get() = status == "ready" || status == "partial"

    /** Resolution badge string, e.g. "1080p" */
    val resolutionBadge: String?
        get() = when {
            (height ?: 0) >= 1080 -> "1080p"
            (height ?: 0) >= 720  -> "720p"
            (height ?: 0) >= 480  -> "480p"
            else -> null
        }

    /** Formatted duration, e.g. "2h 43m" */
    val formattedDuration: String
        get() {
            val secs = durationSeconds?.toInt() ?: return ""
            val h = secs / 3600
            val m = (secs % 3600) / 60
            return if (h > 0) "${h}h ${m}m" else "${m}m"
        }
}
