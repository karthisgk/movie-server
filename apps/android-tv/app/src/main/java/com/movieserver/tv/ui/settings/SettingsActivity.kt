package com.movieserver.tv.ui.settings

import android.net.Uri
import android.os.Bundle
import android.view.Gravity
import android.view.View
import android.widget.*
import androidx.fragment.app.FragmentActivity
import androidx.lifecycle.lifecycleScope
import com.movieserver.tv.MovieApp
import com.movieserver.tv.R
import com.movieserver.tv.data.api.MovieApiClient
import com.movieserver.tv.utils.ServerUrlManager
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.joinAll
import kotlinx.coroutines.launch
import kotlinx.coroutines.withContext

data class ServerHealthItem(
    val serverUrl: String,
    val isReachable: Boolean,
    val isCurrentActive: Boolean,
    val isChecking: Boolean = false
)

/**
 * Settings Activity for configuring server connection and switching saved servers.
 * Implements real-time per-item status badge updates as soon as each health check completes.
 */
class SettingsActivity : FragmentActivity() {

    private lateinit var cbAdvancedEdit: CheckBox
    private lateinit var layoutStandardInputs: View
    private lateinit var layoutAdvancedInput: View

    private lateinit var tvIpPrefix: TextView
    private lateinit var etIpLastOctet: EditText
    private lateinit var btnIpUp: Button
    private lateinit var btnIpDown: Button
    private lateinit var etPort: EditText
    private lateinit var etFullUrl: EditText

    private lateinit var btnConnect: Button
    private lateinit var btnSaveConnect: Button
    private lateinit var btnCancel: Button
    private lateinit var btnRefreshServers: Button

    private lateinit var tvHealthStatus: TextView
    private lateinit var layoutSavedServersList: LinearLayout

    private lateinit var serverUrlManager: ServerUrlManager

    override fun onCreate(savedInstanceState: Bundle?) {
        super.onCreate(savedInstanceState)
        setContentView(R.layout.activity_settings)

        val app = application as MovieApp
        serverUrlManager = app.serverUrlManager

        bindViews()
        initCurrentValues()
        setupListeners()
        renderSavedServersList()
    }

    private fun bindViews() {
        cbAdvancedEdit        = findViewById(R.id.cb_advanced_edit)
        layoutStandardInputs  = findViewById(R.id.layout_standard_inputs)
        layoutAdvancedInput    = findViewById(R.id.layout_advanced_input)
        tvIpPrefix            = findViewById(R.id.tv_ip_prefix)
        etIpLastOctet         = findViewById(R.id.et_ip_last_octet)
        btnIpUp               = findViewById(R.id.btn_ip_up)
        btnIpDown             = findViewById(R.id.btn_ip_down)
        etPort                = findViewById(R.id.et_port)
        etFullUrl             = findViewById(R.id.et_full_url)
        btnConnect            = findViewById(R.id.btn_connect)
        btnSaveConnect        = findViewById(R.id.btn_save_connect)
        btnCancel             = findViewById(R.id.btn_cancel)
        btnRefreshServers     = findViewById(R.id.btn_refresh_servers)
        tvHealthStatus        = findViewById(R.id.tv_healthcheck_status)
        layoutSavedServersList = findViewById(R.id.layout_saved_servers_list)
    }

    private fun initCurrentValues() {
        val currentUrl = serverUrlManager.serverUrl
        etFullUrl.setText(currentUrl)

        try {
            val uri = Uri.parse(currentUrl)
            val host = uri.host ?: serverUrlManager.host
            val port = if (uri.port > 0) uri.port else serverUrlManager.port
            etPort.setText(port.toString())

            val lastDotIdx = host.lastIndexOf('.')
            if (lastDotIdx != -1) {
                val prefix = "http://" + host.substring(0, lastDotIdx + 1)
                val octet = host.substring(lastDotIdx + 1)
                tvIpPrefix.text = prefix
                etIpLastOctet.setText(octet)
            } else {
                tvIpPrefix.text = "http://192.168.0."
                etIpLastOctet.setText("10")
            }
        } catch (e: Exception) {
            tvIpPrefix.text = "http://192.168.0."
            etIpLastOctet.setText("10")
            etPort.setText("5000")
        }
    }

