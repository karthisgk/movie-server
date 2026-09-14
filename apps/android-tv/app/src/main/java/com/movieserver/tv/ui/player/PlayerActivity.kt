package com.movieserver.tv.ui.player

import android.app.AlertDialog
import android.net.Uri
import android.os.Bundle
import android.os.Handler
import android.os.Looper
import android.view.KeyEvent
import android.view.View
import android.view.WindowManager
import android.widget.*
import androidx.activity.viewModels
import androidx.fragment.app.FragmentActivity
import androidx.lifecycle.Lifecycle
import androidx.lifecycle.lifecycleScope
import androidx.lifecycle.repeatOnLifecycle
import androidx.media3.common.C
import androidx.media3.common.MediaItem
import androidx.media3.common.MediaItem.SubtitleConfiguration
import androidx.media3.common.MimeTypes
import androidx.media3.common.TrackSelectionOverride
import androidx.media3.common.TrackSelectionParameters
import androidx.media3.exoplayer.ExoPlayer
import androidx.media3.exoplayer.hls.HlsMediaSource
import androidx.media3.ui.PlayerView
import com.movieserver.tv.MovieApp
import com.movieserver.tv.R
import com.movieserver.tv.data.model.SubtitleTrack
import com.movieserver.tv.data.repository.MovieRepository
import kotlinx.coroutines.launch

import androidx.core.view.WindowCompat
import androidx.core.view.WindowInsetsCompat
import androidx.core.view.WindowInsetsControllerCompat

/**
 * Full-screen video player Activity.
 *
 * Controls (D-pad / Touch):
 *   CENTER / ENTER / TAP → Play / Pause
 *   LEFT                 → Seek backward 10s
 *   RIGHT                → Seek forward 10s
 *   UP                   → Show Audio Track picker
 *   DOWN                 → Show Subtitle picker
 *   BACK / ESCAPE        → Exit player
 *
 * Controls are auto-hidden after 3 seconds of inactivity.
 */
class PlayerActivity : FragmentActivity() {

    companion object {
        const val EXTRA_MOVIE_ID    = "extra_movie_id"
        const val EXTRA_MOVIE_TITLE = "extra_movie_title"
        private const val CONTROLS_HIDE_DELAY_MS = 3_000L
        private const val SEEK_AMOUNT_MS = 10_000L
        private const val POSITION_UPDATE_INTERVAL_MS = 500L
    }

    private val viewModel: PlayerViewModel by viewModels()
    private lateinit var repository: MovieRepository

    // Views
    private lateinit var playerView: PlayerView
    private lateinit var controlsOverlay: View
    private lateinit var tvTitle: TextView
    private lateinit var tvCurrentTime: TextView
    private lateinit var tvTotalTime: TextView
    private lateinit var seekBar: SeekBar
    private lateinit var btnPlayPause: ImageButton
    private lateinit var btnRewind: ImageButton
    private lateinit var btnForward: ImageButton
    private lateinit var btnAudio: ImageButton
    private lateinit var btnSubtitle: ImageButton
    private lateinit var progressBuffering: ProgressBar

    private val handler = Handler(Looper.getMainLooper())
    private val hideControlsRunnable = Runnable { hideControls() }
    private val positionUpdateRunnable = object : Runnable {
        override fun run() {
            updatePosition()
            handler.postDelayed(this, POSITION_UPDATE_INTERVAL_MS)
        }
    }

    private var movieId: String = ""
    private var subtitleTracks: List<SubtitleTrack> = emptyList()
    private var seekBarTracking = false

    override fun onCreate(savedInstanceState: Bundle?) {
        super.onCreate(savedInstanceState)

        // Keep screen on during playback
        window.addFlags(WindowManager.LayoutParams.FLAG_KEEP_SCREEN_ON)

        // Hide status & navigation bars for immersive fullscreen playback on phones, tablets & TVs
        WindowCompat.setDecorFitsSystemWindows(window, false)
        val insetsController = WindowCompat.getInsetsController(window, window.decorView)
        insetsController.hide(WindowInsetsCompat.Type.systemBars())
        insetsController.systemBarsBehavior = WindowInsetsControllerCompat.BEHAVIOR_SHOW_TRANSIENT_BARS_BY_SWIPE

        setContentView(R.layout.activity_player)

        val app = application as MovieApp
        repository = MovieRepository(app.serverUrlManager)

        movieId = intent.getStringExtra(EXTRA_MOVIE_ID) ?: run { finish(); return }
        val movieTitle = intent.getStringExtra(EXTRA_MOVIE_TITLE) ?: movieId

        bindViews()
        tvTitle.text = movieTitle
        setupSeekBar()

        // Initialize ExoPlayer (or reuse existing from ViewModel after rotation)
        if (viewModel.player == null) {
            val player = ExoPlayer.Builder(this).build()
            viewModel.initPlayer(player)
            playerView.player = player
            loadHlsStream(player)
        } else {
            playerView.player = viewModel.player
        }

        // Observe state
        lifecycleScope.launch {
            repeatOnLifecycle(Lifecycle.State.STARTED) {
                viewModel.state.collect { state ->
                    renderState(state)
                }
            }
        }

        // Load subtitles
        loadSubtitles()

        showControls()
    }

