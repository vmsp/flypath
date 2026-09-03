public struct FlypathPromise: @unchecked Sendable {
  public let ref: FlypathPromiseRef

  public init(_ ref: FlypathPromiseRef) {
    self.ref = ref
  }

  public func resolve() {
    flypath_promise_resolve(ref)
  }

  public func resolve<T: FlypathEncodable>(_ value: T) {
    value.flypathEncode(FlypathOut(flypath_promise_out(ref)))
    flypath_promise_resolve(ref)
  }

  public func reject(_ error: Error) {
    let message = String(describing: error)
    flypath_promise_reject(ref, message, message.utf8.count)
  }
}

public func flypathAwait<T>(_ value: @autoclosure () async throws -> T)
  async throws -> T
{
  try await value()
}
