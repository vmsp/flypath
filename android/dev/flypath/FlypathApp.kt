package dev.flypath

import android.app.Application
import android.content.Context

public object FlypathApp {
    @Volatile
    public var context: Context? = null
        set(value) {
            field = value
            (value?.applicationContext as? Application)?.let { FlypathInsets.attach(it) }
        }

    public fun require(): Context =
        checkNotNull(context) { "flypath: the application context is not available yet" }
}