    private fun setupListeners() {
        setupFocusListeners(btnConnect, btnSaveConnect, btnCancel, btnIpUp, btnIpDown, btnRefreshServers)

        btnRefreshServers.setOnClickListener {
            renderSavedServersList()
        }

        cbAdvancedEdit.setOnCheckedChangeListener { _, isChecked ->
            if (isChecked) {
                layoutStandardInputs.visibility = View.GONE
                layoutAdvancedInput.visibility = View.VISIBLE
                getConstructedUrlFromStandard()?.let { etFullUrl.setText(it) }
            } else {
                layoutStandardInputs.visibility = View.VISIBLE
                layoutAdvancedInput.visibility = View.GONE
                parseAndApplyAdvancedToStandard()
            }
        }

        btnIpUp.setOnClickListener {
            val current = etIpLastOctet.text.toString().toIntOrNull() ?: 0
            val next = (current + 1).coerceAtMost(255)
            etIpLastOctet.setText(next.toString())
        }

        btnIpDown.setOnClickListener {
            val current = etIpLastOctet.text.toString().toIntOrNull() ?: 0
            val prev = (current - 1).coerceAtLeast(0)
            etIpLastOctet.setText(prev.toString())
        }

        btnConnect.setOnClickListener {
            val targetUrl = getTargetServerUrl() ?: return@setOnClickListener
            connectToServer(targetUrl, saveToSavedList = false)
        }

        btnSaveConnect.setOnClickListener {
            val targetUrl = getTargetServerUrl() ?: return@setOnClickListener
            connectToServer(targetUrl, saveToSavedList = true)
        }

        btnCancel.setOnClickListener {
            finish()
        }
    }

    private fun setupFocusListeners(vararg views: View) {
        views.forEach { view ->
            view.setOnFocusChangeListener { v, hasFocus ->
                if (hasFocus) {
                    v.animate().scaleX(1.04f).scaleY(1.04f).setDuration(120).start()
                    if (v is Button) v.setTextColor(android.graphics.Color.YELLOW)
                } else {
                    v.animate().scaleX(1.0f).scaleY(1.0f).setDuration(120).start()
                    if (v is Button) v.setTextColor(android.graphics.Color.WHITE)
                }
            }
        }
    }

    private fun parseAndApplyAdvancedToStandard() {
        val raw = etFullUrl.text.toString().trim()
        if (ServerUrlManager.isValidServerUrl(raw)) {
            val normalized = ServerUrlManager.normalizeUrl(raw)
            try {
                val uri = Uri.parse(normalized)
                val host = uri.host ?: return
                val port = if (uri.port > 0) uri.port else 5000
                etPort.setText(port.toString())
                val lastDotIdx = host.lastIndexOf('.')
                if (lastDotIdx != -1) {
                    tvIpPrefix.text = "http://" + host.substring(0, lastDotIdx + 1)
                    etIpLastOctet.setText(host.substring(lastDotIdx + 1))
                }
            } catch (_: Exception) {}
        }
    }

    private fun getConstructedUrlFromStandard(): String? {
        val octetStr = etIpLastOctet.text.toString().trim()
        val octet = octetStr.toIntOrNull()
        if (octet == null || octet < 0 || octet > 255) {
            etIpLastOctet.error = "Must be 0-255"
            return null
        }

        val portStr = etPort.text.toString().trim()
        val port = portStr.toIntOrNull()
        if (port == null || port < 1 || port > 65535) {
            etPort.error = "Must be 1-65535"
            return null
        }

        val prefix = tvIpPrefix.text.toString().trim()
        return "$prefix$octet:$port"
    }

    private fun getTargetServerUrl(): String? {
        if (cbAdvancedEdit.isChecked) {
            val raw = etFullUrl.text.toString().trim()
            if (!ServerUrlManager.isValidServerUrl(raw)) {
                etFullUrl.error = "Invalid URL (format: http://ip:port)"
                return null
            }
            return ServerUrlManager.normalizeUrl(raw)
        } else {
            val constructed = getConstructedUrlFromStandard() ?: return null
            if (!ServerUrlManager.isValidServerUrl(constructed)) {
                Toast.makeText(this, "Invalid IP or Port", Toast.LENGTH_SHORT).show()
                return null
            }
            return ServerUrlManager.normalizeUrl(constructed)
        }
    }

