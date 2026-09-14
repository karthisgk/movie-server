package com.movieserver.tv.ui.browse

import android.content.Intent
import android.os.Bundle
import android.view.View
import androidx.leanback.app.BrowseSupportFragment
import androidx.leanback.widget.*
import androidx.lifecycle.lifecycleScope
import com.movieserver.tv.MovieApp
import com.movieserver.tv.R
import com.movieserver.tv.data.model.Movie
import com.movieserver.tv.data.repository.MovieRepository
import com.movieserver.tv.ui.player.PlayerActivity
import com.movieserver.tv.ui.settings.SettingsActivity
import kotlinx.coroutines.launch

/**
 * Main browse screen for the Android TV app.
 * Uses Leanback's BrowseSupportFragment to display movies in horizontal rows,
 * categorized by status (Ready, Processing, All).
 */
class BrowseFragment : BrowseSupportFragment() {

    private lateinit var repository: MovieRepository
    private lateinit var rowsAdapter: ArrayObjectAdapter

    override fun onCreate(savedInstanceState: Bundle?) {
        super.onCreate(savedInstanceState)

        val app = requireActivity().application as MovieApp
        repository = MovieRepository(app.serverUrlManager)

        setupUI()
        loadMovies()
    }

    private fun setupUI() {
        title = getString(R.string.app_name)
        headersState = HEADERS_ENABLED
        isHeadersTransitionOnBackEnabled = true
        brandColor = requireContext().getColor(R.color.brand_color)
        searchAffordanceColor = requireContext().getColor(R.color.accent_color)

        // Settings gear icon in the top-right
        setOnSearchClickedListener {
            startActivity(Intent(requireContext(), SettingsActivity::class.java))
        }

        rowsAdapter = ArrayObjectAdapter(ListRowPresenter())
        adapter = rowsAdapter

        // Item click → launch player or settings
        onItemViewClickedListener = OnItemViewClickedListener { _, item, _, _ ->
            if (item is Movie && item.isPlayable) {
                val intent = Intent(requireContext(), PlayerActivity::class.java).apply {
                    putExtra(PlayerActivity.EXTRA_MOVIE_ID, item.id)
                    putExtra(PlayerActivity.EXTRA_MOVIE_TITLE, item.title)
                }
                startActivity(intent)
            } else if (item is SettingsItem) {
                startActivity(Intent(requireContext(), SettingsActivity::class.java))
            }
        }
    }

    override fun onResume() {
        super.onResume()
        loadMovies()
    }

    private fun loadMovies() {
        lifecycleScope.launch {
            try {
                val movies = repository.getMovies()
                buildRows(movies)
            } catch (t: Throwable) {
                showError(t.message ?: t.toString())
            }
        }
    }

    private fun buildRows(movies: List<Movie>) {
        rowsAdapter.clear()

        val presenter = MovieCardPresenter()

        // Row 1: Ready to watch
        val readyMovies = movies.filter { it.status == "ready" || it.status == "partial" }
        if (readyMovies.isNotEmpty()) {
            val readyAdapter = ArrayObjectAdapter(presenter)
            readyMovies.forEach { readyAdapter.add(it) }
            rowsAdapter.add(ListRow(HeaderItem(0, getString(R.string.category_ready)), readyAdapter))
        }

        // Row 2: Processing / Queued
        val processingMovies = movies.filter {
            it.status == "processing" || it.status == "queued" || it.status == "discovered"
        }
        if (processingMovies.isNotEmpty()) {
            val processingAdapter = ArrayObjectAdapter(presenter)
            processingMovies.forEach { processingAdapter.add(it) }
            rowsAdapter.add(ListRow(HeaderItem(1, getString(R.string.category_processing)), processingAdapter))
        }

        // Row 3: Failed
        val failedMovies = movies.filter { it.status == "failed" }
        if (failedMovies.isNotEmpty()) {
            val failedAdapter = ArrayObjectAdapter(presenter)
            failedMovies.forEach { failedAdapter.add(it) }
            rowsAdapter.add(ListRow(HeaderItem(2, getString(R.string.category_failed)), failedAdapter))
        }

        // Row 4: Settings row
        val settingsPresenter = SettingsItemPresenter()
        val settingsAdapter = ArrayObjectAdapter(settingsPresenter)
        settingsAdapter.add(SettingsItem(getString(R.string.settings_title)))
        rowsAdapter.add(ListRow(HeaderItem(3, getString(R.string.category_settings)), settingsAdapter))
    }

    private fun showError(message: String) {
        // In a real app, show an error card / toast
        // For now, add an error row
        rowsAdapter.clear()
        val presenter = ErrorPresenter()
        val adapter = ArrayObjectAdapter(presenter)
        adapter.add(message)
        rowsAdapter.add(ListRow(HeaderItem(0, "Connection Error"), adapter))
    }
}

/** Simple wrapper for the settings item */
data class SettingsItem(val label: String)

/** Presenter for the settings item */
class SettingsItemPresenter : Presenter() {
    override fun onCreateViewHolder(parent: android.view.ViewGroup): ViewHolder {
        val view = android.widget.TextView(parent.context).apply {
            setTextColor(android.graphics.Color.WHITE)
            textSize = 18f
            setPadding(32, 32, 32, 32)
            background = parent.context.getDrawable(R.drawable.card_background)
            isFocusable = true
            isFocusableInTouchMode = true
        }
        return ViewHolder(view)
    }

    override fun onBindViewHolder(viewHolder: ViewHolder, item: Any?) {
        (viewHolder.view as android.widget.TextView).text = (item as SettingsItem).label
    }

    override fun onUnbindViewHolder(viewHolder: ViewHolder) {}
}

/** Presenter for error messages */
class ErrorPresenter : Presenter() {
    override fun onCreateViewHolder(parent: android.view.ViewGroup): ViewHolder {
        val view = android.widget.TextView(parent.context).apply {
            setTextColor(android.graphics.Color.RED)
            textSize = 16f
            setPadding(32, 32, 32, 32)
        }
        return ViewHolder(view)
    }

    override fun onBindViewHolder(viewHolder: ViewHolder, item: Any?) {
        (viewHolder.view as android.widget.TextView).text = item as? String
    }

    override fun onUnbindViewHolder(viewHolder: ViewHolder) {}
}
