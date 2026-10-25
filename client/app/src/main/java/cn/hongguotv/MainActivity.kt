package cn.hongguotv

import android.app.Activity
import android.app.AlertDialog
import android.content.Context
import android.graphics.Color
import android.graphics.Typeface
import android.graphics.drawable.GradientDrawable
import android.net.wifi.WifiManager
import android.os.Bundle
import android.os.Handler
import android.os.Looper
import android.text.InputType
import android.view.Gravity
import android.view.KeyEvent
import android.view.View
import android.view.ViewGroup
import android.view.WindowManager
import android.view.inputmethod.InputMethodManager
import android.widget.*
import androidx.recyclerview.widget.GridLayoutManager
import androidx.recyclerview.widget.LinearLayoutManager
import androidx.recyclerview.widget.RecyclerView
import org.json.JSONObject
import java.net.DatagramPacket
import java.net.DatagramSocket
import java.net.InetAddress
import java.net.NetworkInterface
import java.net.URLEncoder
import java.util.concurrent.Executors

class MainActivity : Activity() {
    internal val main = Handler(Looper.getMainLooper())
    internal val io = Executors.newCachedThreadPool()
    internal val sessionIo = Executors.newSingleThreadExecutor()
    internal lateinit var api: Api
    internal lateinit var store: LocalStore
    private lateinit var root: FrameLayout
    private lateinit var body: LinearLayout
    private var screenVersion = 0
    private var foreground = false
    private var discoveryGeneration = 0
    private var route = Route("home")
    private val backStack = mutableListOf<Route>()
    private var player: PlaybackController? = null
    private var activeDetail: Detail? = null
    private var showingRecommendations = false
    private var suspendedPlayback: Triple<Detail, Episode, Double>? = null
    private var catalogPage = 1
    private var catalogItems = mutableListOf<Drama>()
    private var catalogRecycler: RecyclerView? = null
    private var catalogMore: Button? = null
    private var catalogLoading = false
    private var catalogHasMore = false
    private data class Route(val kind: String, val id: String = "", val title: String = "", val query: String = "")
    private val bg = Color.rgb(10,16,32)
    internal val muted = Color.rgb(161,175,198)
    private val accent = Color.rgb(255,102,89)

