import SwiftUI
import UIKit

public final class FlypathHost {
  private let build: (FlypathValue) -> AnyView
  private let controller: UIHostingController<AnyView>

  public init(props: FlypathValue, build: @escaping (FlypathValue) -> AnyView) {
    self.build = build
    self.controller = UIHostingController(rootView: build(props))
    self.controller.view.backgroundColor = .clear
  }

  public var viewController: UIViewController { controller }

  public func update(_ props: FlypathValue) {
    controller.rootView = build(props)
  }
}

@_cdecl("flypath_host_controller")
public func flypathHostController(
  _ host: UnsafeMutableRawPointer
) -> UnsafeMutableRawPointer {
  let value = Unmanaged<FlypathHost>.fromOpaque(host).takeUnretainedValue()
  return Unmanaged.passUnretained(value.viewController).toOpaque()
}

@_cdecl("flypath_host_update")
public func flypathHostUpdate(
  _ host: UnsafeMutableRawPointer,
  _ props: FlypathValueRef
) {
  Unmanaged<FlypathHost>.fromOpaque(host).takeUnretainedValue()
    .update(FlypathValue(props))
}

@_cdecl("flypath_host_release")
public func flypathHostRelease(_ host: UnsafeMutableRawPointer) {
  Unmanaged<FlypathHost>.fromOpaque(host).release()
}

public struct FlypathEvents: @unchecked Sendable {
  public let view: UnsafeMutableRawPointer

  public init(_ view: UnsafeMutableRawPointer) {
    self.view = view
  }

  public func emit(_ name: String, _ build: (FlypathOut) -> Void) {
    guard let payload = flypath_event_begin(view) else { return }
    build(FlypathOut(payload).object())
    flypath_event_end(view, name, payload)
  }
}
