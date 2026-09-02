package dev.flypath

import android.animation.Animator
import android.animation.AnimatorListenerAdapter
import android.animation.ValueAnimator
import android.content.Context
import android.graphics.Outline
import android.view.View
import android.view.ViewGroup
import android.view.ViewOutlineProvider
import androidx.activity.BackEventCompat
import androidx.activity.OnBackPressedCallback
import androidx.activity.OnBackPressedDispatcher
import androidx.activity.findViewTreeOnBackPressedDispatcherOwner
import com.facebook.react.bridge.Arguments
import com.facebook.react.bridge.ReactContext
import com.facebook.react.bridge.WritableMap
import com.facebook.react.uimanager.ReactStylesDiffMap
import com.facebook.react.uimanager.ThemedReactContext
import com.facebook.react.uimanager.UIManagerHelper
import com.facebook.react.uimanager.ViewGroupManager
import com.facebook.react.uimanager.events.Event

private const val STACK_NAME: String = "FlypathScreenStack"

private const val SCREEN_NAME: String = "FlypathScreen"

private const val PUSH_DURATION: Long = 240L

private const val POP_DURATION: Long = 200L

private const val BACK_SCALE: Float = 0.1f

private const val BACK_SHIFT: Float = 0.08f

private const val BACK_RADIUS: Float = 28f

private class PoppedEvent(surfaceId: Int, viewTag: Int, private val keys: List<String>) :
    Event<PoppedEvent>(surfaceId, viewTag) {

    override fun getEventName(): String = "topPopped"

    override fun getEventData(): WritableMap {
        val payload = Arguments.createMap()
        payload.putArray("keys", Arguments.fromList(keys))
        return payload
    }
}

public class FlypathScreenView(context: Context) : ViewGroup(context) {

    public var screenKey: String = ""

    public var modal: Boolean = false

    public var transition: String = "platform"

    public var gesture: Boolean = true

    public var cornerRadius: Float = 0f
        set(value) {
            field = value
            clipToOutline = value > 0f
            invalidateOutline()
        }

    init {
        outlineProvider =
            object : ViewOutlineProvider() {
                override fun getOutline(view: View, outline: Outline) {
                    outline.setRoundRect(0, 0, view.width, view.height, cornerRadius)
                }
            }
    }

    override fun onLayout(changed: Boolean, l: Int, t: Int, r: Int, b: Int): Unit = Unit

    public fun reset() {
        alpha = 1f
        scaleX = 1f
        scaleY = 1f
        translationX = 0f
        translationY = 0f
        cornerRadius = 0f
        visibility = VISIBLE
    }
}

public class FlypathScreenStackView(context: Context) : ViewGroup(context) {

    private val screens = mutableListOf<FlypathScreenView>()

    private val dismissed = mutableSetOf<String>()

    private var dismissedAt: List<String> = emptyList()

    private var running: ValueAnimator? = null

    private var retiring: FlypathScreenView? = null

    private var dispatcher: OnBackPressedDispatcher? = null

    private var swiping = false

    private var edge = BackEventCompat.EDGE_LEFT

    public var active: Boolean = true
        set(value) {
            field = value
            refresh()
        }

    private val back =
        object : OnBackPressedCallback(false) {
            override fun handleOnBackStarted(backEvent: BackEventCompat) {
                swiping = true
                edge = backEvent.swipeEdge
                settle()
                refresh()
            }

            override fun handleOnBackProgressed(backEvent: BackEventCompat) {
                edge = backEvent.swipeEdge
                drag(backEvent.progress)
            }

            override fun handleOnBackCancelled() {
                swiping = false
                screens.lastOrNull()?.let { top -> animateHome(top) }
            }

            override fun handleOnBackPressed() {
                swiping = false
                val top = screens.lastOrNull() ?: return
                animateAway(top)
                dismiss(top)
            }
        }

    override fun onLayout(changed: Boolean, l: Int, t: Int, r: Int, b: Int): Unit = Unit

