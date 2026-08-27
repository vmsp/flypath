package dev.flypath.kit

@JvmInline
public value class FlypathValue(public val ref: Long) {
    public val count: Int
        get() = FlypathAbi.count(ref)

    public val isNull: Boolean
        get() = FlypathAbi.isNull(ref)

    public val bool: Boolean
        get() = FlypathAbi.bool(ref)

    public val number: Double
        get() = FlypathAbi.number(ref)

    public val string: String
        get() = FlypathAbi.string(ref)

    public val bytes: ByteArray
        get() = FlypathAbi.bytes(ref)

    public fun at(index: Int): FlypathValue = FlypathValue(FlypathAbi.at(ref, index))

    public fun field(name: String): FlypathValue = FlypathValue(FlypathAbi.field(ref, name))

    public fun <T> list(decode: (FlypathValue) -> T): List<T> = (0 until count).map { decode(at(it)) }

    public fun <T> orNull(decode: (FlypathValue) -> T): T? = if (isNull) null else decode(this)
}

@JvmInline
public value class FlypathOut(public val ref: Long) {
    public fun setNull(): Unit = FlypathAbi.outNull(ref)

    public fun set(value: Boolean): Unit = FlypathAbi.outBool(ref, value)

    public fun set(value: Double): Unit = FlypathAbi.outNumber(ref, value)

    public fun set(value: String): Unit = FlypathAbi.outString(ref, value)

    public fun set(value: ByteArray): Unit = FlypathAbi.outBytes(ref, value)

    public fun array(count: Int): FlypathOut = FlypathOut(FlypathAbi.outArray(ref, count))

    public fun element(index: Int): FlypathOut = FlypathOut(FlypathAbi.outElement(ref, index))

    public fun obj(): FlypathOut = FlypathOut(FlypathAbi.outObject(ref))

    public fun field(name: String): FlypathOut = FlypathOut(FlypathAbi.outField(ref, name))

    public fun <T> setList(values: List<T>, encode: (T, FlypathOut) -> Unit) {
        val target = array(values.size)
        values.forEachIndexed { index, value -> encode(value, target.element(index)) }
    }

    public fun <T> setOrNull(value: T?, encode: (T, FlypathOut) -> Unit) {
        if (value == null) setNull() else encode(value, this)
    }
}
