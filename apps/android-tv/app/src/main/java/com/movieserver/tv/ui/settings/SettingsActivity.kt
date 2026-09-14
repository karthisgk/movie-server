package com.movieserver.tv.ui.settings

import android.os.Bundle
import android.widget.Button
import android.widget.EditText
import android.widget.Toast
import androidx.fragment.app.FragmentActivity
import com.movieserver.tv.MovieApp
import com.movieserver.tv.R
import com.movieserver.tv.data.api.MovieApiClient
import com.movieserver.tv.utils.ServerUrlManager

/**
 * Settings Activity for configuring the server connection.
 *
 * Allows the user to set the server host (IP address) and port.
 * Changes are saved to SharedPreferences and the API client is rebuilt immediately.
 */
class SettingsActivity : FragmentActivity() {

    private lateinit var etHost: EditText
    private lateinit var etPort: EditText
    private lateinit var btnSave: Button
    private lateinit var btnCancel: Button

    private lateinit var serverUrlManager: ServerUrlManager

    override fun onCreate(savedInstanceState: Bundle?) {
        super.onCreate(savedInstanceState)
        setContentView(R.layout.activity_settings)

        val app = application as MovieApp
        serverUrlManager = app.serverUrlManager

        etHost   = findViewById(R.id.et_host)
        etPort   = findViewById(R.id.et_port)
        btnSave  = findViewById(R.id.btn_save)
        btnCancel = findViewById(R.id.btn_cancel)

        // Populate with current values
        etHost.setText(serverUrlManager.host)
        etPort.setText(serverUrlManager.port.toString())

        btnSave.setOnClickListener { saveSettings() }
        btnCancel.setOnClickListener { finish() }
    }

    private fun saveSettings() {
        val host = etHost.text.toString().trim()
        val portStr = etPort.text.toString().trim()

        // Validate host
        if (host.isEmpty()) {
            etHost.error = "Host is required"
            return
        }

        // Validate port
        val port = portStr.toIntOrNull()
        if (port == null || port < 1 || port > 65535) {
            etPort.error = "Port must be between 1 and 65535"
            return
        }

        // Save to SharedPreferences
        serverUrlManager.host = host
        serverUrlManager.port = port

        // Rebuild API client with new URL
        MovieApiClient.rebuild()

        Toast.makeText(
            this,
            "Server set to http://$host:$port",
            Toast.LENGTH_SHORT
        ).show()

        finish()
    }
}
