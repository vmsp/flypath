package dev.flypath.kit

import android.content.Context

public object FlypathApp {
    @Volatile
    public var context: Context? = null

    public fun require(): Context =
        checkNotNull(context) { "flypath: the application context is not available yet" }
}
