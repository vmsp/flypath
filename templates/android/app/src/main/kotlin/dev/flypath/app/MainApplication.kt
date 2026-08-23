package __FLYPATH_PACKAGE__

import android.app.Application
import com.facebook.react.PackageList
import com.facebook.react.ReactApplication
import com.facebook.react.ReactHost
import com.facebook.react.ReactNativeHost
import com.facebook.react.ReactPackage
import com.facebook.react.defaults.DefaultNewArchitectureEntryPoint.load
import com.facebook.react.defaults.DefaultReactHost.getDefaultReactHost
import com.facebook.react.defaults.DefaultReactNativeHost
import com.facebook.react.soloader.OpenSourceMergedSoMapping
import com.facebook.soloader.SoLoader

class MainApplication : Application(), ReactApplication {
  override val reactNativeHost: ReactNativeHost =
    object : DefaultReactNativeHost(this@MainApplication) {
      override fun getPackages(): List<ReactPackage> = PackageList(this@MainApplication).packages

      override fun getJSMainModuleName(): String = "index"

      override fun getBundleAssetName(): String = "index.android.bundle"

      override fun getUseDeveloperSupport(): Boolean = true

      override val isNewArchEnabled: Boolean = true
      override val isHermesEnabled: Boolean = true
    }

  override val reactHost: ReactHost
    get() = getDefaultReactHost(applicationContext, reactNativeHost)

  override fun onCreate() {
    super.onCreate()
    SoLoader.init(this, OpenSourceMergedSoMapping)
    load()
  }
}
