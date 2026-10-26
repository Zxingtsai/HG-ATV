package cn.hongguotv

import android.app.AlertDialog
import android.graphics.BitmapFactory
import android.graphics.Color
import android.util.Base64
import android.view.Gravity
import android.view.View
import android.widget.*
import org.json.JSONObject
import java.util.concurrent.RejectedExecutionException

internal class AccountController(private val activity: MainActivity) {
    val view = LinearLayout(activity).apply { orientation = LinearLayout.HORIZONTAL; gravity = Gravity.CENTER }
    private val qr = ImageView(activity).apply { setBackgroundColor(Color.WHITE); scaleType = ImageView.ScaleType.FIT_CENTER; contentDescription = "红果登录二维码"; visibility = View.INVISIBLE }
    private val status = activity.text("正在读取账号状态…", 21f)
    private var closed = false
    private var epoch = 0
    private var operation: String? = null
    private var pending = false
    private var lastImage: String? = null
    private val start = activity.button("生成登录二维码") { login(false) }
    private val verify = activity.button("验证已保存的会话") { login(true) }
    private val cancel = activity.button("取消扫码") { operation?.let { id -> command { activity.api.delete("/api/account/login/${MainActivity.encoded(id)}") } } }
    private val logout = activity.button("退出账号") {
        AlertDialog.Builder(activity).setTitle("退出账号？").setMessage("清除服务器账号会话，保留本机收藏和观看历史。")
            .setPositiveButton("退出") { _, _ -> command { activity.api.post("/api/account/logout") } }.setNegativeButton("返回", null).show()
    }
    private val poll = Runnable { operation?.let { load("/api/account/login/${MainActivity.encoded(it)}") } }
    init {
        view.addView(qr, LinearLayout.LayoutParams(activity.dp(290), activity.dp(290)))
        val controls = LinearLayout(activity).apply { orientation = LinearLayout.VERTICAL; setPadding(28,0,0,0) }
        controls.addView(activity.text("用红果 App 扫码登录", 25f))
        controls.addView(activity.text("请使用带“扫一扫”功能的红果 App，扫码后在手机确认", 17f, activity.muted))
        controls.addView(status, LinearLayout.LayoutParams(-1, activity.dp(90)))
        listOf(start, verify, cancel, logout).forEach { controls.addView(it, LinearLayout.LayoutParams(-1, activity.dp(48))) }
        view.addView(controls, LinearLayout.LayoutParams(activity.dp(440), -2)); start.requestFocus(); load("/api/account")
    }
    private fun enabled(value: Boolean) { listOf(start,verify,cancel,logout).forEach { it.isEnabled = value } }
    private fun render(data: JSONObject) {
        val state = data.optString("state")
        pending = state in listOf("opening","waiting_scan","waiting_confirm","verifying")
        status.text = data.optString("message") + data.optString("nickname").takeIf { it.isNotBlank() }?.let { "\n账号：$it" }.orEmpty()
        val image = data.optString("qrImage")
        if (image != lastImage) {
            lastImage = image; qr.setImageDrawable(null); qr.visibility = View.INVISIBLE
            if (image.length in 1..1500000 && (image.startsWith("data:image/png;base64,") || image.startsWith("data:image/jpeg;base64,"))) {
                val bytes = Base64.decode(image.substringAfter(','), Base64.DEFAULT)
                val bounds = BitmapFactory.Options().apply { inJustDecodeBounds = true }
                BitmapFactory.decodeByteArray(bytes,0,bytes.size,bounds)
                if (bounds.outWidth in 1..2048 && bounds.outHeight in 1..2048) { qr.setImageBitmap(BitmapFactory.decodeByteArray(bytes,0,bytes.size)); qr.visibility = View.VISIBLE }
            }
        }
        enabled(true); cancel.visibility = if (pending && operation != null) View.VISIBLE else View.GONE
        verify.visibility = if (state == "saved" || state == "expired") View.VISIBLE else View.GONE
        logout.visibility = if (data.optBoolean("authenticated") || state == "saved") View.VISIBLE else View.GONE
        start.text = if (state == "expired") "二维码已过期，重新生成" else "生成登录二维码"
        activity.main.removeCallbacks(poll); if (pending && operation != null) activity.main.postDelayed(poll,1500)
    }
    private fun load(path: String) {
        val version = epoch
        activity.sessionIo.execute {
            try { val data = activity.api.get(path); activity.main.post { if (!closed && epoch == version) try { render(data) } catch (e: Exception) { showError(e) } } }
            catch (e: Exception) { activity.main.post { if (!closed && epoch == version) showError(e) } }
        }
    }
    private fun showError(error: Exception) { activity.main.removeCallbacks(poll); enabled(true); qr.setImageDrawable(null); qr.visibility = View.INVISIBLE; lastImage = null; status.text = activity.errorText(error); start.requestFocus() }
    private fun login(verifyOnly: Boolean) { command(true) { activity.api.post("/api/account/login",JSONObject().put("verifyOnly",verifyOnly)) } }
    private fun command(login: Boolean = false, work: () -> JSONObject) {
        val version = ++epoch; activity.main.removeCallbacks(poll); enabled(false); qr.visibility = View.INVISIBLE; lastImage = null
        activity.sessionIo.execute {
            try {
                val data = work(); val id = data.optString("operationId").takeIf { it.isNotBlank() }
                activity.main.post {
                    if (closed || version != epoch) {
                        if (login && id != null && !data.optBoolean("authenticated")) cancelOperation(id)
                    } else { operation = id; try { render(data) } catch (e: Exception) { showError(e) } }
                }
            } catch (e: Exception) { activity.main.post { if (!closed && version == epoch) showError(e) } }
        }
    }
    private fun cancelOperation(id: String) {
        try {
            activity.sessionIo.execute { try { activity.api.delete("/api/account/login/${MainActivity.encoded(id)}") } catch (_: Exception) {} }
        } catch (_: RejectedExecutionException) { /* The server also expires abandoned operations. */ }
    }
    fun close() {
        if (closed) return
        closed = true; epoch++; activity.main.removeCallbacks(poll); qr.setImageDrawable(null); lastImage = null
        val id = operation; operation = null
        if (pending && id != null) cancelOperation(id)
    }
}