    private fun bindViews() {
        playerView       = findViewById(R.id.player_view)
        controlsOverlay  = findViewById(R.id.controls_overlay)
        tvTitle          = findViewById(R.id.tv_title)
        tvCurrentTime    = findViewById(R.id.tv_current_time)
        tvTotalTime      = findViewById(R.id.tv_total_time)
        seekBar          = findViewById(R.id.seek_bar)
        btnPlayPause     = findViewById(R.id.btn_play_pause)
        btnRewind        = findViewById(R.id.btn_rewind)
        btnForward       = findViewById(R.id.btn_forward)
        btnAudio         = findViewById(R.id.btn_audio)
        btnSubtitle      = findViewById(R.id.btn_subtitle)
        progressBuffering = findViewById(R.id.progress_buffering)

        // Hide default ExoPlayer controls — we use our own overlay
        playerView.useController = false

        btnPlayPause.setOnClickListener { viewModel.togglePlayPause(); scheduleHideControls() }
        btnRewind.setOnClickListener   { viewModel.seekBackward(SEEK_AMOUNT_MS); scheduleHideControls() }
        btnForward.setOnClickListener  { viewModel.seekForward(SEEK_AMOUNT_MS); scheduleHideControls() }
        btnAudio.setOnClickListener    { showAudioTrackPicker() }
        btnSubtitle.setOnClickListener { showSubtitlePicker() }
    }

    private fun setupSeekBar() {
        seekBar.setOnSeekBarChangeListener(object : SeekBar.OnSeekBarChangeListener {
            override fun onProgressChanged(sb: SeekBar, progress: Int, fromUser: Boolean) {
                if (fromUser) {
                    val duration = viewModel.player?.duration ?: 0L
                    tvCurrentTime.text = formatTime((progress / 100f * duration).toLong())
                }
            }
            override fun onStartTrackingTouch(sb: SeekBar) { seekBarTracking = true }
            override fun onStopTrackingTouch(sb: SeekBar) {
                seekBarTracking = false
                val duration = viewModel.player?.duration ?: 0L
                viewModel.player?.seekTo((sb.progress / 100f * duration).toLong())
                scheduleHideControls()
            }
        })
    }

    private fun loadHlsStream(player: ExoPlayer) {
        val hlsUrl = repository.getHlsUrl(movieId)
        val mediaItem = MediaItem.fromUri(Uri.parse(hlsUrl))
        player.setMediaItem(mediaItem)
        player.prepare()
        player.playWhenReady = true
    }

    private fun loadSubtitles() {
        lifecycleScope.launch {
            try {
                val tracks = repository.getSubtitles(movieId)
                subtitleTracks = tracks
                viewModel.setSubtitles(tracks)
            } catch (e: Exception) {
                subtitleTracks = emptyList()
            }
        }
    }

    // ─── State rendering ────────────────────────────────────────────────────

    private fun renderState(state: PlayerState) {
        // Buffering spinner
        progressBuffering.visibility = if (state.isBuffering) View.VISIBLE else View.GONE

        // Play/Pause icon
        btnPlayPause.setImageResource(
            if (state.isPlaying) R.drawable.ic_pause else R.drawable.ic_play
        )

        // Time display (only when not dragging seek bar)
        if (!seekBarTracking) {
            tvCurrentTime.text = formatTime(state.currentPositionMs)
            tvTotalTime.text   = formatTime(state.durationMs)
            if (state.durationMs > 0) {
                val progress = (state.currentPositionMs * 100f / state.durationMs).toInt()
                seekBar.progress = progress.coerceIn(0, 100)
            }
        }

        // Controls visibility
        controlsOverlay.visibility = if (state.showControls) View.VISIBLE else View.GONE
    }

    // ─── Position polling ────────────────────────────────────────────────────

    private fun updatePosition() {
        val player = viewModel.player ?: return
        val pos = player.currentPosition
        val dur = player.duration.coerceAtLeast(0L)
        viewModel.updatePosition(pos, dur)
    }

    // ─── Controls visibility ─────────────────────────────────────────────────

    private fun showControls() {
        viewModel.setShowControls(true)
        scheduleHideControls()
        handler.post(positionUpdateRunnable)
    }

    private fun hideControls() {
        viewModel.setShowControls(false)
    }

