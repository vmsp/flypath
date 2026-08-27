package __FLYPATH_PACKAGE__

import android.app.Application
import com.facebook.react.PackageList
import com.facebook.react.ReactApplication
import com.facebook.react.ReactHost
import com.facebook.react.defaults.DefaultNewArchitectureEntryPoint.load
import com.facebook.react.defaults.DefaultReactHost.getDefaultReactHost
import com.facebook.react.soloader.OpenSourceMergedSoMapping
import com.facebook.soloader.SoLoader
import dev.flypath.kit.FlypathApp
import dev.flypath.kit.FlypathPackage
import dev.flypath.kit.FlypathHermesInstance

class MainApplication : Application(), ReactApplication {
    override val reactHost: ReactHost
        get() =
            getDefaultReactHost(
                applicationContext,
                PackageList(this).packages +
                        FlypathPackage(listOf(__FLYPATH_VIEW_NAMES__)),
                jsRuntimeFactory = FlypathHermesInstance(),
                useDevSupport = true,
            )

    override fun onCreate() {
        super.onCreate()
        FlypathApp.context = this
        SoLoader.init(this, OpenSourceMergedSoMapping)
        load()
    }
}
