import SwiftUI
import WebKit

struct WebView: View {
  var url: String
  var onLoad: (String) -> Void

  var body: some View {
    PlatformWebView(url: url, onLoad: onLoad)
  }
}

private struct PlatformWebView: UIViewRepresentable {
  var url: String
  var onLoad: (String) -> Void

  func makeCoordinator() -> Coordinator {
    Coordinator(onLoad: onLoad)
  }

  func makeUIView(context: Context) -> WKWebView {
    let view = WKWebView()
    view.navigationDelegate = context.coordinator
    return view
  }

  func updateUIView(_ view: WKWebView, context: Context) {
    context.coordinator.onLoad = onLoad
    guard let target = URL(string: url) else { return }
    if view.url?.absoluteString == url { return }
    view.load(URLRequest(url: target))
  }

  final class Coordinator: NSObject, WKNavigationDelegate {
    var onLoad: (String) -> Void

    init(onLoad: @escaping (String) -> Void) {
      self.onLoad = onLoad
    }

    func webView(_ view: WKWebView, didFinish navigation: WKNavigation!) {
      onLoad(view.title ?? "")
    }
  }
}