    private fun scheduleHideControls() {
        handler.removeCallbacks(hideControlsRunnable)
        handler.postDelayed(hideControlsRunnable, CONTROLS_HIDE_DELAY_MS)
    }

    // ─── D-pad key handling ──────────────────────────────────────────────────

    override fun onKeyDown(keyCode: Int, event: KeyEvent?): Boolean {
        showControls()
        return when (keyCode) {
            KeyEvent.KEYCODE_DPAD_CENTER,
            KeyEvent.KEYCODE_ENTER,
            KeyEvent.KEYCODE_MEDIA_PLAY_PAUSE -> {
                viewModel.togglePlayPause()
                true
            }
            KeyEvent.KEYCODE_DPAD_RIGHT,
            KeyEvent.KEYCODE_MEDIA_FAST_FORWARD -> {
                viewModel.seekForward(SEEK_AMOUNT_MS)
                true
            }
            KeyEvent.KEYCODE_DPAD_LEFT,
            KeyEvent.KEYCODE_MEDIA_REWIND -> {
                viewModel.seekBackward(SEEK_AMOUNT_MS)
                true
            }
            KeyEvent.KEYCODE_DPAD_UP -> {
                showAudioTrackPicker()
                true
            }
            KeyEvent.KEYCODE_DPAD_DOWN -> {
                showSubtitlePicker()
                true
            }
            KeyEvent.KEYCODE_MEDIA_PLAY -> {
                viewModel.player?.play()
                true
            }
            KeyEvent.KEYCODE_MEDIA_PAUSE,
            KeyEvent.KEYCODE_MEDIA_STOP -> {
                viewModel.player?.pause()
                true
            }
            KeyEvent.KEYCODE_BACK,
            KeyEvent.KEYCODE_ESCAPE -> {
                finish()
                true
            }
            else -> super.onKeyDown(keyCode, event)
        }
    }

    // ─── Audio Track Picker ───────────────────────────────────────────────────

    private fun showAudioTrackPicker() {
        val player = viewModel.player ?: return
        handler.removeCallbacks(hideControlsRunnable)  // don't hide while dialog open

        val tracks = player.currentTracks
        val audioGroups = tracks.groups.filter { group ->
            group.type == C.TRACK_TYPE_AUDIO
        }

        if (audioGroups.isEmpty()) {
            Toast.makeText(this, "No audio tracks available", Toast.LENGTH_SHORT).show()
            scheduleHideControls()
            return
        }

        val labels = mutableListOf<String>()
        var checkedItem = 0

        audioGroups.forEachIndexed { groupIndex, group ->
            for (trackIndex in 0 until group.length) {
                val format = group.getTrackFormat(trackIndex)
                val lang = format.language ?: "Track ${groupIndex + 1}"
                val label = getLanguageName(lang)
                val channels = format.channelCount
                val displayLabel = if (channels > 0) "$label (${channels}ch)" else label
                labels.add(displayLabel)
                if (group.isTrackSelected(trackIndex)) checkedItem = labels.size - 1
            }
        }

        var selectedIndex = checkedItem
        AlertDialog.Builder(this)
            .setTitle("Audio Track")
            .setSingleChoiceItems(labels.toTypedArray(), checkedItem) { _, which ->
                selectedIndex = which
            }
            .setPositiveButton("OK") { _, _ ->
                applyAudioTrack(audioGroups, selectedIndex)
                scheduleHideControls()
            }
            .setNegativeButton("Cancel") { _, _ -> scheduleHideControls() }
            .show()
    }

    private fun applyAudioTrack(
        audioGroups: List<androidx.media3.common.Tracks.Group>,
        selectedIndex: Int
    ) {
        val player = viewModel.player ?: return
        var flatIndex = 0
        for (group in audioGroups) {
            for (trackIndex in 0 until group.length) {
                if (flatIndex == selectedIndex) {
                    val override = TrackSelectionOverride(group.mediaTrackGroup, trackIndex)
                    player.trackSelectionParameters = player.trackSelectionParameters
                        .buildUpon()
                        .clearOverridesOfType(C.TRACK_TYPE_AUDIO)
                        .addOverride(override)
                        .build()
                    return
                }
                flatIndex++
            }
        }
    }

    // ─── Subtitle Picker ──────────────────────────────────────────────────────

