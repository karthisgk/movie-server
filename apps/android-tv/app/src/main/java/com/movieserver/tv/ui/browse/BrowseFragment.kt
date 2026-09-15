package com.movieserver.tv.ui.browse

import android.content.Intent
import android.os.Bundle
import android.view.Gravity
import android.view.ViewGroup
import android.widget.LinearLayout
import android.widget.TextView
import android.widget.Toast
import androidx.leanback.app.BrowseSupportFragment
import androidx.leanback.widget.*
import androidx.lifecycle.lifecycleScope
import com.movieserver.tv.MovieApp
import com.movieserver.tv.R
import com.movieserver.tv.data.api.MovieApiClient
import com.movieserver.tv.data.model.Movie
import com.movieserver.tv.data.repository.MovieRepository
import com.movieserver.tv.ui.player.PlayerActivity
import com.movieserver.tv.ui.settings.SettingsActivity
import com.movieserver.tv.utils.ServerUrlManager
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.joinAll
import kotlinx.coroutines.launch
import kotlinx.coroutines.withContext

data class ServerCardItem(
    val serverUrl: String,
    val isActive: Boolean,
    val isReachable: Boolean,
    val isChecking: Boolean = false
)

data class RefreshItem(val label: String = "🔄 Refresh Servers")

/**
 * Main browse screen for the Android TV app.
 * Displays movies in horizontal rows and includes a Netflix profile-style Server Switcher row.
 */
class BrowseFragment : BrowseSupportFragment() {

    private lateinit var repository: MovieRepository
    private lateinit var serverUrlManager: ServerUrlManager
    private lateinit var rowsAdapter: ArrayObjectAdapter

    override fun onCreate(savedInstanceState: Bundle?) {
        super.onCreate(savedInstanceState)

        val app = requireActivity().application as MovieApp
        serverUrlManager = app.serverUrlManager
        repository = MovieRepository(serverUrlManager)

        setupUI()
    }

    override fun onViewCreated(view: android.view.View, savedInstanceState: Bundle?) {
        super.onViewCreated(view, savedInstanceState)
        progressBarManager.setRootView(view as ViewGroup)
        progressBarManager.enableProgressBar()
        progressBarManager.setInitialDelay(0)
    }

    private fun setupUI() {
        title = "${getString(R.string.app_name)} (${serverUrlManager.serverUrl})"
        headersState = HEADERS_ENABLED
        isHeadersTransitionOnBackEnabled = true
        brandColor = requireContext().getColor(R.color.brand_color)
        searchAffordanceColor = requireContext().getColor(R.color.accent_color)

        // Settings gear icon in top-right
        setOnSearchClickedListener {
            startActivity(Intent(requireContext(), SettingsActivity::class.java))
        }

        rowsAdapter = ArrayObjectAdapter(ListRowPresenter())
        adapter = rowsAdapter

        // Item click handler (Movies, Server Cards, Refresh, Settings)
        onItemViewClickedListener = OnItemViewClickedListener { _, item, _, _ ->
            when (item) {
                is Movie -> {
                    if (item.isPlayable) {
                        val intent = Intent(requireContext(), PlayerActivity::class.java).apply {
                            putExtra(PlayerActivity.EXTRA_MOVIE_ID, item.id)
                            putExtra(PlayerActivity.EXTRA_MOVIE_TITLE, item.title)
                        }
                        startActivity(intent)
                    }
                }
                is ServerCardItem -> {
                    if (item.isReachable || item.isChecking) {
                        if (item.isActive) {
                            Toast.makeText(requireContext(), "Already connected to ${item.serverUrl}", Toast.LENGTH_SHORT).show()
                        } else {
                            serverUrlManager.serverUrl = item.serverUrl
                            MovieApiClient.rebuild()
                            repository = MovieRepository(serverUrlManager)
                            title = "${getString(R.string.app_name)} (${item.serverUrl})"
                            Toast.makeText(requireContext(), "Switched to ${item.serverUrl}", Toast.LENGTH_SHORT).show()
                            loadMovies()
                        }
                    } else {
                        Toast.makeText(requireContext(), "Server ${item.serverUrl} is offline/unreachable", Toast.LENGTH_SHORT).show()
                    }
                }
                is RefreshItem -> {
                    Toast.makeText(requireContext(), "Refreshing server statuses...", Toast.LENGTH_SHORT).show()
                    loadMovies()
                }
                is SettingsItem -> {
                    startActivity(Intent(requireContext(), SettingsActivity::class.java))
                }
            }
        }
    }

