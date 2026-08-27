package dev.flypath.kit

import androidx.compose.runtime.Composable

public object FlypathViewRegistry {
    private val factories:
            MutableMap<String, @Composable (FlypathProps, FlypathEvents) -> Unit> =
        mutableMapOf()

    public fun register(
        name: String,
        content: @Composable (FlypathProps, FlypathEvents) -> Unit,
    ) {
        factories[name] = content
    }

    public fun get(name: String): (@Composable (FlypathProps, FlypathEvents) -> Unit)? =
        factories[name]
}
