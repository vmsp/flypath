import SwiftUI
import UIKit

@MainActor
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

@MainActor
@_cdecl("flypath_host_controller")
public func flypathHostController(
  _ host: FlypathHostRef
) -> FlypathControllerRef {
  let value = Unmanaged<FlypathHost>.fromOpaque(UnsafeRawPointer(host.rawValue))
    .takeUnretainedValue()
  return FlypathControllerRef(
    OpaquePointer(Unmanaged.passUnretained(value.viewController).toOpaque())
  )
}

@MainActor
@_cdecl("flypath_host_update")
public func flypathHostUpdate(
  _ host: FlypathHostRef,
  _ props: FlypathValueRef
) {
  Unmanaged<FlypathHost>.fromOpaque(UnsafeRawPointer(host.rawValue))
    .takeUnretainedValue()
    .update(FlypathValue(props))
}

@_cdecl("flypath_host_release")
public func flypathHostRelease(_ host: FlypathHostRef) {
  Unmanaged<FlypathHost>.fromOpaque(UnsafeRawPointer(host.rawValue)).release()
}

public struct FlypathEvents: @unchecked Sendable {
  public let view: FlypathViewRef

  public init(_ view: FlypathViewRef) {
    self.view = view
  }

  public func emit(_ name: String, _ build: (FlypathOut) -> Void) {
    guard let payload = flypath_event_begin(view) else { return }
    build(FlypathOut(payload).object())
    flypath_event_end(view, name, payload)
  }
}
