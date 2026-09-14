package com.movieserver.tv.ui.browse

import android.graphics.drawable.GradientDrawable
import android.view.LayoutInflater
import android.view.View
import android.view.ViewGroup
import android.widget.TextView
import androidx.leanback.widget.Presenter
import com.movieserver.tv.R
import com.movieserver.tv.data.model.Movie

/**
 * Leanback Presenter for movie cards displayed in the browse grid.
 * Each card shows the movie title, resolution badge, duration, and status.
 */
class MovieCardPresenter : Presenter() {

    inner class MovieViewHolder(view: View) : ViewHolder(view) {
        val title: TextView = view.findViewById(R.id.card_title)
        val subtitle: TextView = view.findViewById(R.id.card_subtitle)
        val badge: TextView = view.findViewById(R.id.card_badge)
        val status: TextView = view.findViewById(R.id.card_status)
        val gradientBg: View = view.findViewById(R.id.card_gradient_bg)
    }

    override fun onCreateViewHolder(parent: ViewGroup): ViewHolder {
        val view = LayoutInflater.from(parent.context)
            .inflate(R.layout.item_movie_card, parent, false)
        view.isFocusable = true
        view.isFocusableInTouchMode = true
        return MovieViewHolder(view)
    }

    override fun onBindViewHolder(viewHolder: ViewHolder, item: Any?) {
        val holder = viewHolder as MovieViewHolder
        val movie = item as? Movie ?: return

        holder.title.text = movie.title
        holder.subtitle.text = movie.formattedDuration

        // Resolution badge
        val badge = movie.resolutionBadge
        if (badge != null) {
            holder.badge.visibility = View.VISIBLE
            holder.badge.text = badge
        } else {
            holder.badge.visibility = View.GONE
        }

        // Status indicator
        when (movie.status) {
            "ready"      -> {
                holder.status.text = "▶ Ready"
                holder.status.setTextColor(0xFF4CAF50.toInt())
            }
            "partial"    -> {
                holder.status.text = "▶ Partial"
                holder.status.setTextColor(0xFFFF9800.toInt())
            }
            "processing" -> {
                val progress = movie.transcodingProgress?.toInt() ?: 0
                val profile = movie.transcodingProfile ?: ""
                holder.status.text = "⚙ $profile $progress%"
                holder.status.setTextColor(0xFF2196F3.toInt())
            }
            "queued"     -> {
                holder.status.text = "⏳ Queued"
                holder.status.setTextColor(0xFF9E9E9E.toInt())
            }
            "failed"     -> {
                holder.status.text = "✗ Failed"
                holder.status.setTextColor(0xFFF44336.toInt())
            }
            else         -> {
                holder.status.text = movie.status
                holder.status.setTextColor(0xFF9E9E9E.toInt())
            }
        }

        // Apply a unique gradient background per movie (based on title hash)
        val colors = getGradientColors(movie.title)
        val gradient = GradientDrawable(GradientDrawable.Orientation.TL_BR, colors)
        gradient.cornerRadius = 12f
        holder.gradientBg.background = gradient

        // Dim non-playable cards
        holder.view.alpha = if (movie.isPlayable) 1.0f else 0.6f
    }

    override fun onUnbindViewHolder(viewHolder: ViewHolder) {}

    private fun getGradientColors(seed: String): IntArray {
        val hash = seed.hashCode().toLong() and 0x7FFFFFFF
        val hue1 = (hash % 360).toFloat()
        val hue2 = (hue1 + 40f) % 360f
        val color1 = android.graphics.Color.HSVToColor(floatArrayOf(hue1, 0.6f, 0.35f))
        val color2 = android.graphics.Color.HSVToColor(floatArrayOf(hue2, 0.8f, 0.20f))
        return intArrayOf(color1, color2)
    }
}
