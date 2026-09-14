package com.movieserver.tv

import android.os.Bundle
import androidx.fragment.app.FragmentActivity
import com.movieserver.tv.ui.browse.BrowseFragment

/**
 * Main entry point for the Android TV app.
 * Hosts the BrowseFragment as the home screen.
 */
class MainActivity : FragmentActivity() {

    override fun onCreate(savedInstanceState: Bundle?) {
        super.onCreate(savedInstanceState)
        setContentView(R.layout.activity_main)

        if (savedInstanceState == null) {
            supportFragmentManager.beginTransaction()
                .replace(R.id.main_browse_fragment, BrowseFragment())
                .commitNow()
        }
    }
}