    override fun onResume() {
        super.onResume()
        title = "${getString(R.string.app_name)} (${serverUrlManager.serverUrl})"
        loadMovies()
    }

    private fun loadMovies() {
        // Display loading spinner instead of blank screen
        progressBarManager.show()

        lifecycleScope.launch {
            try {
                var currentUrl = serverUrlManager.serverUrl
                val isReachable = withContext(Dispatchers.IO) { ServerUrlManager.checkHealth(currentUrl) }

                if (!isReachable) {
                    val firstAvailable = serverUrlManager.findFirstAvailableServer()
                    if (firstAvailable != null && firstAvailable != currentUrl) {
                        serverUrlManager.serverUrl = firstAvailable
                        MovieApiClient.rebuild()
                        repository = MovieRepository(serverUrlManager)
                        currentUrl = firstAvailable
                        Toast.makeText(requireContext(), "Auto-connected to $firstAvailable", Toast.LENGTH_SHORT).show()
                    } else {
                        showError("connected server is inactive")
                        return@launch
                    }
                }

                title = "${getString(R.string.app_name)} ($currentUrl)"
                val movies = repository.getMovies()
                buildRows(movies)
            } catch (t: Throwable) {
                val firstAvailable = serverUrlManager.findFirstAvailableServer()
                if (firstAvailable != null) {
                    serverUrlManager.serverUrl = firstAvailable
                    MovieApiClient.rebuild()
                    repository = MovieRepository(serverUrlManager)
                    title = "${getString(R.string.app_name)} ($firstAvailable)"
                    try {
                        val movies = repository.getMovies()
                        buildRows(movies)
                        Toast.makeText(requireContext(), "Auto-connected to $firstAvailable", Toast.LENGTH_SHORT).show()
                        return@launch
                    } catch (_: Exception) {}
                }
                showError("connected server is inactive")
            }
        }
    }

    private fun buildRows(movies: List<Movie>) {
        progressBarManager.hide()
        rowsAdapter.clear()

        var headerId = 0
        val presenter = MovieCardPresenter()

        // Row 1: Ready to watch
        val readyMovies = movies.filter { it.status == "ready" || it.status == "partial" }
        if (readyMovies.isNotEmpty()) {
            val readyAdapter = ArrayObjectAdapter(presenter)
            readyMovies.forEach { readyAdapter.add(it) }
            rowsAdapter.add(ListRow(HeaderItem(headerId++.toLong(), getString(R.string.category_ready)), readyAdapter))
        }

        // Row 2: Processing / Queued
        val processingMovies = movies.filter {
            it.status == "processing" || it.status == "queued" || it.status == "discovered"
        }
        if (processingMovies.isNotEmpty()) {
            val processingAdapter = ArrayObjectAdapter(presenter)
            processingMovies.forEach { processingAdapter.add(it) }
            rowsAdapter.add(ListRow(HeaderItem(headerId++.toLong(), getString(R.string.category_processing)), processingAdapter))
        }

        // Row 3: Failed
        val failedMovies = movies.filter { it.status == "failed" }
        if (failedMovies.isNotEmpty()) {
            val failedAdapter = ArrayObjectAdapter(presenter)
            failedMovies.forEach { failedAdapter.add(it) }
            rowsAdapter.add(ListRow(HeaderItem(headerId++.toLong(), getString(R.string.category_failed)), failedAdapter))
        }

        // Row 4: Netflix-style Server Switcher row (Print list FIRST, then stream per-item health status)
        val serverAdapter = ArrayObjectAdapter(ServerCardPresenter())
        val savedServers = serverUrlManager.getSavedServers()
        val activeUrl = serverUrlManager.serverUrl

        val initialItems = savedServers.map { url ->
            ServerCardItem(url, isActive = (url == activeUrl), isReachable = false, isChecking = true)
        }.toMutableList()
        initialItems.forEach { serverAdapter.add(it) }
        rowsAdapter.add(ListRow(HeaderItem(headerId++.toLong(), "🖥️ Switch Server"), serverAdapter))

        // Asynchronously check health and update server status badges IMMEDIATELY as each finishes
        lifecycleScope.launch(Dispatchers.Main) {
            val jobs = savedServers.mapIndexed { index, url ->
                launch(Dispatchers.IO) {
                    val isReachable = ServerUrlManager.checkHealth(url)
                    withContext(Dispatchers.Main) {
                        val updated = ServerCardItem(url, isActive = (url == activeUrl), isReachable = isReachable, isChecking = false)
                        initialItems[index] = updated
                        if (index < serverAdapter.size()) {
                            serverAdapter.replace(index, updated)
                        }
                    }
                }
            }

            jobs.joinAll()
            val activeCount = initialItems.count { it.isReachable || it.isActive }
            if (activeCount == 0) {
                serverAdapter.add(RefreshItem("🔄 Refresh Servers"))
                serverAdapter.add(SettingsItem("⚙️ Add / Connect Custom Server"))
            }

            val sortedList = initialItems.sortedWith(
                compareByDescending<ServerCardItem> { it.isActive }
                    .thenByDescending { it.isReachable }
            )
            serverAdapter.clear()
            sortedList.forEach { serverAdapter.add(it) }
            if (activeCount == 0) {
                serverAdapter.add(RefreshItem("🔄 Refresh Servers"))
                serverAdapter.add(SettingsItem("⚙️ Add / Connect Custom Server"))
            }
        }

        // Row 5: Settings row
        val settingsPresenter = SettingsItemPresenter()
        val settingsAdapter = ArrayObjectAdapter(settingsPresenter)
        settingsAdapter.add(SettingsItem(getString(R.string.settings_title)))
        rowsAdapter.add(ListRow(HeaderItem(headerId.toLong(), getString(R.string.category_settings)), settingsAdapter))
    }

