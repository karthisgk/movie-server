package com.movieserver.tv.ui.player

import androidx.lifecycle.ViewModel
import androidx.lifecycle.viewModelScope
import androidx.media3.common.MediaItem
import androidx.media3.common.Player
import androidx.media3.common.TrackSelectionParameters
import androidx.media3.exoplayer.ExoPlayer
import com.movieserver.tv.data.model.SubtitleTrack
import kotlinx.coroutines.flow.MutableStateFlow
import kotlinx.coroutines.flow.StateFlow
import kotlinx.coroutines.flow.asStateFlow

data class PlayerState(
    val isPlaying: Boolean = false,
    val isBuffering: Boolean = true,
    val currentPositionMs: Long = 0L,
    val durationMs: Long = 0L,
    val showControls: Boolean = true,
    val subtitles: List<SubtitleTrack> = emptyList(),
    val error: String? = null
)

/**
 * ViewModel for the video player. Holds the ExoPlayer instance so it survives
 * configuration changes (e.g. D-pad navigation causing activity recreation).
 */
class PlayerViewModel : ViewModel() {

    private val _state = MutableStateFlow(PlayerState())
    val state: StateFlow<PlayerState> = _state.asStateFlow()

    // ExoPlayer is set from the Activity after it creates it with the Context
    var player: ExoPlayer? = null
        private set

    private var playerListener: Player.Listener? = null

    fun initPlayer(exoPlayer: ExoPlayer) {
        if (player != null) return  // already initialized

        player = exoPlayer

        playerListener = object : Player.Listener {
            override fun onIsPlayingChanged(isPlaying: Boolean) {
                _state.value = _state.value.copy(isPlaying = isPlaying)
            }

            override fun onPlaybackStateChanged(playbackState: Int) {
                val isBuffering = playbackState == Player.STATE_BUFFERING
                val duration = exoPlayer.duration.coerceAtLeast(0L)
                _state.value = _state.value.copy(
                    isBuffering = isBuffering,
                    durationMs = duration
                )
            }

            override fun onPlayerError(error: androidx.media3.common.PlaybackException) {
                _state.value = _state.value.copy(
                    error = "Playback error: ${error.message}"
                )
            }
        }

        exoPlayer.addListener(playerListener!!)
    }

    fun setSubtitles(tracks: List<SubtitleTrack>) {
        _state.value = _state.value.copy(subtitles = tracks)
    }

    fun setShowControls(show: Boolean) {
        _state.value = _state.value.copy(showControls = show)
    }

    fun updatePosition(positionMs: Long, durationMs: Long) {
        _state.value = _state.value.copy(
            currentPositionMs = positionMs,
            durationMs = durationMs
        )
    }

    fun seekForward(ms: Long = 10_000L) {
        player?.let { p ->
            p.seekTo((p.currentPosition + ms).coerceAtMost(p.duration.coerceAtLeast(0L)))
        }
    }

    fun seekBackward(ms: Long = 10_000L) {
        player?.let { p ->
            p.seekTo((p.currentPosition - ms).coerceAtLeast(0L))
        }
    }

    fun togglePlayPause() {
        player?.let { p ->
            if (p.isPlaying) p.pause() else p.play()
        }
    }

    override fun onCleared() {
        super.onCleared()
        playerListener?.let { player?.removeListener(it) }
        player?.release()
        player = null
    }
}