    private fun connectToServer(targetUrl: String, saveToSavedList: Boolean) {
        if (saveToSavedList) {
            serverUrlManager.addSavedServer(targetUrl)
        }
        serverUrlManager.serverUrl = targetUrl
        MovieApiClient.rebuild()

        val msg = if (saveToSavedList) "Saved & Connected: $targetUrl" else "Connected: $targetUrl"
        Toast.makeText(this, msg, Toast.LENGTH_SHORT).show()
        finish()
    }

    private fun renderSavedServersList() {
        val savedServers = serverUrlManager.getSavedServers()
        val activeUrl = serverUrlManager.serverUrl

        tvHealthStatus.text = "Checking server statuses in real-time..."

        // Initial items list (printed 0ms immediately)
        val serverItems = savedServers.map { url ->
            ServerHealthItem(
                serverUrl = url,
                isReachable = false,
                isCurrentActive = (url == activeUrl),
                isChecking = true
            )
        }.toMutableList()

        displayServerCards(serverItems)

        // Launch concurrent per-item health checks that update badges IMMEDIATELY as each finishes
        lifecycleScope.launch(Dispatchers.Main) {
            val jobs = savedServers.mapIndexed { index, url ->
                launch(Dispatchers.IO) {
                    val isReachable = ServerUrlManager.checkHealth(url)
                    withContext(Dispatchers.Main) {
                        // Real-time per-item badge update on completion
                        val updated = ServerHealthItem(
                            serverUrl = url,
                            isReachable = isReachable,
                            isCurrentActive = (url == activeUrl),
                            isChecking = false
                        )
                        serverItems[index] = updated
                        updateSingleCardView(index, updated)
                    }
                }
            }

            // After ALL health checks finish, re-sort so active servers rise to top
            jobs.joinAll()
            val activeCount = serverItems.count { it.isReachable || it.isCurrentActive }
            val currentItem = serverItems.find { it.serverUrl == activeUrl }

            if (currentItem != null && !currentItem.isReachable) {
                tvHealthStatus.text = "connected server is inactive ($activeUrl)"
                tvHealthStatus.setTextColor(android.graphics.Color.parseColor("#FF5252"))
            } else if (activeCount == 0) {
                tvHealthStatus.text = "⚠️ No active server found"
                tvHealthStatus.setTextColor(android.graphics.Color.parseColor("#FF5252"))
            } else {
                tvHealthStatus.text = "Active servers listed first. Inactive servers are disabled."
                tvHealthStatus.setTextColor(android.graphics.Color.parseColor("#AAFFFFFF"))
            }
            val sortedList = serverItems.sortedWith(
                compareByDescending<ServerHealthItem> { it.isCurrentActive }
                    .thenByDescending { it.isReachable }
            )
            displayServerCards(sortedList)
        }
    }

    private fun updateSingleCardView(index: Int, item: ServerHealthItem) {
        val cardView = layoutSavedServersList.getChildAt(index) as? LinearLayout ?: return
        val tvUrl = cardView.getChildAt(0) as? TextView ?: return
        val tvStatus = cardView.getChildAt(1) as? TextView ?: return

        tvUrl.setTextColor(if (item.isReachable || item.isCurrentActive) android.graphics.Color.WHITE else android.graphics.Color.parseColor("#888888"))

        when {
            item.isCurrentActive -> {
                tvStatus.text = "● CONNECTED"
                tvStatus.setTextColor(android.graphics.Color.parseColor("#4CAF50"))
                tvStatus.setTypeface(null, android.graphics.Typeface.BOLD)
                cardView.alpha = 1.0f
                cardView.isFocusable = true
                cardView.isClickable = true
            }
            item.isReachable -> {
                tvStatus.text = "● ACTIVE"
                tvStatus.setTextColor(android.graphics.Color.parseColor("#81C784"))
                tvStatus.setTypeface(null, android.graphics.Typeface.BOLD)
                cardView.alpha = 1.0f
                cardView.isFocusable = true
                cardView.isClickable = true
            }
            else -> {
                tvStatus.text = "○ INACTIVE"
                tvStatus.setTextColor(android.graphics.Color.parseColor("#E57373"))
                tvStatus.setTypeface(null, android.graphics.Typeface.NORMAL)
                cardView.alpha = 0.45f
                cardView.isFocusable = false
                cardView.isClickable = false
            }
        }
    }

