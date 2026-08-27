// swift-tools-version: 6.0
import PackageDescription

let package = Package(
  name: "FlypathKit",
  platforms: [.iOS(.v15)],
  products: [
    .library(name: "FlypathKit", targets: ["FlypathKit", "FlypathAbi"])
  ],
  targets: [
    .target(
      name: "FlypathAbi",
      path: "cpp/abi",
      publicHeadersPath: "include"
    ),
    .target(
      name: "FlypathKit",
      dependencies: ["FlypathAbi"],
      path: "apple/kit",
      swiftSettings: [.swiftLanguageMode(.v5)]
    ),
  ]
)
