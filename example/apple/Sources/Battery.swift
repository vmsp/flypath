import UIKit

func printHello() {
  print("Hello from Swift!")
}

func batteryLevel() async -> Double {
  await MainActor.run {
    UIDevice.current.isBatteryMonitoringEnabled = true
    return Double(UIDevice.current.batteryLevel)
  }
}

func greet(name: String, times: Double) -> String {
  Array(repeating: "hello, \(name)", count: Int(times)).joined(separator: " ")
}

func shout(text: String) -> String {
  "\(text.uppercased())!"
}
