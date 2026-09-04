import AVFoundation
import SwiftUI

struct CameraPreview: View {
  var facing: CameraFacing

  var body: some View {
    CameraLayer(facing: facing)
  }
}

private final class CameraLayerView: UIView {
  override class var layerClass: AnyClass { AVCaptureVideoPreviewLayer.self }

  var preview: AVCaptureVideoPreviewLayer {
    layer as! AVCaptureVideoPreviewLayer
  }
}

private struct CameraLayer: UIViewRepresentable {
  var facing: CameraFacing

  func makeCoordinator() -> Coordinator {
    Coordinator()
  }

  func makeUIView(context: Context) -> CameraLayerView {
    let view = CameraLayerView()
    view.backgroundColor = .black
    view.preview.videoGravity = .resizeAspectFill
    view.preview.session = context.coordinator.session
    context.coordinator.select(facing)
    return view
  }

  func updateUIView(_ view: CameraLayerView, context: Context) {
    context.coordinator.select(facing)
  }

  @MainActor
  final class Coordinator {
    let session = AVCaptureSession()
    private var current: CameraFacing?

    func select(_ facing: CameraFacing) {
      if current == facing { return }
      current = facing

      Task {
        guard await AVCaptureDevice.requestAccess(for: .video) else { return }
        self.configure(facing)
      }
    }

    private func configure(_ facing: CameraFacing) {
      session.beginConfiguration()
      for input in session.inputs { session.removeInput(input) }

      let device = AVCaptureDevice.default(
        .builtInWideAngleCamera,
        for: .video,
        position: facing == .front ? .front : .back
      )
      if let device, let input = try? AVCaptureDeviceInput(device: device),
        session.canAddInput(input)
      {
        session.addInput(input)
      }
      session.commitConfiguration()

      if !session.isRunning { session.startRunning() }
    }
  }
}
