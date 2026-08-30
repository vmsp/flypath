// swift-tools-version: 6.0
import PackageDescription

let package = Package(
  name: "Flypath",
  platforms: [.iOS(.v15)],
  products: [
    .library(name: "Flypath", targets: ["Flypath", "FlypathAbi"])
  ],
  targets: [
    .target(
      name: "FlypathAbi",
      path: "cpp/abi",
      publicHeadersPath: "include"
    ),
    .target(
      name: "Flypath",
      dependencies: ["FlypathAbi"],
      path: "apple",
      exclude: ["core"]
    ),
  ]
)
