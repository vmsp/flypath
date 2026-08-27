package dev.flypath.kit

public fun interface FlypathEvents {
    public fun emit(name: String, payload: Map<String, Any?>)
}
