// swift-tools-version: 6.0
import PackageDescription

let package = Package(
  name: "ExampleNative",
  platforms: [.iOS(.v15)],
  products: [
    .library(name: "ExampleNative", targets: ["ExampleNative"])
  ],
  dependencies: [
    .package(name: "Flypath", path: "../..")
  ],
  targets: [
    .target(
      name: "ExampleNative",
      dependencies: [.product(name: "Flypath", package: "Flypath")],
      path: "Sources"
    )
  ]
)