    private fun showSubtitlePicker() {
        val player = viewModel.player ?: return
        handler.removeCallbacks(hideControlsRunnable)

        // Build list: "Off" + server-extracted .vtt tracks + in-stream text tracks
        val labels = mutableListOf("Off")
        val subtitleUrls = mutableListOf<String?>()
        subtitleUrls.add(null)   // Off option

        // Add server-extracted subtitles
        subtitleTracks.forEach { track ->
            labels.add(track.label)
            subtitleUrls.add(repository.getSubtitleUrl(track.url))
        }

        // Also add in-stream text tracks from ExoPlayer
        val tracks = player.currentTracks
        val textGroups = tracks.groups.filter { it.type == C.TRACK_TYPE_TEXT }
        textGroups.forEachIndexed { _, group ->
            for (trackIndex in 0 until group.length) {
                val format = group.getTrackFormat(trackIndex)
                val lang = format.language ?: "Subtitle"
                labels.add("[In-stream] ${getLanguageName(lang)}")
                subtitleUrls.add(null)  // handled differently
            }
        }

        var selectedIndex = 0   // default: Off

        AlertDialog.Builder(this)
            .setTitle("Subtitles")
            .setSingleChoiceItems(labels.toTypedArray(), 0) { _, which ->
                selectedIndex = which
            }
            .setPositiveButton("OK") { _, _ ->
                applySubtitle(selectedIndex, subtitleUrls, textGroups)
                scheduleHideControls()
            }
            .setNegativeButton("Cancel") { _, _ -> scheduleHideControls() }
            .show()
    }

    private fun applySubtitle(
        selectedIndex: Int,
        subtitleUrls: List<String?>,
        textGroups: List<androidx.media3.common.Tracks.Group>
    ) {
        val player = viewModel.player ?: return

        when {
            // Off
            selectedIndex == 0 -> {
                player.trackSelectionParameters = player.trackSelectionParameters
                    .buildUpon()
                    .setIgnoredTextSelectionFlags(C.SELECTION_FLAG_DEFAULT)
                    .clearOverridesOfType(C.TRACK_TYPE_TEXT)
                    .build()
            }
            // Server .vtt subtitle
            selectedIndex <= subtitleTracks.size -> {
                val vttUrl = subtitleUrls[selectedIndex] ?: return
                val currentItem = player.currentMediaItem ?: return
                val track = subtitleTracks[selectedIndex - 1]
                val subConfig = SubtitleConfiguration.Builder(Uri.parse(vttUrl))
                    .setMimeType(MimeTypes.TEXT_VTT)
                    .setLanguage(track.language)
                    .setSelectionFlags(C.SELECTION_FLAG_DEFAULT)
                    .build()
                // Rebuild media item with subtitle
                val newMediaItem = currentItem.buildUpon()
                    .setSubtitleConfigurations(listOf(subConfig))
                    .build()
                val position = player.currentPosition
                player.setMediaItem(newMediaItem, position)
                player.prepare()
                player.play()
            }
            // In-stream text track
            else -> {
                val inStreamIndex = selectedIndex - subtitleTracks.size - 1
                var flatIdx = 0
                for (group in textGroups) {
                    for (trackIndex in 0 until group.length) {
                        if (flatIdx == inStreamIndex) {
                            val override = TrackSelectionOverride(group.mediaTrackGroup, trackIndex)
                            player.trackSelectionParameters = player.trackSelectionParameters
                                .buildUpon()
                                .clearOverridesOfType(C.TRACK_TYPE_TEXT)
                                .addOverride(override)
                                .build()
                            return
                        }
                        flatIdx++
                    }
                }
            }
        }
    }

    // ─── Lifecycle ────────────────────────────────────────────────────────────

    override fun onResume() {
        super.onResume()
        handler.post(positionUpdateRunnable)
    }

    override fun onPause() {
        super.onPause()
        handler.removeCallbacks(positionUpdateRunnable)
        handler.removeCallbacks(hideControlsRunnable)
    }

    override fun onDestroy() {
        super.onDestroy()
        playerView.player = null   // Don't release — ViewModel owns the player
    }

    // ─── Helpers ─────────────────────────────────────────────────────────────

    private fun formatTime(ms: Long): String {
        if (ms <= 0L) return "0:00"
        val totalSecs = ms / 1000
        val h = totalSecs / 3600
        val m = (totalSecs % 3600) / 60
        val s = totalSecs % 60
        return if (h > 0) {
            String.format("%d:%02d:%02d", h, m, s)
        } else {
            String.format("%d:%02d", m, s)
        }
    }

    private fun getLanguageName(code: String): String {
        return when (code.lowercase()) {
            "eng", "en" -> "English"
            "fre", "fra", "fr" -> "French"
            "ger", "deu", "de" -> "German"
            "spa", "es" -> "Spanish"
            "ita", "it" -> "Italian"
            "jpn", "ja" -> "Japanese"
            "chi", "zho", "zh" -> "Chinese"
            "kor", "ko" -> "Korean"
            "por", "pt" -> "Portuguese"
            "rus", "ru" -> "Russian"
            "ara", "ar" -> "Arabic"
            "hin", "hi" -> "Hindi"
            "tam", "ta" -> "Tamil"
            "tel", "te" -> "Telugu"
            "und" -> "Unknown"
            else -> code.uppercase()
        }
    }
}