    private fun displayServerCards(servers: List<ServerHealthItem>) {
        layoutSavedServersList.removeAllViews()

        servers.forEach { item ->
            val tvUrl = TextView(this).apply {
                text = item.serverUrl
                setTextColor(if (item.isReachable || item.isCurrentActive || item.isChecking) android.graphics.Color.WHITE else android.graphics.Color.parseColor("#888888"))
                textSize = 15f
                typeface = android.graphics.Typeface.MONOSPACE
                layoutParams = LinearLayout.LayoutParams(0, LinearLayout.LayoutParams.WRAP_CONTENT, 1f)
            }

            val card = LinearLayout(this).apply {
                orientation = LinearLayout.HORIZONTAL
                gravity = Gravity.CENTER_VERTICAL
                setPadding(28, 22, 28, 22)
                background = resources.getDrawable(R.drawable.saved_server_item_bg, theme)

                if (item.isReachable || item.isCurrentActive || item.isChecking) {
                    isFocusable = true
                    isClickable = true
                    alpha = 1.0f
                } else {
                    isFocusable = false
                    isClickable = false
                    alpha = 0.45f
                }

                val params = LinearLayout.LayoutParams(
                    LinearLayout.LayoutParams.MATCH_PARENT,
                    LinearLayout.LayoutParams.WRAP_CONTENT
                )
                params.setMargins(0, 0, 0, 14)
                layoutParams = params
            }

            card.addView(tvUrl)

            // Status Badge
            val tvStatus = TextView(this).apply {
                when {
                    item.isChecking -> {
                        text = "⏳ checking..."
                        setTextColor(android.graphics.Color.parseColor("#FFC107"))
                        textSize = 12f
                    }
                    item.isCurrentActive -> {
                        text = "● CONNECTED"
                        setTextColor(android.graphics.Color.parseColor("#4CAF50"))
                        textSize = 13f
                        setTypeface(null, android.graphics.Typeface.BOLD)
                    }
                    item.isReachable -> {
                        text = "● ACTIVE"
                        setTextColor(android.graphics.Color.parseColor("#81C784"))
                        textSize = 13f
                        setTypeface(null, android.graphics.Typeface.BOLD)
                    }
                    else -> {
                        text = "○ INACTIVE"
                        setTextColor(android.graphics.Color.parseColor("#E57373"))
                        textSize = 12f
                    }
                }
                setPadding(16, 6, 16, 6)
            }
            card.addView(tvStatus)

            // Focus & Click handlers
            card.setOnFocusChangeListener { view, hasFocus ->
                if (hasFocus) {
                    view.animate().scaleX(1.02f).scaleY(1.02f).setDuration(120).start()
                    tvUrl.setTextColor(android.graphics.Color.parseColor("#FFEB3B"))  // Yellow
                    tvUrl.setTypeface(android.graphics.Typeface.MONOSPACE, android.graphics.Typeface.BOLD)
                } else {
                    view.animate().scaleX(1.0f).scaleY(1.0f).setDuration(120).start()
                    tvUrl.setTextColor(if (card.isFocusable) android.graphics.Color.WHITE else android.graphics.Color.parseColor("#888888"))
                    tvUrl.setTypeface(android.graphics.Typeface.MONOSPACE, android.graphics.Typeface.NORMAL)
                }
            }

            card.setOnClickListener {
                if (card.isFocusable) {
                    connectToServer(item.serverUrl, saveToSavedList = false)
                }
            }

            layoutSavedServersList.addView(card)
        }
    }
}