    override fun onCreate(savedInstanceState: Bundle?) {
        super.onCreate(savedInstanceState)
        window.decorView.systemUiVisibility = View.SYSTEM_UI_FLAG_FULLSCREEN or View.SYSTEM_UI_FLAG_HIDE_NAVIGATION or View.SYSTEM_UI_FLAG_IMMERSIVE_STICKY
        api = Api(this); store = LocalStore(this)
        root = FrameLayout(this).apply { setBackgroundColor(bg) }; setContentView(root)
        if (api.connected()) render(Route("home")) else render(Route("connect"))
    }
    override fun onStart() { super.onStart(); foreground = true }
    override fun onResume() {
        super.onResume()
        val suspended = suspendedPlayback
        if (suspended != null) {
            suspendedPlayback = null
            // Resume only after a deliberate TV action; background never retains a transcoder.
            showDetailData(suspended.first)
        }
    }
    override fun onStop() {
        foreground = false; discoveryGeneration++
        player?.let { suspendedPlayback = Triple(it.detail, it.episode, it.position()); it.close(); player = null }
        window.clearFlags(WindowManager.LayoutParams.FLAG_KEEP_SCREEN_ON)
        super.onStop()
    }
    override fun onDestroy() { player?.close(); discoveryGeneration++; screenVersion++; io.shutdown(); sessionIo.shutdown(); super.onDestroy() }
    override fun onBackPressed() {
        val playback = player
        if (playback != null) { playback.close(); player = null; window.clearFlags(WindowManager.LayoutParams.FLAG_KEEP_SCREEN_ON); showDetailData(playback.detail); return }
        if (showingRecommendations && activeDetail != null) { showDetailData(activeDetail!!); return }
        if (backStack.isNotEmpty()) { render(backStack.removeAt(backStack.lastIndex)); return }
        if (route.kind != "home" && api.connected()) { render(Route("home")); return }
        AlertDialog.Builder(this).setTitle("退出红果 TV？").setMessage("观看进度已保存在本机。").setPositiveButton("退出") { _, _ -> finish() }.setNegativeButton("继续观看", null).show()
    }
    override fun dispatchKeyEvent(event: KeyEvent): Boolean {
        if (player?.key(event) == true) return true
        return super.dispatchKeyEvent(event)
    }
    private fun navigate(next: Route) { if (next != route) backStack.add(route); render(next) }
    private fun render(next: Route) {
        route = next; screenVersion++; discoveryGeneration++; activeDetail = null; showingRecommendations = false
        catalogRecycler = null; catalogMore = null; catalogLoading = false
        when (next.kind) {
            "connect" -> connection()
            "home" -> home()
            "categories" -> categoryPicker()
            "ranks" -> ranks()
            "catalog" -> catalog()
            "search" -> search()
            "detail" -> detail(next.id)
            "favorites", "history" -> library()
        }
    }
    internal fun dp(value: Int) = (value * resources.displayMetrics.density).toInt()
    internal fun text(value: String, size: Float = 20f, color: Int = Color.WHITE) = TextView(this).apply { text = value; textSize = size; setTextColor(color); includeFontPadding = false }
    private fun panel(color: Int = Color.rgb(27,38,60), stroke: Int = Color.TRANSPARENT): GradientDrawable = GradientDrawable().apply { setColor(color); cornerRadius = dp(9).toFloat(); setStroke(dp(3), stroke) }
    internal fun focusable(view: View) {
        view.isFocusable = true; view.isFocusableInTouchMode = true
        view.background = panel()
        view.setOnFocusChangeListener { v, has -> v.background = panel(if (has) Color.rgb(54,62,78) else Color.rgb(27,38,60), if (has) accent else Color.TRANSPARENT); v.elevation = if (has) dp(6).toFloat() else 0f }
    }
    internal fun button(title: String, action: () -> Unit): Button = Button(this).apply {
        text = title; textSize = 18f; setTextColor(Color.WHITE); isAllCaps = false; minimumHeight = dp(47); minHeight = dp(47); minimumWidth = dp(85)
        setPadding(dp(15),dp(6),dp(15),dp(6)); focusable(this); setOnClickListener { action() }
        layoutParams = LinearLayout.LayoutParams(ViewGroup.LayoutParams.WRAP_CONTENT, dp(49)).apply { setMargins(dp(4),dp(4),dp(4),dp(4)) }
    }
    private fun shell(title: String, nav: Boolean = true): LinearLayout {
        root.removeAllViews()
        body = LinearLayout(this).apply { orientation = LinearLayout.VERTICAL; setPadding(dp(30),dp(19),dp(30),dp(18)) }
        root.addView(body, FrameLayout.LayoutParams(-1,-1))
        val heading = LinearLayout(this).apply { orientation = LinearLayout.HORIZONTAL; gravity = Gravity.CENTER_VERTICAL }
        heading.addView(text("红果",28f,accent).apply { typeface = Typeface.DEFAULT_BOLD }, LinearLayout.LayoutParams(dp(78),dp(41)))
        heading.addView(text(title,23f).apply { maxLines = 1 }, LinearLayout.LayoutParams(0,dp(41),1f))
        heading.addView(text("TV · 家庭影院",14f,muted))
        body.addView(heading)
        if (nav) {
            val row = LinearLayout(this).apply { orientation = LinearLayout.HORIZONTAL }
            listOf("首页" to "home", "分类" to "categories", "榜单" to "ranks", "搜索" to "search", "收藏" to "favorites", "历史" to "history", "连接" to "connect").forEach { (name,kind) -> row.addView(button(name) { navigate(Route(kind)) }) }
            body.addView(HorizontalScrollView(this).apply { isHorizontalScrollBarEnabled = false; addView(row) }, LinearLayout.LayoutParams(-1,dp(62)))
        }
        return body
    }
    private fun loading(title: String = "正在加载…") { body.addView(text(title,21f,muted).apply { gravity = Gravity.CENTER }, LinearLayout.LayoutParams(-1,0,1f)) }
    internal fun toast(message: String) { Toast.makeText(this,message,Toast.LENGTH_LONG).show() }
    internal fun errorText(error: Throwable): String = when (error) {
        is ApiError -> error.message ?: "服务请求失败"
        is java.net.SocketTimeoutException -> "连接超时，请检查电脑服务和同一局域网连接"
        is java.net.ConnectException, is java.net.UnknownHostException -> "无法连接家庭服务，请检查服务器地址和网络"
        else -> error.message?.takeIf { it.length < 180 } ?: "暂时无法完成，请重试"
    }
    private fun error(error: Throwable, retry: () -> Unit) {
        body.removeViews(if (body.childCount > 1) 2.coerceAtMost(body.childCount) else body.childCount, (body.childCount - 2).coerceAtLeast(0))
        val box = LinearLayout(this).apply { orientation = LinearLayout.VERTICAL; gravity = Gravity.CENTER }
        box.addView(text(errorText(error),22f).apply { gravity = Gravity.CENTER; setPadding(dp(30),dp(25),dp(30),dp(25)) })
        val row = LinearLayout(this)
        val retryButton = button("重试") { retry() }; row.addView(retryButton)
        row.addView(button("返回") { onBackPressed() })
        if (error is ApiError && error.code in listOf("UNAUTHORIZED", "INVALID_TOKEN", "AUTH_REQUIRED")) row.addView(button("重新连接") { navigate(Route("connect")) })
        box.addView(row); body.addView(box,LinearLayout.LayoutParams(-1,0,1f)); retryButton.requestFocus()
    }
    private fun <T> request(work: () -> T, success: (T) -> Unit, failure: (Throwable) -> Unit = { error(it) { render(route) } }) {
        val version = screenVersion
        io.execute {
            try { val result = work(); main.post { if (!isDestroyed && screenVersion == version && player == null) success(result) } }
            catch (e: Exception) { main.post { if (!isDestroyed && screenVersion == version && player == null) failure(e) } }
        }
    }
    private fun clearBelowNav() { while (body.childCount > 2) body.removeViewAt(2) }
    private fun home() {
        shell("发现好剧"); loading()
        request({ api.get("/api/home") }, { result ->
            clearBelowNav()
            val contents = LinearLayout(this).apply { orientation = LinearLayout.VERTICAL; setPadding(0,dp(5),0,dp(20)) }
            val recent = store.history().firstOrNull()
            if (recent != null) contents.addView(button("继续观看 · ${recent.drama.title} · 第${recent.episodeIndex}集 ${clock(recent.seconds)}") { navigate(Route("detail",recent.drama.id)) },LinearLayout.LayoutParams(-1,dp(57)))
            var first: View? = null
            result.optJSONArray("sections").objects().forEach { section ->
                val dramas = section.optJSONArray("items").dramas()
                if (dramas.isNotEmpty()) {
                    contents.addView(text(section.optString("title"),23f).apply { setPadding(dp(3),dp(16),0,dp(10)); typeface = Typeface.DEFAULT_BOLD })
                    val row = cards(dramas, false)
                    contents.addView(row,LinearLayout.LayoutParams(-1,dp(235))); if (first == null) first = row
                }
            }
            if (contents.childCount == 0) contents.addView(text("暂时没有推荐内容，请稍后重试",22f,muted))
            body.addView(ScrollView(this).apply { isFillViewport = true; addView(contents) },LinearLayout.LayoutParams(-1,0,1f))
            first?.post { first?.requestFocus() }
        })
    }
    private fun categoryPicker() {
        shell("全部分类")
        val row = LinearLayout(this).apply { orientation = LinearLayout.VERTICAL; gravity = Gravity.CENTER; setPadding(dp(90),dp(12),dp(90),dp(12)) }
        val names = listOf("real-drama" to "真人短剧", "comic-drama" to "漫剧", "ai-drama" to "AI 短剧", "comic" to "动漫")
        names.forEachIndexed { index,(id,name) -> row.addView(button(name) { navigate(Route("catalog",id,name,"category")) },LinearLayout.LayoutParams(-1,dp(65)).apply { setMargins(dp(10),dp(5),dp(10),dp(5)) }); if (index == 0) row.getChildAt(0).requestFocus() }
        body.addView(row,LinearLayout.LayoutParams(-1,0,1f))
    }
    private fun ranks() {
        shell("热门榜单"); loading()
        request({ api.get("/api/ranks") }, { result ->
            clearBelowNav()
            val row = LinearLayout(this).apply { orientation = LinearLayout.VERTICAL; gravity = Gravity.CENTER; setPadding(dp(90),0,dp(90),0) }
            result.optJSONArray("items").objects().forEach { item -> row.addView(button(item.getString("title")) { navigate(Route("catalog",item.getString("id"),item.getString("title"),"rank")) },LinearLayout.LayoutParams(-1,dp(65)).apply { setMargins(dp(10),dp(5),dp(10),dp(5)) }) }
            body.addView(row,LinearLayout.LayoutParams(-1,0,1f)); row.getChildAt(0)?.requestFocus()
        })
    }
    private fun catalog() {
        shell(route.title); catalogPage = 1; catalogItems.clear(); loading()
        loadCatalog(false)
    }
    private fun loadCatalog(more: Boolean) {
        if (catalogLoading) return
        catalogLoading = true; catalogMore?.isEnabled = false
        val page = if (more) catalogPage + 1 else 1
        val path = if (route.query == "rank") "/api/ranks/${encoded(route.id)}?page=$page" else "/api/categories/${encoded(route.id)}?page=$page"
        request({ api.get(path) }, { data ->
            catalogLoading = false; catalogPage = data.optInt("page",page); catalogHasMore = data.optBoolean("hasMore")
            catalogItems.addAll(data.optJSONArray("items").dramas().filter { incoming -> catalogItems.none { it.id == incoming.id } })
            if (!more) {
                clearBelowNav()
                val grid = cards(catalogItems,true); catalogRecycler = grid
                body.addView(grid,LinearLayout.LayoutParams(-1,0,1f))
                val next = button("加载下一页") { loadCatalog(true) }; catalogMore = next; body.addView(next)
                grid.post { grid.requestFocus() }
            } else {
                catalogRecycler?.adapter?.notifyDataSetChanged()
                val firstNew = (catalogItems.size - data.optJSONArray("items").objects().size).coerceAtLeast(0)
                catalogRecycler?.scrollToPosition(firstNew)
                catalogRecycler?.post { catalogRecycler?.findViewHolderForAdapterPosition(firstNew)?.itemView?.requestFocus() }
            }
            catalogMore?.apply { isEnabled = catalogHasMore; text = if (catalogHasMore) "加载下一页 · 已加载${catalogItems.size}部" else "已显示全部 ${catalogItems.size} 部" }
            if (catalogItems.isEmpty()) toast("该分类暂时没有内容")
        }, { e -> catalogLoading = false; catalogMore?.isEnabled = true; if (more) { toast(errorText(e)); catalogMore?.requestFocus() } else error(e) { catalog() } })
    }
    private fun search() {
        shell("搜索短剧")
        val row = LinearLayout(this).apply { gravity = Gravity.CENTER_VERTICAL }
        val input = edit("输入剧名或关键词").apply { setText(route.query); imeOptions = android.view.inputmethod.EditorInfo.IME_ACTION_SEARCH }
        row.addView(input,LinearLayout.LayoutParams(0,dp(52),1f))
        fun submit() {
            val q = input.text.toString().trim()
            if (q.isEmpty()) { toast("请输入关键词"); input.requestFocus(); return }
            (getSystemService(INPUT_METHOD_SERVICE) as InputMethodManager).hideSoftInputFromWindow(input.windowToken,0)
            route = route.copy(query = q); screenVersion++
            while (body.childCount > 3) body.removeViewAt(3)
            val status = text("正在搜索…",21f,muted); body.addView(status)
            val items = mutableListOf<Drama>()
            val grid = cards(items,true)
            body.addView(grid,LinearLayout.LayoutParams(-1,0,1f))
            var page = 0
            var busy = false
            lateinit var next: Button
            fun loadPage() {
                if (busy) return
                busy = true; next.isEnabled = false
                request({ api.get("/api/search?q=" + encoded(q) + "&page=${page + 1}") }, { data ->
                    busy = false; page = data.getInt("page")
                    val previousSize = items.size
                    items.addAll(data.optJSONArray("items").dramas().filter { incoming -> items.none { it.id == incoming.id } }.distinctBy { it.id })
                    grid.adapter?.notifyItemRangeInserted(previousSize, items.size - previousSize)
                    val more = data.optBoolean("hasMore")
                    status.visibility = if (items.isEmpty()) View.VISIBLE else View.GONE
                    status.text = "没有找到相关短剧，请换个关键词"
                    next.isEnabled = more
                    next.text = if (more) "加载下一页 · 已加载${items.size}部" else "已到末页 · 共${items.size}部"
                    if (items.size > previousSize) {
                        grid.scrollToPosition(previousSize)
                        grid.post { grid.findViewHolderForAdapterPosition(previousSize)?.itemView?.requestFocus() ?: grid.requestFocus() }
                    } else if (more) next.requestFocus() else input.requestFocus()
                }, { e ->
                    busy = false; status.visibility = View.GONE
                    next.isEnabled = true; next.text = errorText(e) + " · 重试第${page + 1}页"; next.requestFocus()
                })
            }
            next = button("加载下一页") { loadPage() }; body.addView(next)
            loadPage()
        }
        row.addView(button("搜索") { submit() }); input.setOnEditorActionListener { _, _, _ -> submit(); true }
        body.addView(row,LinearLayout.LayoutParams(-1,dp(65)))
        if (route.query.isNotBlank()) submit() else input.requestFocus()
    }
    private fun library() {
        val history = route.kind == "history"
        shell(if (history) "观看历史" else "我的收藏")
        val items = if (history) store.history().map { it.drama } else store.favorites()
        if (items.isEmpty()) { body.addView(text(if (history) "开始观看后，进度会自动保存在这里" else "在剧集详情中收藏，随时回来继续看",23f,muted).apply { gravity = Gravity.CENTER },LinearLayout.LayoutParams(-1,0,1f)); return }
        val grid = cards(items,true); body.addView(grid,LinearLayout.LayoutParams(-1,0,1f)); grid.post { grid.requestFocus() }
    }
    private fun detail(id: String) {
        shell("剧集详情"); loading()
        request({ Detail.parse(api.get("/api/dramas/" + encoded(id))) }, { showDetailData(it) })
    }
    internal fun showDetailData(detail: Detail) {
        screenVersion++; activeDetail = detail; showingRecommendations = false; shell(detail.drama.title)
        val top = LinearLayout(this).apply { orientation = LinearLayout.HORIZONTAL; setPadding(dp(4),dp(9),dp(4),dp(8)) }
        val poster = ImageView(this).apply { scaleType = ImageView.ScaleType.CENTER_CROP; setBackgroundColor(Color.rgb(27,38,60)) }; Images.load(poster,detail.drama.cover)
        top.addView(poster,LinearLayout.LayoutParams(dp(112),dp(149)))
        val info = LinearLayout(this).apply { orientation = LinearLayout.VERTICAL; setPadding(dp(22),0,0,0) }
        val count = detail.episodes.size
        info.addView(text("${if (count == 0) "暂无可播剧集" else "共 $count 集"}   ${detail.drama.tags.joinToString(" · ")}",17f,muted))
        if (detail.actors.isNotEmpty()) info.addView(text("主演：" + detail.actors.joinToString(" / "),16f,muted).apply { maxLines = 1; setPadding(0,dp(7),0,0) })
        info.addView(text(detail.drama.description.ifBlank { "暂无简介" },17f).apply { maxLines = 3; ellipsize = android.text.TextUtils.TruncateAt.END; setPadding(0,dp(8),0,dp(3)) },LinearLayout.LayoutParams(-1,0,1f))
        val actions = LinearLayout(this)
        val progress = store.progress(detail.drama.id)
        val savedIndex = detail.episodes.indexOfFirst { it.id == progress?.episodeId }
        val completed = progress != null && progress.duration > 0 && progress.seconds >= progress.duration - 2
        val resumeIndex = if (completed && savedIndex >= 0 && savedIndex < detail.episodes.lastIndex) savedIndex + 1 else savedIndex
        val resumeEpisode = detail.episodes.getOrNull(resumeIndex)
        val resumeSeconds = if (completed || resumeIndex != savedIndex) 0.0 else progress?.seconds ?: 0.0
        val play = button(if (resumeEpisode != null) "${if (completed && resumeIndex == detail.episodes.lastIndex && resumeIndex == savedIndex) "重看" else "继续"}第${resumeEpisode.index}集 · ${clock(resumeSeconds)}" else "开始观看") {
            val ep = resumeEpisode ?: detail.episodes.firstOrNull()
            if (ep == null) toast("暂无可播放剧集，请稍后重试") else startPlayback(detail,ep,resumeSeconds)
        }; play.isEnabled = detail.episodes.isNotEmpty(); actions.addView(play)
        var favorite: Button? = null
        favorite = button(if (store.favorite(detail.drama.id)) "已收藏 ✓" else "＋ 收藏") { val enabled = store.toggle(detail.drama); favorite?.text = if (enabled) "已收藏 ✓" else "＋ 收藏" }
        actions.addView(favorite)
        actions.addView(button("简介") { AlertDialog.Builder(this).setTitle(detail.drama.title).setMessage(detail.drama.description.ifBlank { "暂无简介" }).setPositiveButton("返回",null).show() })
        info.addView(actions); top.addView(info,LinearLayout.LayoutParams(0,dp(149),1f)); body.addView(top)
        body.addView(text("全部选集 · 遥控器上下选择，确认播放",18f,muted).apply { setPadding(dp(4),dp(5),0,dp(7)) })
        val episodes = RecyclerView(this).apply { layoutManager = GridLayoutManager(this@MainActivity,6); clipToPadding = false; setPadding(dp(1),dp(3),dp(1),dp(10)) }
        episodes.adapter = object : RecyclerView.Adapter<EpisodeHolder>() {
            override fun onCreateViewHolder(parent: ViewGroup, type: Int) = EpisodeHolder(button("") {})
            override fun getItemCount() = detail.episodes.size
            override fun onBindViewHolder(holder: EpisodeHolder, position: Int) {
                val ep = detail.episodes[position]; val saved = store.episodeProgress(detail.drama.id,ep.id)
                holder.button.text = "第${ep.index}集" + if (saved != null && saved.seconds > 2) " · ${if (saved.duration > 0 && saved.seconds >= saved.duration - 2) "✓" else clock(saved.seconds)}" else ""
                holder.button.textSize = 16f
                holder.button.setOnClickListener { startPlayback(detail,ep,saved?.seconds?.takeIf { saved.duration <= 0 || it < saved.duration - 3 } ?: 0.0) }
            }
        }
        body.addView(episodes,LinearLayout.LayoutParams(-1,0,1f))
        if (detail.recommendations.isNotEmpty()) body.addView(button("相关推荐（${detail.recommendations.size}部）") { showRecommendations(detail) })
        if (detail.episodes.isEmpty()) body.addView(button("重新加载选集") { detail(detail.drama.id) })
        play.requestFocus()
    }
    private class EpisodeHolder(val button: Button) : RecyclerView.ViewHolder(button) { init { button.layoutParams = RecyclerView.LayoutParams(-1,button.resources.displayMetrics.density.times(55).toInt()).apply { setMargins(4,4,4,4) } } }
    private fun showRecommendations(detail: Detail) {
        showingRecommendations = true
        shell("相关推荐 · ${detail.drama.title}")
        body.addView(button("返回选集") { showDetailData(detail) })
        body.addView(cards(detail.recommendations,true),LinearLayout.LayoutParams(-1,0,1f))
    }
    internal fun startPlayback(detail: Detail, episode: Episode, startSeconds: Double) {
        if (!foreground) return
        screenVersion++; player?.close()
        window.addFlags(WindowManager.LayoutParams.FLAG_KEEP_SCREEN_ON)
        val controller = PlaybackController(this,detail,episode,startSeconds.coerceAtLeast(0.0))
        player = controller
        root.removeAllViews(); root.addView(controller.view,FrameLayout.LayoutParams(-1,-1)); controller.start()
    }
    internal fun leavePlayback(controller: PlaybackController) {
        if (player !== controller) return
        controller.close(); player = null; window.clearFlags(WindowManager.LayoutParams.FLAG_KEEP_SCREEN_ON); showDetailData(controller.detail)
    }
    private fun cards(items: List<Drama>, grid: Boolean): RecyclerView = RecyclerView(this).apply {
        layoutManager = if (grid) GridLayoutManager(this@MainActivity,5) else LinearLayoutManager(this@MainActivity,LinearLayoutManager.HORIZONTAL,false)
        clipToPadding = false; setPadding(dp(4),dp(4),dp(4),dp(8)); itemAnimator = null
        adapter = object : RecyclerView.Adapter<CardHolder>() {
            override fun onCreateViewHolder(parent: ViewGroup, viewType: Int): CardHolder {
                val box = LinearLayout(this@MainActivity).apply { orientation = LinearLayout.VERTICAL; setPadding(dp(5),dp(5),dp(5),dp(5)); focusable(this); descendantFocusability = ViewGroup.FOCUS_BLOCK_DESCENDANTS }
                val image = ImageView(this@MainActivity).apply { scaleType = ImageView.ScaleType.CENTER_CROP; setBackgroundColor(Color.rgb(17,26,43)) }
                val title = text("",17f).apply { maxLines = 1; ellipsize = android.text.TextUtils.TruncateAt.END; setPadding(dp(3),dp(7),dp(3),dp(3)); typeface = Typeface.DEFAULT_BOLD }
                val meta = text("",13f,muted).apply { maxLines = 1; setPadding(dp(3),0,dp(3),dp(2)) }
                val progress = ProgressBar(this@MainActivity,null,android.R.attr.progressBarStyleHorizontal).apply { max = 1000; progressTintList = android.content.res.ColorStateList.valueOf(accent); minimumHeight = 0 }
                box.addView(image,LinearLayout.LayoutParams(-1,0,1f)); box.addView(title); box.addView(meta); box.addView(progress,LinearLayout.LayoutParams(-1,dp(3)))
                box.layoutParams = RecyclerView.LayoutParams(if (grid) -1 else dp(145),dp(225)).apply { setMargins(dp(4),dp(4),dp(4),dp(4)) }
                return CardHolder(box,image,title,meta,progress)
            }
            override fun getItemCount() = items.size
            override fun onBindViewHolder(holder: CardHolder, position: Int) {
                val item = items[position]; Images.load(holder.image,item.cover); holder.title.text = item.title
                val progress = store.progress(item.id)
                holder.meta.text = if (progress != null) "第${progress.episodeIndex}集 · ${clock(progress.seconds)}" else "${item.episodeCount}集  ${item.tags.firstOrNull().orEmpty()}"
                holder.progress.progress = if (progress != null && progress.duration > 0) (progress.seconds / progress.duration * 1000).toInt().coerceIn(0,1000) else 0
                holder.itemView.contentDescription = "${item.title}，${holder.meta.text}"
                holder.itemView.setOnClickListener { navigate(Route("detail",item.id)) }
            }
        }
    }
    private class CardHolder(view: View,val image: ImageView,val title: TextView,val meta: TextView,val progress: ProgressBar) : RecyclerView.ViewHolder(view)
    private fun edit(hintText: String) = EditText(this).apply {
        hint = hintText; textSize = 20f; setTextColor(Color.WHITE); setHintTextColor(muted); isSingleLine = true
        setPadding(dp(13),dp(6),dp(13),dp(6)); background = panel(Color.rgb(22,31,49), Color.rgb(98,113,139))
        setOnFocusChangeListener { v, has -> v.background = panel(Color.rgb(22,31,49),if (has) accent else Color.rgb(98,113,139)) }
    }
    private fun connection() {
        shell("连接家庭服务",false)
        val panel = LinearLayout(this).apply { orientation = LinearLayout.VERTICAL; setPadding(dp(70),dp(10),dp(70),0) }
        panel.addView(text("请让电视和 Windows 电脑连接同一局域网",21f).apply { setPadding(0,0,0,dp(8)) })
        panel.addView(text("在电脑启动红果 TV 服务，输入服务页显示的地址和六位配对码。",16f,muted).apply { setPadding(0,0,0,dp(9)) })
        val address = edit("http://192.168.1.8:8751").apply { inputType = InputType.TYPE_CLASS_TEXT or InputType.TYPE_TEXT_VARIATION_URI; setText(api.base) }
        panel.addView(address,LinearLayout.LayoutParams(-1,dp(52)))
        val code = edit("六位配对码").apply { inputType = InputType.TYPE_CLASS_NUMBER; filters = arrayOf(android.text.InputFilter.LengthFilter(6)) }
        panel.addView(code,LinearLayout.LayoutParams(-1,dp(52)).apply { topMargin = dp(10) })
        val status = text(if (api.connected()) "已配对：${api.base}" else "发现后仍需输入电脑显示的配对码",16f,muted)
        val row = LinearLayout(this)
        var pair: Button? = null
        pair = button("连接并配对") {
            val value = code.text.toString().trim()
            if (!Regex("[0-9]{6}").matches(value)) { status.text = "请输入六位数字配对码"; code.requestFocus(); return@button }
            (getSystemService(INPUT_METHOD_SERVICE) as InputMethodManager).hideSoftInputFromWindow(code.windowToken,0)
            pair?.isEnabled = false; status.text = "正在连接…"
            val serverAddress = address.text.toString()
            request({ api.pair(serverAddress,value) }, { pair?.isEnabled = true; backStack.clear(); render(Route("home")) }, { e -> pair?.isEnabled = true; status.text = errorText(e); pair?.requestFocus() })
        }
        row.addView(pair)
        row.addView(button("发现电脑") { discover(address,status) })
        if (api.connected()) row.addView(button("返回") { onBackPressed() })
        panel.addView(row); panel.addView(status,LinearLayout.LayoutParams(-1,dp(65)))
        panel.addView(text("遥控器确认键编辑输入框 · 发现失败时可手动输入地址",15f,muted))
        body.addView(panel,LinearLayout.LayoutParams(-1,0,1f)); address.requestFocus()
        discover(address,status)
    }
    private fun discover(address: EditText, status: TextView) {
        val generation = ++discoveryGeneration; status.text = "正在局域网发现电脑（约 4 秒）…"
        io.execute {
            var multicast: WifiManager.MulticastLock? = null
            try {
                multicast = (applicationContext.getSystemService(Context.WIFI_SERVICE) as? WifiManager)?.createMulticastLock("hongguotv-discovery")?.apply { setReferenceCounted(false); acquire() }
                DatagramSocket().use { socket ->
                    socket.broadcast = true; socket.soTimeout = 600
                    val bytes = "HONGGUO_TV_DISCOVER_V1".toByteArray(Charsets.UTF_8)
                    val targets = mutableSetOf("255.255.255.255")
                    NetworkInterface.getNetworkInterfaces()?.toList()?.filter { it.isUp && !it.isLoopback }?.forEach { network -> network.interfaceAddresses.mapNotNull { it.broadcast?.hostAddress }.forEach { targets.add(it) } }
                    repeat(2) { targets.forEach { host -> try { socket.send(DatagramPacket(bytes,bytes.size,InetAddress.getByName(host),8752)) } catch (_: Exception) {} } }
                    val deadline = System.currentTimeMillis() + 4000
                    while (System.currentTimeMillis() < deadline && generation == discoveryGeneration) {
                        val packet = DatagramPacket(ByteArray(2048),2048)
                        try { socket.receive(packet) } catch (_: java.net.SocketTimeoutException) { continue }
                        val json = try { JSONObject(String(packet.data,0,packet.length,Charsets.UTF_8)) } catch (_: Exception) { continue }
                        val port = json.optInt("port",0)
                        if (json.optString("name") != "红果 TV 家庭服务" || port !in 1..65535) continue
                        val host = packet.address.hostAddress ?: continue
                        val discovered = "http://${if (host.contains(':')) "[$host]" else host}:$port"
                        main.post { if (generation == discoveryGeneration && !isDestroyed) { address.setText(discovered); status.text = "已发现电脑，请输入电脑上的六位配对码" } }
                        return@execute
                    }
                }
                main.post { if (generation == discoveryGeneration && !isDestroyed) status.text = "未发现电脑，可手动输入服务地址；检查同一网络和 Windows 防火墙。" }
            } catch (_: Exception) { main.post { if (generation == discoveryGeneration && !isDestroyed) status.text = "自动发现不可用，请手动输入服务器地址" } }
            finally { try { multicast?.release() } catch (_: Exception) {} }
        }
    }
    companion object {
        internal fun encoded(value: String) = URLEncoder.encode(value,"UTF-8")
        internal fun clock(seconds: Double): String { val total = seconds.coerceAtLeast(0.0).toLong(); return if (total >= 3600) "%d:%02d:%02d".format(total/3600,total/60%60,total%60) else "%02d:%02d".format(total/60,total%60) }
    }
}
