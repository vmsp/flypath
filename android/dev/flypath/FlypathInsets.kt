package dev.flypath

import android.app.Activity
import android.app.Application
import android.os.Bundle
import androidx.core.view.ViewCompat
import androidx.core.view.WindowInsetsCompat

public object FlypathInsets {
    @JvmStatic
    private external fun publish(top: Double, bottom: Double, left: Double, right: Double)

    private var attached = false
    private var ready = false
    private var latest: DoubleArray? = null

    public fun attach(application: Application) {
        if (attached) return
        attached = true
        application.registerActivityLifecycleCallbacks(
            object : Application.ActivityLifecycleCallbacks {
                override fun onActivityCreated(activity: Activity, state: Bundle?) {
                    observe(activity)
                }

                override fun onActivityStarted(activity: Activity) {}

                override fun onActivityResumed(activity: Activity) {
                    observe(activity)
                }

                override fun onActivityPaused(activity: Activity) {}

                override fun onActivityStopped(activity: Activity) {}

                override fun onActivitySaveInstanceState(activity: Activity, state: Bundle) {}

                override fun onActivityDestroyed(activity: Activity) {}
            }
        )
    }

    @JvmStatic
    public fun install() {
        if (ready) return
        ready = true
        latest?.let { flush(it) }
    }

    private fun observe(activity: Activity) {
        val decor = activity.window?.decorView ?: return
        val density = activity.resources.displayMetrics.density
        ViewCompat.setOnApplyWindowInsetsListener(decor) { _, insets ->
            record(insets, density)
            insets
        }
        ViewCompat.getRootWindowInsets(decor)?.let { record(it, density) }
        ViewCompat.requestApplyInsets(decor)
    }

    private fun record(insets: WindowInsetsCompat, density: Float) {
        val edges =
            insets.getInsets(
                WindowInsetsCompat.Type.systemBars() or WindowInsetsCompat.Type.displayCutout()
            )
        val scale = density.toDouble()
        val values =
            doubleArrayOf(
                edges.top / scale,
                edges.bottom / scale,
                edges.left / scale,
                edges.right / scale,
            )
        latest = values
        if (ready) flush(values)
    }

    private fun flush(values: DoubleArray) {
        runCatching { publish(values[0], values[1], values[2], values[3]) }
    }
}
