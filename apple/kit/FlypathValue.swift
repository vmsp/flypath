@_exported import FlypathAbi

public struct FlypathValue {
  public let ref: FlypathValueRef

  public init(_ ref: FlypathValueRef) {
    self.ref = ref
  }

  public var count: Int { flypath_count(ref) }
  public var isNull: Bool { flypath_is_null(ref) }
  public var bool: Bool { flypath_bool(ref) }
  public var number: Double { flypath_number(ref) }

  public var string: String {
    var length = 0
    guard let pointer = flypath_string(ref, &length) else { return "" }
    return String(decoding: UnsafeRawBufferPointer(start: pointer, count: length), as: UTF8.self)
  }

  public var bytes: [UInt8] {
    var length = 0
    guard let pointer = flypath_bytes(ref, &length) else { return [] }
    return [UInt8](UnsafeBufferPointer(start: pointer, count: length))
  }

  public func at(_ index: Int) -> FlypathValue {
    FlypathValue(flypath_at(ref, index))
  }

  public func field(_ name: String) -> FlypathValue {
    FlypathValue(flypath_field(ref, name))
  }
}

public struct FlypathOut {
  public let ref: FlypathOutRef

  public init(_ ref: FlypathOutRef) {
    self.ref = ref
  }

  public func setNull() {
    flypath_out_null(ref)
  }

  public func set(_ value: Bool) {
    flypath_out_bool(ref, value)
  }

  public func set(_ value: Double) {
    flypath_out_number(ref, value)
  }

  public func set(_ value: String) {
    flypath_out_string(ref, value, value.utf8.count)
  }

  public func set(_ value: [UInt8]) {
    value.withUnsafeBufferPointer { buffer in
      flypath_out_bytes(ref, buffer.baseAddress, buffer.count)
    }
  }

  public func array(_ count: Int) -> FlypathOut {
    FlypathOut(flypath_out_array(ref, count))
  }

  public func element(_ index: Int) -> FlypathOut {
    FlypathOut(flypath_out_element(ref, index))
  }

  public func object() -> FlypathOut {
    FlypathOut(flypath_out_object(ref))
  }

  public func field(_ name: String) -> FlypathOut {
    FlypathOut(flypath_out_field(ref, name))
  }
}

public protocol FlypathDecodable {
  init(flypath value: FlypathValue)
}

public protocol FlypathEncodable {
  func flypathEncode(_ out: FlypathOut)
}

extension Bool: FlypathDecodable, FlypathEncodable {
  public init(flypath value: FlypathValue) { self = value.bool }
  public func flypathEncode(_ out: FlypathOut) { out.set(self) }
}

extension Double: FlypathDecodable, FlypathEncodable {
  public init(flypath value: FlypathValue) { self = value.number }
  public func flypathEncode(_ out: FlypathOut) { out.set(self) }
}

extension String: FlypathDecodable, FlypathEncodable {
  public init(flypath value: FlypathValue) { self = value.string }
  public func flypathEncode(_ out: FlypathOut) { out.set(self) }
}

extension Array: FlypathDecodable where Element: FlypathDecodable {
  public init(flypath value: FlypathValue) {
    self = (0..<value.count).map { Element(flypath: value.at($0)) }
  }
}

extension Array: FlypathEncodable where Element: FlypathEncodable {
  public func flypathEncode(_ out: FlypathOut) {
    let array = out.array(count)
    for (index, element) in enumerated() {
      element.flypathEncode(array.element(index))
    }
  }
}

extension Optional: FlypathDecodable where Wrapped: FlypathDecodable {
  public init(flypath value: FlypathValue) {
    self = value.isNull ? nil : Wrapped(flypath: value)
  }
}

extension Optional: FlypathEncodable where Wrapped: FlypathEncodable {
  public func flypathEncode(_ out: FlypathOut) {
    guard let value = self else {
      out.setNull()
      return
    }
    value.flypathEncode(out)
  }
}