    private fun showError(message: String) {
        progressBarManager.hide()
        rowsAdapter.clear()
        val errorPresenter = ErrorPresenter()
        val errorAdapter = ArrayObjectAdapter(errorPresenter)

        val currentServer = serverUrlManager.serverUrl
        title = "${getString(R.string.app_name)} ($currentServer - connected server is inactive)"

        errorAdapter.add("connected server is inactive ($currentServer)")
        errorAdapter.add(RefreshItem("🔄 Refresh Servers"))
        errorAdapter.add(SettingsItem("⚙️ Add / Connect Custom Server"))
        rowsAdapter.add(ListRow(HeaderItem(0, "connected server is inactive"), errorAdapter))

        val serverAdapter = ArrayObjectAdapter(ServerCardPresenter())
        val savedServers = serverUrlManager.getSavedServers()
        val activeUrl = serverUrlManager.serverUrl
        val initialItems = savedServers.map { url ->
            ServerCardItem(url, isActive = (url == activeUrl), isReachable = false, isChecking = true)
        }.toMutableList()
        initialItems.forEach { serverAdapter.add(it) }
        rowsAdapter.add(ListRow(HeaderItem(1, "🖥️ Switch Server"), serverAdapter))

        lifecycleScope.launch(Dispatchers.Main) {
            val jobs = savedServers.mapIndexed { index, url ->
                launch(Dispatchers.IO) {
                    val isReachable = ServerUrlManager.checkHealth(url)
                    withContext(Dispatchers.Main) {
                        val updated = ServerCardItem(url, isActive = (url == activeUrl), isReachable = isReachable, isChecking = false)
                        initialItems[index] = updated
                        if (index < serverAdapter.size()) {
                            serverAdapter.replace(index, updated)
                        }
                    }
                }
            }

            jobs.joinAll()
            val sortedList = initialItems.sortedWith(
                compareByDescending<ServerCardItem> { it.isActive }
                    .thenByDescending { it.isReachable }
            )
            serverAdapter.clear()
            sortedList.forEach { serverAdapter.add(it) }
            serverAdapter.add(RefreshItem("🔄 Refresh Servers"))
            serverAdapter.add(SettingsItem("⚙️ Add / Connect Custom Server"))
        }

        val settingsPresenter = SettingsItemPresenter()
        val settingsAdapter = ArrayObjectAdapter(settingsPresenter)
        settingsAdapter.add(SettingsItem(getString(R.string.settings_title)))
        settingsAdapter.add(SettingsItem("⚙️ Add / Connect Custom Server"))
        rowsAdapter.add(ListRow(HeaderItem(2, getString(R.string.category_settings)), settingsAdapter))
    }
}

