package dev.flypath.kit

import com.facebook.jni.HybridData
import com.facebook.jni.annotations.DoNotStrip
import com.facebook.react.runtime.JSRuntimeFactory
import com.facebook.soloader.SoLoader

public class FlypathHermesInstance : JSRuntimeFactory(initHybrid()) {
    public companion object {
        @JvmStatic
        @DoNotStrip
        protected external fun initHybrid(): HybridData

        init {
            SoLoader.loadLibrary("appmodules")
        }
    }
}
