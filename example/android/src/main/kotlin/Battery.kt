import android.content.Context
import android.os.BatteryManager
import dev.flypath.FlypathApp

fun printHello() {
    println("Hello from Kotlin!")
}

suspend fun batteryLevel(): Double {
    val manager =
        FlypathApp.require().getSystemService(Context.BATTERY_SERVICE) as BatteryManager
    return manager.getIntProperty(BatteryManager.BATTERY_PROPERTY_CAPACITY) / 100.0
}

fun greet(name: String, times: Double): String =
    List(times.toInt()) { "hello, $name" }.joinToString(" ")

fun shout(text: String): String = "${text.uppercase()}!"
