import android.annotation.SuppressLint
import android.webkit.WebView as AndroidWebView
import android.webkit.WebViewClient
import androidx.compose.runtime.Composable
import androidx.compose.ui.Modifier
import androidx.compose.ui.viewinterop.AndroidView

@SuppressLint("SetJavaScriptEnabled")
@Composable
fun WebView(url: String, onLoad: (String) -> Unit) {
  AndroidView(
    modifier = Modifier,
    factory = { context ->
      AndroidWebView(context).apply {
        webViewClient =
          object : WebViewClient() {
            override fun onPageFinished(
              view: AndroidWebView,
              finished: String,
            ) {
              onLoad(view.title ?: "")
            }
          }
      }
    },
    update = { view ->
      view.settings.javaScriptEnabled = true
      if (view.url != url) view.loadUrl(url)
    },
  )
}
