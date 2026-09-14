package com.movieserver.tv.data.model

import com.google.gson.annotations.SerializedName

data class SubtitleTrack(
    @SerializedName("index")       val index: Int,
    @SerializedName("trackIndex") val trackIndex: Int,
    @SerializedName("language")   val language: String,
    @SerializedName("label")      val label: String,
    @SerializedName("url")        val url: String
)
