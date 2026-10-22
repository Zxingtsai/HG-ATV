package cn.hongguotv

import android.graphics.Color
import android.graphics.Typeface
import android.view.Gravity
import android.view.KeyEvent
import android.view.View
import android.view.ViewGroup
import android.widget.*
import androidx.media3.common.MediaItem
import androidx.media3.common.MimeTypes
import androidx.media3.common.PlaybackException
import androidx.media3.common.Player
import androidx.media3.datasource.DefaultHttpDataSource
import androidx.media3.exoplayer.ExoPlayer
import androidx.media3.exoplayer.hls.HlsMediaSource
import androidx.media3.ui.AspectRatioFrameLayout
import androidx.media3.ui.PlayerView
import org.json.JSONObject

@androidx.annotation.OptIn(markerClass = [androidx.media3.common.util.UnstableApi::class])
internal class PlaybackController(private val activity: MainActivity, val detail: Detail, var episode: Episode, start: Double) {
    val view = FrameLayout(activity).apply { setBackgroundColor(Color.BLACK); isFocusable = true }
    private val playerView = PlayerView(activity).apply { useController = false; resizeMode = AspectRatioFrameLayout.RESIZE_MODE_FIT; setBackgroundColor(Color.BLACK); setShutterBackgroundColor(Color.BLACK); isFocusable = false }
    private val overlay = LinearLayout(activity).apply { orientation = LinearLayout.VERTICAL; setBackgroundColor(Color.argb(222,10,16,32)); setPadding(d(25),d(14),d(25),d(16)) }
    private val heading = activity.text("",23f).apply { typeface = Typeface.DEFAULT_BOLD; maxLines = 1 }
    private val message = activity.text("正在准备播放…",22f).apply { gravity = Gravity.CENTER; setPadding(d(25),d(22),d(25),d(22)); setBackgroundColor(Color.argb(210,10,16,32)) }
    private val time = activity.text("",18f,activity.muted)
    private val seek = SeekBar(activity).apply { max = 100000; progressTintList = android.content.res.ColorStateList.valueOf(Color.rgb(255,102,89)); thumbTintList = progressTintList; contentDescription = "播放进度，左右键快退快进" }
    private val actions = LinearLayout(activity).apply { orientation = LinearLayout.HORIZONTAL; gravity = Gravity.CENTER_VERTICAL }
    private lateinit var pause: Button
    private lateinit var previous: Button
    private lateinit var next: Button
    private lateinit var retry: Button
    private var player: ExoPlayer? = null
    @Volatile private var closed = false
    @Volatile private var sessionId: String? = null
    @Volatile private var epoch = 0
    private var base = 0.0
    private var duration = 0.0
    private var requested = start
    private var lastSaved = 0L
    private var readySeekApplied = false
    private var desiredPlaying = true
    private var preparing = false
    private var failed = false
    private var pendingTarget: Double? = null
    private var lastOverlayActivity = System.currentTimeMillis()
    private var startedAt = 0L
    private var selectedEpisodeId: String? = null
    private var episodeDialog: android.app.Dialog? = null
    private val ticker = object : Runnable {
        override fun run() {
            if (closed) return
            refresh()
            if (System.currentTimeMillis() - lastSaved >= 5000) { save(); lastSaved = System.currentTimeMillis() }
            if (overlay.visibility == View.VISIBLE && System.currentTimeMillis() - lastOverlayActivity > 7000 && !preparing && !failed && player?.isPlaying == true && pendingTarget == null && episodeDialog == null) overlay.visibility = View.GONE
            activity.main.postDelayed(this,500)
        }
    }
    private val heartbeat = object : Runnable {
        override fun run() {
            if (closed) return
            val id = sessionId
            if (id != null) activity.sessionIo.execute { if (!closed && sessionId == id) try { activity.api.post("/api/playback/${MainActivity.encoded(id)}/heartbeat") } catch (_: Exception) {} }
            activity.main.postDelayed(this,15000)
        }
    }
    private val seekCommit = Runnable {
        val target = pendingTarget ?: return@Runnable
        pendingTarget = null
        val p = player
        // EVENT manifests contain only the transcoded prefix. Never seek into an unpublished range.
        if (p != null && target >= base && (target - base) * 1000 <= p.bufferedPosition - 1500 && !preparing && !failed) {
            p.seekTo(((target-base)*1000).toLong()); requested = target; refresh(); save()
        } else begin(target)
    }
    init {
        view.addView(playerView,FrameLayout.LayoutParams(-1,-1))
        view.addView(message,FrameLayout.LayoutParams(-1,-2,Gravity.CENTER))
        overlay.addView(heading)
        overlay.addView(time,LinearLayout.LayoutParams(-1,d(30)))
        overlay.addView(seek,LinearLayout.LayoutParams(-1,d(45)))
        previous = activity.button("上一集") { changeEpisode(-1) }; actions.addView(previous)
        pause = activity.button("暂停") { togglePause() }; actions.addView(pause)
        next = activity.button("下一集") { changeEpisode(1) }; actions.addView(next)
        actions.addView(activity.button("选集") { chooseEpisode() })
        retry = activity.button("重试") { begin(position()) }; retry.visibility = View.GONE; actions.addView(retry)
        actions.addView(activity.button("返回详情") { activity.leavePlayback(this) })
        overlay.addView(actions)
        overlay.addView(activity.text("左右键快进 / 快退 10 秒 · 确认暂停 · 返回详情",13f,activity.muted))
        view.addView(overlay,FrameLayout.LayoutParams(-1,-2,Gravity.BOTTOM))
        seek.setOnKeyListener { _, code, event ->
            when (code) {
                KeyEvent.KEYCODE_DPAD_LEFT, KeyEvent.KEYCODE_DPAD_RIGHT -> { if (event.action == KeyEvent.ACTION_DOWN) scheduleSeek((if (code == KeyEvent.KEYCODE_DPAD_LEFT) -1 else 1) * if (event.repeatCount > 6) 30.0 else 10.0); true }
                KeyEvent.KEYCODE_DPAD_CENTER, KeyEvent.KEYCODE_ENTER -> { if (event.action == KeyEvent.ACTION_UP) togglePause(); true }
                else -> false
            }
        }
        seek.setOnSeekBarChangeListener(object : SeekBar.OnSeekBarChangeListener {
            override fun onProgressChanged(bar: SeekBar?, progress: Int, fromUser: Boolean) { if (fromUser && duration > 0) { pendingTarget = duration * progress/100000.0; refresh(); showOverlay() } }
            override fun onStartTrackingTouch(bar: SeekBar?) { showOverlay() }
            override fun onStopTrackingTouch(bar: SeekBar?) { activity.main.removeCallbacks(seekCommit); activity.main.postDelayed(seekCommit,200) }
        })
        pause.requestFocus()
    }
    private fun d(value: Int) = activity.dp(value)
    fun start() { activity.main.post(ticker); activity.main.post(heartbeat); begin(requested) }
    fun position(): Double = (pendingTarget ?: if (player != null && !preparing && !failed) base + (player?.currentPosition ?: 0L)/1000.0 else requested).coerceAtLeast(0.0).let { if (duration > 0) it.coerceAtMost(duration) else it }
    private fun save(completed: Boolean = false) {
        activity.store.save(Progress(detail.drama,episode.id,episode.index,if (completed && duration > 0) duration else position(),duration,System.currentTimeMillis()))
    }
    private fun begin(target: Double, persistCurrent: Boolean = true) {
        if (closed) return
        if (persistCurrent) save(); epoch++; val generation = epoch
        requested = target.coerceAtLeast(0.0).let { if (duration > 1) it.coerceAtMost(duration-0.5) else it }
        pendingTarget = null; preparing = true; failed = false; readySeekApplied = false; startedAt = System.currentTimeMillis()
        playerView.player = null; player?.release(); player = null
        retry.visibility = View.GONE; message.visibility = View.VISIBLE; message.text = "正在准备第${episode.index}集…"; showOverlay(); refresh()
        val episodeId = episode.id; val startPosition = requested
        activity.sessionIo.execute {
            if (closed || generation != epoch) return@execute
            // Same-token new POST replaces the old session atomically on the service.
            try {
                val response = activity.api.post("/api/playback",JSONObject().put("seriesId",detail.drama.id).put("episodeId",episodeId).put("startSeconds",startPosition))
                sessionId = response.getString("id")
                activity.main.post { if (!closed && generation == epoch) accept(response,generation) }
            } catch (e: Exception) { activity.main.post { if (!closed && generation == epoch) fail(e) } }
        }
    }
    private fun accept(json: JSONObject, generation: Int) {
        if (closed || generation != epoch) return
        duration = json.optDouble("durationSeconds",duration).takeIf { it.isFinite() && it > 0 } ?: duration
        base = json.optDouble("positionBaseSeconds",requested)
        when (json.optString("status")) {
            "ready" -> {
                val playlist = json.optString("playlistUrl")
                if (playlist.isBlank()) { fail(IllegalStateException("服务未提供播放地址，请重试")); return }
                openMedia(playlist,generation)
            }
            "error" -> fail(ApiError(json.optString("errorCode"),json.optString("message").ifBlank { "电脑无法准备该集，请重试或返回" }))
            "preparing" -> {
                val progress = json.optDouble("progress",-1.0)
                val stage = json.optString("stage").let { when(it) { "resolving" -> "正在获取剧集"; "probing" -> "正在读取媒体"; "transcoding" -> "正在准备画面"; "starting" -> "正在启动转码"; else -> it.take(60).ifBlank { "正在准备播放" } } }
                message.text = "$stage…" + if (progress >= 0 && progress <= 1) " ${(progress*100).toInt()}%" else ""
                if (System.currentTimeMillis() - startedAt > 180000) { fail(IllegalStateException("准备时间过长，请检查电脑后重试")); return }
                val id = sessionId ?: return
                activity.main.postDelayed({
                    if (closed || generation != epoch) return@postDelayed
                    activity.sessionIo.execute {
                        if (closed || generation != epoch) return@execute
                        try { val response = activity.api.get("/api/playback/${MainActivity.encoded(id)}"); activity.main.post { if (!closed && generation == epoch) accept(response,generation) } }
                        catch (e: Exception) { activity.main.post { if (!closed && generation == epoch) fail(e) } }
                    }
                },700)
            }
            else -> fail(IllegalStateException("服务器返回了未知播放状态"))
        }
        refresh()
    }
    private fun openMedia(path: String, generation: Int) {
        try {
            val url = activity.api.absolute(path)
            val dataSource = DefaultHttpDataSource.Factory().setDefaultRequestProperties(mapOf("Authorization" to "Bearer ${activity.api.token}")).setConnectTimeoutMs(15000).setReadTimeoutMs(30000)
            val source = HlsMediaSource.Factory(dataSource).createMediaSource(MediaItem.Builder().setUri(url).setMimeType(MimeTypes.APPLICATION_M3U8).build())
            val created = ExoPlayer.Builder(activity).build(); player = created; playerView.player = created
            created.setAudioAttributes(androidx.media3.common.AudioAttributes.DEFAULT, true)
            created.addListener(object : Player.Listener {
                override fun onPlaybackStateChanged(state: Int) {
                    if (closed || epoch != generation || player !== created) return
                    if (state == Player.STATE_READY) {
                        // EVENT HLS otherwise starts near its growing live edge. Do this exactly once.
                        if (!readySeekApplied) { readySeekApplied = true; created.seekTo(0) }
                        preparing = false; failed = false; message.visibility = View.GONE; retry.visibility = View.GONE; refresh(); save()
                    } else if (state == Player.STATE_ENDED) {
                        save(true)
                        val index = detail.episodes.indexOfFirst { it.id == episode.id }
                        if (index >= 0 && index + 1 < detail.episodes.size) { episode = detail.episodes[index+1]; duration = 0.0; requested = 0.0; base = 0.0; begin(0.0, false) }
                        else { desiredPlaying = false; showOverlay(); message.text = "全剧已播完"; message.visibility = View.VISIBLE; pause.text = "重新播放"; pause.requestFocus() }
                    }
                }
                override fun onPlayerError(error: PlaybackException) { if (!closed && generation == epoch) fail(IllegalStateException("播放中断，请重试；检查电脑服务与网络连接")) }
                override fun onIsPlayingChanged(isPlaying: Boolean) { if (!closed && generation == epoch) refresh() }
            })
            created.setMediaSource(source); created.prepare(); created.playWhenReady = desiredPlaying
        } catch (e: Exception) { fail(e) }
    }
    private fun fail(error: Throwable) {
        requested = position(); save(); activity.main.removeCallbacks(seekCommit); pendingTarget = null; epoch++; preparing = false; failed = true
        playerView.player = null; player?.release(); player = null
        releaseSession(); message.visibility = View.VISIBLE; message.text = activity.errorText(error)
        retry.visibility = View.VISIBLE; showOverlay(); retry.requestFocus(); refresh()
    }
    private fun releaseSession() {
        activity.sessionIo.execute {
            val id = sessionId
            sessionId = null
            if (id != null) try { activity.api.delete("/api/playback/${MainActivity.encoded(id)}") } catch (_: Exception) {}
        }
    }
    private fun refresh() {
        if (closed) return
        heading.text = "${detail.drama.title}  ·  第${episode.index}集 / ${detail.episodes.size}集"
        val pos = position(); time.text = "${MainActivity.clock(pos)} / ${if (duration > 0) MainActivity.clock(duration) else "正在读取时长"}" + if (pendingTarget != null) "   松开后跳转" else if (preparing) "   正在准备…" else ""
        if (!seek.isPressed && pendingTarget == null) seek.progress = if (duration > 0) (pos/duration*100000).toInt().coerceIn(0,100000) else 0
        seek.isEnabled = duration > 0 && !failed
        val index = detail.episodes.indexOfFirst { it.id == episode.id }; previous.isEnabled = index > 0; next.isEnabled = index >= 0 && index < detail.episodes.lastIndex
        if (player?.playbackState != Player.STATE_ENDED) pause.text = if (desiredPlaying) "暂停" else "继续"
    }
    private fun togglePause() {
        if (failed) { begin(position()); return }
        if (player?.playbackState == Player.STATE_ENDED) { desiredPlaying = true; begin(0.0); return }
        desiredPlaying = !desiredPlaying; player?.playWhenReady = desiredPlaying; showOverlay(); save(); refresh()
    }
    private fun scheduleSeek(delta: Double) {
        if (duration <= 0 || failed) return
        pendingTarget = ((pendingTarget ?: position()) + delta).coerceIn(0.0,(duration-0.5).coerceAtLeast(0.0))
        activity.main.removeCallbacks(seekCommit); activity.main.postDelayed(seekCommit,600); showOverlay(); refresh()
        seek.progress = ((pendingTarget ?: 0.0)/duration*100000).toInt()
    }
    private fun changeEpisode(delta: Int) {
        val index = detail.episodes.indexOfFirst { it.id == episode.id }; val nextIndex = index + delta
        if (index < 0 || nextIndex !in detail.episodes.indices) return
        switchEpisode(detail.episodes[nextIndex])
    }
    private fun switchEpisode(nextEpisode: Episode) {
        save(); episode = nextEpisode; duration = 0.0; base = 0.0; requested = 0.0; desiredPlaying = true; begin(0.0, false)
    }
    private fun chooseEpisode() {
        showOverlay()
        val dialog = android.app.Dialog(activity)
        val content = LinearLayout(activity).apply { orientation = LinearLayout.VERTICAL; setBackgroundColor(Color.rgb(10,16,32)); setPadding(d(18),d(12),d(18),d(12)) }
        content.addView(activity.text("全部选集 · ${detail.episodes.size}集",22f).apply { setPadding(0,0,0,d(10)) })
        val list = androidx.recyclerview.widget.RecyclerView(activity).apply { layoutManager = androidx.recyclerview.widget.GridLayoutManager(activity,6); clipToPadding = false }
        list.adapter = object : androidx.recyclerview.widget.RecyclerView.Adapter<EpisodeHolder>() {
            override fun onCreateViewHolder(parent: ViewGroup, type: Int): EpisodeHolder {
                val button = activity.button("") {}
                button.layoutParams = androidx.recyclerview.widget.RecyclerView.LayoutParams(-1,d(55)).apply { setMargins(d(3),d(3),d(3),d(3)) }
                return EpisodeHolder(button)
            }
            override fun getItemCount() = detail.episodes.size
            override fun onBindViewHolder(holder: EpisodeHolder, position: Int) {
                val ep = detail.episodes[position]; holder.button.text = "第${ep.index}集" + if (ep.id == episode.id) " ▶" else ""
                holder.button.setOnClickListener { selectedEpisodeId = ep.id; dialog.dismiss(); switchEpisode(ep) }
            }
        }
        content.addView(list,LinearLayout.LayoutParams(-1,0,1f)); content.addView(activity.button("返回播放") { dialog.dismiss() })
        dialog.setContentView(content); dialog.window?.setLayout(d(760),d(420))
        dialog.setOnDismissListener { episodeDialog = null; lastOverlayActivity = System.currentTimeMillis(); pause.requestFocus() }
        episodeDialog = dialog; dialog.show(); dialog.window?.setLayout(d(760),d(420))
        val index = detail.episodes.indexOfFirst { it.id == episode.id }.coerceAtLeast(0); list.scrollToPosition(index); list.post { list.findViewHolderForAdapterPosition(index)?.itemView?.requestFocus() }
    }
    private class EpisodeHolder(val button: Button) : androidx.recyclerview.widget.RecyclerView.ViewHolder(button)
    private fun showOverlay() { overlay.visibility = View.VISIBLE; lastOverlayActivity = System.currentTimeMillis() }
    fun key(event: KeyEvent): Boolean {
        if (closed) return false
        val code = event.keyCode
        if (code == KeyEvent.KEYCODE_BACK) return false
        if (code in listOf(KeyEvent.KEYCODE_MEDIA_PLAY_PAUSE,KeyEvent.KEYCODE_MEDIA_PAUSE,KeyEvent.KEYCODE_MEDIA_PLAY)) {
            if (event.action == KeyEvent.ACTION_DOWN && event.repeatCount == 0) { if (code == KeyEvent.KEYCODE_MEDIA_PAUSE && !desiredPlaying || code == KeyEvent.KEYCODE_MEDIA_PLAY && desiredPlaying) return true; togglePause() }; return true
        }
        if (code == KeyEvent.KEYCODE_MEDIA_NEXT || code == KeyEvent.KEYCODE_MEDIA_PREVIOUS) { if (event.action == KeyEvent.ACTION_DOWN && event.repeatCount == 0) changeEpisode(if (code == KeyEvent.KEYCODE_MEDIA_NEXT) 1 else -1); return true }
        if (code == KeyEvent.KEYCODE_MEDIA_FAST_FORWARD || code == KeyEvent.KEYCODE_MEDIA_REWIND) { if (event.action == KeyEvent.ACTION_DOWN) scheduleSeek(if (code == KeyEvent.KEYCODE_MEDIA_FAST_FORWARD) 30.0 else -30.0); return true }
        if (overlay.visibility != View.VISIBLE && code in listOf(KeyEvent.KEYCODE_DPAD_LEFT,KeyEvent.KEYCODE_DPAD_RIGHT,KeyEvent.KEYCODE_DPAD_CENTER,KeyEvent.KEYCODE_ENTER,KeyEvent.KEYCODE_DPAD_UP,KeyEvent.KEYCODE_DPAD_DOWN)) {
            if (event.action == KeyEvent.ACTION_DOWN) {
                showOverlay()
                when (code) {
                    KeyEvent.KEYCODE_DPAD_LEFT, KeyEvent.KEYCODE_DPAD_RIGHT -> { seek.requestFocus(); scheduleSeek(if (code == KeyEvent.KEYCODE_DPAD_LEFT) -10.0 else 10.0) }
                    KeyEvent.KEYCODE_DPAD_CENTER, KeyEvent.KEYCODE_ENTER -> { togglePause(); pause.requestFocus() }
                    else -> pause.requestFocus()
                }
            }
            return true
        }
        if (event.action == KeyEvent.ACTION_DOWN) lastOverlayActivity = System.currentTimeMillis()
        if (view.hasFocus() && !overlay.hasFocus() && code in listOf(KeyEvent.KEYCODE_DPAD_CENTER,KeyEvent.KEYCODE_ENTER)) { if (event.action == KeyEvent.ACTION_DOWN) { togglePause(); pause.requestFocus() }; return true }
        return false
    }
    fun close() {
        if (closed) return
        save(); closed = true; epoch++
        activity.main.removeCallbacks(ticker); activity.main.removeCallbacks(heartbeat); activity.main.removeCallbacks(seekCommit)
        episodeDialog?.dismiss(); episodeDialog = null
        playerView.player = null; player?.release(); player = null; releaseSession()
    }
}