/** Presenter for Netflix profile-style Server Cards */
class ServerCardPresenter : Presenter() {
    override fun onCreateViewHolder(parent: ViewGroup): ViewHolder {
        val container = LinearLayout(parent.context).apply {
            orientation = LinearLayout.VERTICAL
            gravity = Gravity.CENTER
            setPadding(24, 20, 24, 20)
            layoutParams = ViewGroup.LayoutParams(220.toPx(parent.context), 130.toPx(parent.context))
            background = parent.context.getDrawable(R.drawable.saved_server_item_bg)
            isFocusable = true
            isFocusableInTouchMode = true
        }

        val topRow = LinearLayout(parent.context).apply {
            orientation = LinearLayout.HORIZONTAL
            gravity = Gravity.CENTER_VERTICAL
            layoutParams = LinearLayout.LayoutParams(
                LinearLayout.LayoutParams.MATCH_PARENT,
                LinearLayout.LayoutParams.WRAP_CONTENT
            )
        }

        val tvIcon = TextView(parent.context).apply {
            text = "🖥️"
            textSize = 20f
        }
        topRow.addView(tvIcon)

        val tvBadge = TextView(parent.context).apply {
            tag = "tv_badge"
            textSize = 11f
            setTypeface(null, android.graphics.Typeface.BOLD)
            setPadding(12, 4, 12, 4)
            layoutParams = LinearLayout.LayoutParams(
                LinearLayout.LayoutParams.MATCH_PARENT,
                LinearLayout.LayoutParams.WRAP_CONTENT
            ).apply { gravity = Gravity.END }
        }
        topRow.addView(tvBadge)
        container.addView(topRow)

        val tvUrl = TextView(parent.context).apply {
            tag = "tv_url"
            setTextColor(android.graphics.Color.WHITE)
            textSize = 13f
            typeface = android.graphics.Typeface.MONOSPACE
            maxLines = 2
            ellipsize = android.text.TextUtils.TruncateAt.MIDDLE
            setPadding(0, 12, 0, 8)
        }
        container.addView(tvUrl)

        val tvHint = TextView(parent.context).apply {
            tag = "tv_hint"
            textSize = 10f
            setTextColor(android.graphics.Color.parseColor("#88FFFFFF"))
        }
        container.addView(tvHint)

        container.setOnFocusChangeListener { v, hasFocus ->
            if (hasFocus) {
                v.animate().scaleX(1.06f).scaleY(1.06f).setDuration(120).start()
                tvUrl.setTextColor(android.graphics.Color.parseColor("#FFEB3B"))  // Yellow
                tvUrl.setTypeface(android.graphics.Typeface.MONOSPACE, android.graphics.Typeface.BOLD)
            } else {
                v.animate().scaleX(1.0f).scaleY(1.0f).setDuration(120).start()
                tvUrl.setTextColor(android.graphics.Color.WHITE)
                tvUrl.setTypeface(android.graphics.Typeface.MONOSPACE, android.graphics.Typeface.NORMAL)
            }
        }

        return ViewHolder(container)
    }

