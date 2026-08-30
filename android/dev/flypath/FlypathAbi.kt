package dev.flypath

internal object FlypathAbi {
    init {
        runCatching { System.loadLibrary("appmodules") }
    }

    @JvmStatic
    public external fun count(ref: Long): Int

    @JvmStatic
    public external fun at(ref: Long, index: Int): Long

    @JvmStatic
    public external fun field(ref: Long, name: String): Long

    @JvmStatic
    public external fun isNull(ref: Long): Boolean

    @JvmStatic
    public external fun bool(ref: Long): Boolean

    @JvmStatic
    public external fun number(ref: Long): Double

    @JvmStatic
    public external fun string(ref: Long): String

    @JvmStatic
    public external fun bytes(ref: Long): ByteArray

    @JvmStatic
    public external fun outNull(ref: Long)

    @JvmStatic
    public external fun outBool(ref: Long, value: Boolean)

    @JvmStatic
    public external fun outNumber(ref: Long, value: Double)

    @JvmStatic
    public external fun outString(ref: Long, value: String)

    @JvmStatic
    public external fun outBytes(ref: Long, value: ByteArray)

    @JvmStatic
    public external fun outArray(ref: Long, count: Int): Long

    @JvmStatic
    public external fun outElement(ref: Long, index: Int): Long

    @JvmStatic
    public external fun outObject(ref: Long): Long

    @JvmStatic
    public external fun outField(ref: Long, name: String): Long

    @JvmStatic
    public external fun promiseOut(ref: Long): Long

    @JvmStatic
    public external fun promiseResolve(ref: Long)

    @JvmStatic
    public external fun promiseReject(ref: Long, message: String)
}
