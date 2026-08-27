// swift-tools-version: 6.0
import PackageDescription

let package = Package(
  name: "ExampleNative",
  platforms: [.iOS(.v15)],
  products: [
    .library(name: "ExampleNative", targets: ["ExampleNative"])
  ],
  dependencies: [
    .package(name: "FlypathKit", path: "../..")
  ],
  targets: [
    .target(
      name: "ExampleNative",
      dependencies: [.product(name: "FlypathKit", package: "FlypathKit")],
      path: "Sources",
      swiftSettings: [.swiftLanguageMode(.v5)]
    )
  ]
)