    override fun onBindViewHolder(viewHolder: ViewHolder, item: Any?) {
        val serverItem = item as? ServerCardItem
        if (serverItem == null) {
            val root = viewHolder.view as LinearLayout
            val tvUrl = root.findViewWithTag<TextView>("tv_url")
            val tvBadge = root.findViewWithTag<TextView>("tv_badge")
            val tvHint = root.findViewWithTag<TextView>("tv_hint")

            when (item) {
                is RefreshItem -> {
                    tvUrl.text = item.label
                    tvBadge.text = "REFRESH"
                    tvBadge.setTextColor(android.graphics.Color.parseColor("#FFC107"))
                    tvHint.text = "Click to re-scan"
                }
                is SettingsItem -> {
                    tvUrl.text = item.label
                    tvBadge.text = "SETTINGS"
                    tvBadge.setTextColor(android.graphics.Color.parseColor("#4CAF50"))
                    tvHint.text = "Connect custom host"
                }
            }
            root.alpha = 1.0f
            root.isFocusable = true
            return
        }

        val root = viewHolder.view as LinearLayout
        val tvUrl = root.findViewWithTag<TextView>("tv_url")
        val tvBadge = root.findViewWithTag<TextView>("tv_badge")
        val tvHint = root.findViewWithTag<TextView>("tv_hint")

        tvUrl.text = serverItem.serverUrl.removePrefix("http://").removePrefix("https://")

        when {
            serverItem.isChecking -> {
                tvBadge.text = "⏳ CHECKING"
                tvBadge.setTextColor(android.graphics.Color.parseColor("#FFC107"))
                tvHint.text = "Checking..."
                root.alpha = 1.0f
                root.isFocusable = true
            }
            serverItem.isActive -> {
                tvBadge.text = "● CONNECTED"
                tvBadge.setTextColor(android.graphics.Color.parseColor("#4CAF50"))
                tvHint.text = "Active Server"
                root.alpha = 1.0f
                root.isFocusable = true
            }
            serverItem.isReachable -> {
                tvBadge.text = "● ACTIVE"
                tvBadge.setTextColor(android.graphics.Color.parseColor("#81C784"))
                tvHint.text = "Tap to switch"
                root.alpha = 1.0f
                root.isFocusable = true
            }
            else -> {
                tvBadge.text = "○ INACTIVE"
                tvBadge.setTextColor(android.graphics.Color.parseColor("#E57373"))
                tvHint.text = "Offline"
                root.alpha = 0.45f
                root.isFocusable = false
            }
        }
    }

    override fun onUnbindViewHolder(viewHolder: ViewHolder) {}

    private fun Int.toPx(context: android.content.Context): Int {
        return (this * context.resources.displayMetrics.density).toInt()
    }
}

/** Presenter for settings item */
class SettingsItemPresenter : Presenter() {
    override fun onCreateViewHolder(parent: ViewGroup): ViewHolder {
        val textView = TextView(parent.context).apply {
            setTextColor(android.graphics.Color.WHITE)
            textSize = 18f
            setPadding(32, 32, 32, 32)
            background = parent.context.getDrawable(R.drawable.btn_action_selector)
            isFocusable = true
            isFocusableInTouchMode = true
        }

        textView.setOnFocusChangeListener { _, hasFocus ->
            if (hasFocus) {
                textView.animate().scaleX(1.04f).scaleY(1.04f).setDuration(120).start()
                textView.setTextColor(android.graphics.Color.YELLOW)
            } else {
                textView.animate().scaleX(1.0f).scaleY(1.0f).setDuration(120).start()
                textView.setTextColor(android.graphics.Color.WHITE)
            }
        }
        return ViewHolder(textView)
    }

    override fun onBindViewHolder(viewHolder: ViewHolder, item: Any?) {
        val tv = (viewHolder.view as? TextView)
            ?: (viewHolder.view as? ViewGroup)?.findViewById(android.R.id.text1)
            ?: (viewHolder.view as? ViewGroup)?.getChildAt(0) as? TextView
        tv?.text = (item as? SettingsItem)?.label
    }

    override fun onUnbindViewHolder(viewHolder: ViewHolder) {}
}

/** Presenter for error messages */
class ErrorPresenter : Presenter() {
    override fun onCreateViewHolder(parent: ViewGroup): ViewHolder {
        val view = TextView(parent.context).apply {
            setTextColor(android.graphics.Color.parseColor("#FF5252"))
            textSize = 16f
            setPadding(32, 32, 32, 32)
        }
        return ViewHolder(view)
    }

    override fun onBindViewHolder(viewHolder: ViewHolder, item: Any?) {
        val tv = (viewHolder.view as? TextView)
            ?: (viewHolder.view as? ViewGroup)?.getChildAt(0) as? TextView
        when (item) {
            is RefreshItem -> {
                tv?.text = item.label
                tv?.setTextColor(android.graphics.Color.YELLOW)
            }
            is SettingsItem -> {
                tv?.text = item.label
                tv?.setTextColor(android.graphics.Color.parseColor("#81C784"))
            }
            else -> {
                tv?.text = item as? String
            }
        }
    }

    override fun onUnbindViewHolder(viewHolder: ViewHolder) {}
}

/** Data wrapper for Settings item */
data class SettingsItem(val label: String)
