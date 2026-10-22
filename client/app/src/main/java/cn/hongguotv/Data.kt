package cn.hongguotv

import android.content.Context
import android.graphics.Bitmap
import android.graphics.BitmapFactory
import android.os.Handler
import android.os.Looper
import android.util.LruCache
import android.widget.ImageView
import org.json.JSONArray
import org.json.JSONObject
import java.net.HttpURLConnection
import java.net.URI
import java.net.URL
import java.util.concurrent.Executors

internal data class Drama(val id: String, val title: String, val cover: String, val episodeCount: Int, val tags: List<String>, val description: String = "") {
    fun json() = JSONObject().put("id", id).put("title", title).put("cover", cover).put("episodeCount", episodeCount).put("tags", JSONArray(tags)).put("description", description)
    companion object { fun parse(j: JSONObject) = Drama(j.getString("id"), j.getString("title"), j.optString("cover"), j.optInt("episodeCount"), j.optJSONArray("tags").strings(), j.optString("description")) }
}
internal data class Episode(val id: String, val index: Int, val title: String)
internal data class Detail(val drama: Drama, val actors: List<String>, val episodes: List<Episode>, val recommendations: List<Drama>) {
    companion object { fun parse(j: JSONObject) = Detail(Drama.parse(j), j.optJSONArray("actors").strings(), j.getJSONArray("episodes").objects().map { Episode(it.getString("id"), it.getInt("index"), it.optString("title")) }, j.optJSONArray("recommendations").dramas()) }
}
internal data class Progress(val drama: Drama, val episodeId: String, val episodeIndex: Int, val seconds: Double, val duration: Double, val updated: Long) {
    fun json() = JSONObject().put("drama", drama.json()).put("episodeId", episodeId).put("episodeIndex", episodeIndex).put("seconds", seconds).put("duration", duration).put("updated", updated)
    companion object { fun parse(j: JSONObject) = Progress(Drama.parse(j.getJSONObject("drama")), j.getString("episodeId"), j.getInt("episodeIndex"), j.optDouble("seconds", 0.0), j.optDouble("duration", 0.0), j.optLong("updated")) }
}
internal fun JSONArray?.objects(): List<JSONObject> = if (this == null) emptyList() else (0 until length()).map { getJSONObject(it) }
internal fun JSONArray?.strings(): List<String> = if (this == null) emptyList() else (0 until length()).map { getString(it) }
internal fun JSONArray?.dramas() = objects().map { Drama.parse(it) }
internal class ApiError(val code: String, message: String) : Exception(message)
internal class Api(private val context: Context) {
    private val prefs = context.getSharedPreferences("connection", Context.MODE_PRIVATE)
    @Volatile var base: String = prefs.getString("base", "") ?: ""
        private set
    @Volatile var token: String = prefs.getString("token", "") ?: ""
        private set
    fun connected() = base.isNotEmpty() && token.isNotEmpty()
    fun pair(address: String, code: String): JSONObject {
        val uri = URI(address.trim().let { if (it.contains("://")) it else "http://$it" })
        require(uri.scheme == "http" || uri.scheme == "https") { "请输入 http:// 或 https:// 服务器地址" }
        require(!uri.host.isNullOrBlank() && uri.userInfo == null && (uri.path.isNullOrEmpty() || uri.path == "/") && uri.query == null && uri.fragment == null) { "请输入服务器地址，例如 http://192.168.1.8:8751" }
        val candidate = "${uri.scheme}://${uri.rawAuthority}".trimEnd('/')
        val result = request("POST", "/api/pair", JSONObject().put("code", code).put("clientName", android.os.Build.MODEL), candidate, "")
        val newToken = result.getString("token")
        base = candidate; token = newToken
        prefs.edit().putString("base", base).putString("token", token).apply()
        return result
    }
    fun get(path: String) = request("GET", path)
    fun post(path: String, body: JSONObject = JSONObject()) = request("POST", path, body)
    fun delete(path: String) = request("DELETE", path)
    fun absolute(path: String): String {
        val uri = URI(path)
        require(!uri.isAbsolute && !path.startsWith("//")) { "服务端返回的播放地址无效" }
        return base + "/" + path.trimStart('/')
    }
    fun request(method: String, path: String, body: JSONObject? = null, server: String = base, auth: String = token): JSONObject {
        val connection = URL(server + path).openConnection() as HttpURLConnection
        try {
            connection.connectTimeout = 15000; connection.readTimeout = 45000
            connection.requestMethod = method
            connection.setRequestProperty("Accept", "application/json")
            if (auth.isNotEmpty()) connection.setRequestProperty("Authorization", "Bearer $auth")
            if (body != null) {
                connection.doOutput = true; connection.setRequestProperty("Content-Type", "application/json; charset=utf-8")
                connection.outputStream.use { it.write(body.toString().toByteArray(Charsets.UTF_8)) }
            }
            val status = connection.responseCode
            val raw = (if (status in 200..299) connection.inputStream else connection.errorStream)?.bufferedReader()?.use { it.readText() }.orEmpty()
            val json = try { JSONObject(raw) } catch (_: Exception) { JSONObject() }
            if (status !in 200..299) {
                val error = json.optJSONObject("error")
                throw ApiError(error?.optString("code") ?: "HTTP_$status", error?.optString("message")?.takeIf { it.isNotBlank() } ?: "服务器请求失败（$status）")
            }
            return json
        } finally { connection.disconnect() }
    }
}
internal class LocalStore(context: Context) {
    private val prefs = context.getSharedPreferences("library", Context.MODE_PRIVATE)
    private fun read(key: String) = try { JSONObject(prefs.getString(key, "{}") ?: "{}") } catch (_: Exception) { JSONObject() }
    fun favorite(id: String) = read("favorites").has(id)
    fun toggle(drama: Drama): Boolean {
        val all = read("favorites"); val active = !all.has(drama.id)
        if (active) all.put(drama.id, drama.json()) else all.remove(drama.id)
        prefs.edit().putString("favorites", all.toString()).apply(); return active
    }
    fun favorites(): List<Drama> { val all = read("favorites"); return all.keys().asSequence().map { Drama.parse(all.getJSONObject(it)) }.toList().reversed() }
    fun progress(id: String): Progress? = try { read("history").optJSONObject(id)?.let { Progress.parse(it) } } catch (_: Exception) { null }
    fun history(): List<Progress> { val all = read("history"); return all.keys().asSequence().mapNotNull { try { Progress.parse(all.getJSONObject(it)) } catch (_: Exception) { null } }.sortedByDescending { it.updated }.toList() }
    fun save(value: Progress) {
        val all = read("history"); all.put(value.drama.id, value.json())
        // Bound local history while keeping all episode resume metadata for recent series.
        if (all.length() > 300) {
            val oldest = all.keys().asSequence().minByOrNull { all.getJSONObject(it).optLong("updated") }
            oldest?.let { all.remove(it) }
        }
        val episodeProgress = read("episodeProgress")
        episodeProgress.put(value.drama.id + ":" + value.episodeId, value.json())
        if (episodeProgress.length() > 1500) {
            val oldest = episodeProgress.keys().asSequence().minByOrNull { episodeProgress.getJSONObject(it).optLong("updated") }
            oldest?.let { episodeProgress.remove(it) }
        }
        prefs.edit().putString("history", all.toString()).putString("episodeProgress", episodeProgress.toString()).apply()
    }
    fun episodeProgress(series: String, episode: String): Progress? = try { read("episodeProgress").optJSONObject("$series:$episode")?.let { Progress.parse(it) } } catch (_: Exception) { null }
}
internal object Images {
    private val pool = Executors.newFixedThreadPool(3)
    private val main = Handler(Looper.getMainLooper())
    private val cache = object : LruCache<String, Bitmap>(20 * 1024 * 1024) { override fun sizeOf(key: String, value: Bitmap) = value.byteCount }
    fun load(view: ImageView, address: String) {
        view.tag = address; view.setImageDrawable(null)
        if (address.isBlank()) return
        cache.get(address)?.let { view.setImageBitmap(it); return }
        pool.execute {
            val bitmap = try {
                val c = URL(address).openConnection() as HttpURLConnection
                try {
                    c.connectTimeout = 8000; c.readTimeout = 10000
                    val bytes = c.inputStream.use { input ->
                        val out = java.io.ByteArrayOutputStream()
                        val buffer = ByteArray(8192); var total = 0
                        while (true) { val n = input.read(buffer); if (n < 0) break; total += n; if (total > 4 * 1024 * 1024) throw IllegalArgumentException("图片过大"); out.write(buffer, 0, n) }
                        out.toByteArray()
                    }
                    val bounds = BitmapFactory.Options().apply { inJustDecodeBounds = true }
                    BitmapFactory.decodeByteArray(bytes, 0, bytes.size, bounds)
                    var sample = 1
                    while (bounds.outHeight / sample > 600 || bounds.outWidth / sample > 600) sample *= 2
                    BitmapFactory.decodeByteArray(bytes, 0, bytes.size, BitmapFactory.Options().apply { inSampleSize = sample })
                } finally { c.disconnect() }
            } catch (_: Exception) { null }
            if (bitmap != null) { cache.put(address, bitmap); main.post { if (view.tag == address) view.setImageBitmap(bitmap) } }
        }
    }
}
