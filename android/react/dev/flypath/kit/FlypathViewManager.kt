package dev.flypath.kit

import android.content.Context
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.setValue
import androidx.compose.runtime.Composable
import androidx.compose.ui.platform.AbstractComposeView
import androidx.compose.ui.platform.ViewCompositionStrategy
import com.facebook.react.ReactPackage
import com.facebook.react.bridge.Arguments
import com.facebook.react.bridge.ReactApplicationContext
import com.facebook.react.bridge.ReactContext
import com.facebook.react.bridge.WritableMap
import com.facebook.react.uimanager.UIManagerHelper
import com.facebook.react.uimanager.events.Event
import com.facebook.react.uimanager.ReactStylesDiffMap
import com.facebook.react.uimanager.SimpleViewManager
import com.facebook.react.uimanager.ThemedReactContext
import com.facebook.react.uimanager.ViewManager

private class FlypathEvent(
    surfaceId: Int,
    viewTag: Int,
    private val name: String,
    private val payload: WritableMap,
) : Event<FlypathEvent>(surfaceId, viewTag) {
    override fun getEventName(): String = name

    override fun getEventData(): WritableMap = payload
}

public class FlypathComposeView(context: Context, private val flypathName: String) :
    AbstractComposeView(context) {

    private var current by mutableStateOf(FlypathProps(emptyMap()))

    private val events = FlypathEvents { name, payload ->
        val reactContext = context as? ReactContext
        val dispatcher =
            if (reactContext == null) null
            else UIManagerHelper.getEventDispatcher(reactContext)
        dispatcher?.dispatchEvent(
            FlypathEvent(
                UIManagerHelper.getSurfaceId(this),
                id,
                name,
                Arguments.makeNativeMap(payload),
            )
        )
    }

    init {
        setViewCompositionStrategy(
            ViewCompositionStrategy.DisposeOnDetachedFromWindowOrReleasedFromPool
        )
    }

    @Composable
    override fun Content() {
        FlypathViewRegistry.get(flypathName)?.invoke(current, events)
    }

    public fun update(props: FlypathProps) {
        current = props
    }
}

public class FlypathViewManager(private val flypathName: String) :
    SimpleViewManager<FlypathComposeView>() {

    override fun getName(): String = flypathName

    override fun createViewInstance(reactContext: ThemedReactContext): FlypathComposeView =
        FlypathComposeView(reactContext, flypathName)

    override fun updateProperties(view: FlypathComposeView, props: ReactStylesDiffMap) {
        super.updateProperties(view, props)
        view.update(FlypathProps(props.toMap()))
    }
}

public class FlypathPackage(private val names: List<String>) : ReactPackage {
    override fun createViewManagers(
        reactContext: ReactApplicationContext
    ): List<ViewManager<*, *>> = names.map { FlypathViewManager(it) }
}
