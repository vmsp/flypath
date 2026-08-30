package dev.flypath

public class FlypathProps(private val values: Map<String, Any?>) {
    public fun isNull(name: String): Boolean = values[name] == null

    public fun bool(name: String): Boolean = values[name] as? Boolean ?: false

    public fun number(name: String): Double = (values[name] as? Number)?.toDouble() ?: 0.0

    public fun string(name: String): String = values[name] as? String ?: ""

    public fun bytes(name: String): ByteArray = values[name] as? ByteArray ?: ByteArray(0)

    public fun list(name: String): List<Any?> = values[name] as? List<Any?> ?: emptyList()

    @Suppress("UNCHECKED_CAST")
    public fun props(name: String): FlypathProps =
        FlypathProps(values[name] as? Map<String, Any?> ?: emptyMap())

    public companion object {
        public fun of(value: Any?): FlypathProps {
            @Suppress("UNCHECKED_CAST")
            return FlypathProps(value as? Map<String, Any?> ?: emptyMap())
        }

        public fun scalar(value: Any?): FlypathProps = FlypathProps(mapOf("value" to value))
    }
}