    override fun onAttachedToWindow() {
        super.onAttachedToWindow()
        dispatcher = findViewTreeOnBackPressedDispatcherOwner()?.onBackPressedDispatcher
        dispatcher?.addCallback(back)
        refresh()
    }

    override fun onDetachedFromWindow() {
        back.remove()
        dispatcher = null
        super.onDetachedFromWindow()
    }

    public val screenCount: Int
        get() = screens.size

    public fun screenAt(index: Int): View? = screens.getOrNull(index)

    public fun addScreen(screen: FlypathScreenView, index: Int) {
        settle()
        val at = index.coerceIn(0, screens.size)
        screens.add(at, screen)
        addView(screen, at)
        if (at == screens.size - 1 && screens.size > 1 && animates(screen)) {
            animateIn(screen)
        }
        refresh()
    }

    public fun removeScreenAt(index: Int) {
        val screen = screens.getOrNull(index) ?: return
        screens.removeAt(index)

        if (dismissed.remove(screen.screenKey)) {
            removeView(screen)
            refresh()
            return
        }

        settle()
        if (index != screens.size || screens.isEmpty() || !animates(screen)) {
            removeView(screen)
            refresh()
            return
        }

        retiring = screen
        screens.lastOrNull()?.visibility = VISIBLE
        animateOut(screen)
        refresh()
    }

    public fun removeAllScreens() {
        settle()
        screens.clear()
        removeAllViews()
        refresh()
    }

    private fun animates(screen: FlypathScreenView): Boolean =
        isAttachedToWindow && screen.transition != "none"

    private fun settle() {
        running?.end()
        running = null
        retiring?.let { screen ->
            removeView(screen)
            retiring = null
        }
    }

    private fun drive(duration: Long, onFrame: (Float) -> Unit, onEnd: () -> Unit) {
        val animator = ValueAnimator.ofFloat(0f, 1f)
        animator.duration = duration
        animator.addUpdateListener { value -> onFrame(value.animatedValue as Float) }
        animator.addListener(
            object : AnimatorListenerAdapter() {
                override fun onAnimationEnd(animation: Animator) {
                    if (running === animation) running = null
                    onEnd()
                }
            }
        )
        running = animator
        animator.start()
    }

    private fun animateIn(screen: FlypathScreenView) {
        screens.getOrNull(screens.size - 2)?.visibility = VISIBLE
        screen.alpha = 0f
        if (screen.modal) {
            screen.translationY = height.toFloat()
        } else {
            screen.scaleX = 0.96f
            screen.scaleY = 0.96f
        }
        drive(
            PUSH_DURATION,
            { progress ->
                screen.alpha = progress
                if (screen.modal) {
                    screen.translationY = height * (1f - progress)
                } else {
                    val scale = 0.96f + 0.04f * progress
                    screen.scaleX = scale
                    screen.scaleY = scale
                }
            },
            {
                screen.reset()
                refresh()
            },
        )
    }

    private fun animateOut(screen: FlypathScreenView) {
        drive(
            POP_DURATION,
            { progress ->
                screen.alpha = 1f - progress
                if (screen.modal) {
                    screen.translationY = height * progress
                } else {
                    val scale = 1f + 0.04f * progress
                    screen.scaleX = scale
                    screen.scaleY = scale
                }
            },
            {
                removeView(screen)
                if (retiring === screen) retiring = null
                refresh()
            },
        )
    }

    private fun animateHome(screen: FlypathScreenView) {
        val scaleFrom = screen.scaleX
        val shiftFrom = screen.translationX
        val radiusFrom = screen.cornerRadius
        drive(
            POP_DURATION,
            { progress ->
                val scale = scaleFrom + (1f - scaleFrom) * progress
                screen.scaleX = scale
                screen.scaleY = scale
                screen.translationX = shiftFrom * (1f - progress)
                screen.cornerRadius = radiusFrom * (1f - progress)
            },
            {
                screen.reset()
                refresh()
            },
        )
    }

    private fun animateAway(screen: FlypathScreenView) {
        val shiftFrom = screen.translationX
        val shiftTo = if (edge == BackEventCompat.EDGE_LEFT) width.toFloat() else -width.toFloat()
        drive(
            POP_DURATION,
            { progress ->
                screen.translationX = shiftFrom + (shiftTo - shiftFrom) * progress
                screen.alpha = 1f - progress
            },
            { screen.visibility = INVISIBLE },
        )
    }

    private fun drag(progress: Float) {
        val top = screens.lastOrNull() ?: return
        val scale = 1f - BACK_SCALE * progress
        top.pivotX = if (edge == BackEventCompat.EDGE_LEFT) width.toFloat() else 0f
        top.pivotY = height / 2f
        top.scaleX = scale
        top.scaleY = scale
        top.translationX =
            (if (edge == BackEventCompat.EDGE_LEFT) 1f else -1f) * width * BACK_SHIFT * progress
        top.cornerRadius = BACK_RADIUS * progress
    }

    private fun dismiss(screen: FlypathScreenView) {
        if (!dismissed.add(screen.screenKey)) return
        dismissedAt = screens.map { entry -> entry.screenKey }
        val reactContext = context as? ReactContext ?: return
        val surfaceId = UIManagerHelper.getSurfaceId(this)
        UIManagerHelper.getEventDispatcher(reactContext, surfaceId)
            ?.dispatchEvent(PoppedEvent(surfaceId, id, listOf(screen.screenKey)))
    }

    private fun forgetDeclined() {
        if (dismissed.isEmpty()) return
        val keys = screens.map { entry -> entry.screenKey }
        if (keys == dismissedAt) return
        for (screen in screens) {
            if (!dismissed.remove(screen.screenKey)) continue
            screen.reset()
        }
    }

    private fun refresh() {
        forgetDeclined()

        val top = screens.size - 1
        for ((at, screen) in screens.withIndex()) {
            if (dismissed.contains(screen.screenKey)) continue
            val revealed =
                at == top || (at == top - 1 && (swiping || running != null || screens[top].modal))
            screen.visibility = if (revealed) VISIBLE else INVISIBLE
        }

        back.isEnabled = active && screens.size > 1 && (screens.lastOrNull()?.gesture ?: false)
    }
}

public class FlypathScreenManager : ViewGroupManager<FlypathScreenView>() {

    override fun getName(): String = SCREEN_NAME

    override fun createViewInstance(reactContext: ThemedReactContext): FlypathScreenView =
        FlypathScreenView(reactContext)

    override fun updateProperties(view: FlypathScreenView, props: ReactStylesDiffMap) {
        super.updateProperties(view, props)
        val values = props.toMap()
        (values["screenKey"] as? String)?.let { value -> view.screenKey = value }
        (values["presentation"] as? String)?.let { value -> view.modal = value == "modal" }
        (values["transition"] as? String)?.let { value -> view.transition = value }
        (values["gesture"] as? Boolean)?.let { value -> view.gesture = value }
    }
}

public class FlypathScreenStackManager : ViewGroupManager<FlypathScreenStackView>() {

    override fun getName(): String = STACK_NAME

    override fun createViewInstance(reactContext: ThemedReactContext): FlypathScreenStackView =
        FlypathScreenStackView(reactContext)

    override fun updateProperties(view: FlypathScreenStackView, props: ReactStylesDiffMap) {
        super.updateProperties(view, props)
        (props.toMap()["active"] as? Boolean)?.let { value -> view.active = value }
    }

    override fun getExportedCustomDirectEventTypeConstants(): MutableMap<String, Any> =
        mutableMapOf("topPopped" to mapOf("registrationName" to "onPopped"))

    override fun addView(parent: FlypathScreenStackView, child: View, index: Int) {
        if (child !is FlypathScreenView) return
        parent.addScreen(child, index)
    }

    override fun getChildCount(parent: FlypathScreenStackView): Int = parent.screenCount

    override fun getChildAt(parent: FlypathScreenStackView, index: Int): View? =
        parent.screenAt(index)

    override fun removeViewAt(parent: FlypathScreenStackView, index: Int) {
        parent.removeScreenAt(index)
    }

    override fun removeAllViews(parent: FlypathScreenStackView) {
        parent.removeAllScreens()
    }
}
