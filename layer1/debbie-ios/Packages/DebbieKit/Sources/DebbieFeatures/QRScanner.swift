import AVFoundation
import DebbieDesignSystem
import SwiftUI
import VisionKit

/// QR scanning with VisionKit (research note 11a R21). Where the camera can't scan (Simulator, denied
/// permission), it says so plainly; Debug builds add a paste path (brief §6).
struct QRScannerView: View {
    /// Returns whether the screen took the code; the scanner keeps looking when it didn't.
    let onPayload: (String) -> Bool
    /// The live camera's tallest height; the "unavailable" message sizes to its text so it never truncates.
    var maxCameraHeight: CGFloat = Size.scannerMax
    /// VoiceOver's name for the live camera. It names only the camera: on the outer view it also renamed the
    /// "isn't available" panel's text (the build-8 review, SCAN-5).
    var cameraLabel = "Camera"
    /// The demo never asks for the camera (DEMO_HOME.md). Elsewhere the scanner asks if nobody has yet (Add a Laptop
    /// can be the first place a camera is needed).
    var inDemo = false
    /// The camera permission as answered here, once asked; until then, what the system already knows.
    @State private var allowed: Bool?

    var body: some View {
        Group {
            if usesCamera {
                // The live camera has no size of its own (a UIKit view with no intrinsic size). In a scroll view, as in
                // Add a Laptop, it collapsed to nothing on a device (owner, 23:5x: "no camera opens"). It takes its
                // ideal height there, never less than the minimum, and up to the maximum where there's room.
                camera
                    .frame(maxWidth: .infinity)
                    .frame(minHeight: Size.scannerMin, idealHeight: maxCameraHeight, maxHeight: maxCameraHeight)
                    .accessibilityElement(children: .ignore)
                    .accessibilityLabel(cameraLabel)
                    .accessibilityIdentifier("cameraView")
            } else {
                unavailable
            }
        }
        .task { await askIfNeeded() }
    }

    /// While iPhone asks for the camera, a neutral line about what it's for (the fix's review: "isn't available" had
    /// shown behind the prompt). In the demo, which never asks, a plain line: iPhone Settings has no Camera switch for
    /// an app that never asked, so that advice couldn't be followed (the build-8 review, SCAN-6). Otherwise the camera
    /// was refused or the device can't scan.
    private var unavailable: some View {
        let neverAsked = AVCaptureDevice.authorizationStatus(for: .video) == .notDetermined
        let asking = !inDemo && DataScannerViewController.isSupported && allowed == nil && neverAsked
        let demo = inDemo && neverAsked
        return VStack(spacing: Space.s12) {
            DIcon("qr-scan").font(DType.hero).foregroundStyle(Color.dText2)
            Text(asking ? "Debbie uses the camera to read the code." : demo ? "The demo doesn't use the camera." : "The camera isn't available here.")
                .font(DType.body).foregroundStyle(Color.dText2)
                .multilineTextAlignment(.center).fixedSize(horizontal: false, vertical: true)
            if !asking && !demo {
                Text("Allow camera access for Debbie in iPhone Settings, or use an iPhone with a camera.")
                    .font(DType.secondary).foregroundStyle(Color.dText2).multilineTextAlignment(.center)
                    .fixedSize(horizontal: false, vertical: true)
            }
        }
        .padding(Space.s24)
        .frame(maxWidth: .infinity, minHeight: Size.scannerMin)
        .background(Color.dSunken)
    }

    private var usesCamera: Bool {
        #if DEBUG
        if DebbieTestHookCamera.isOn { return true }
        #endif
        return DataScannerViewController.isSupported && (allowed ?? DataScannerViewController.isAvailable)
    }

    /// If the camera has never been asked for, ask now; the screen says what it's for just below the camera.
    private func askIfNeeded() async {
        guard !inDemo, DataScannerViewController.isSupported,
              AVCaptureDevice.authorizationStatus(for: .video) == .notDetermined else { return }
        let granted = await AVCaptureDevice.requestAccess(for: .video)
        allowed = granted && DataScannerViewController.isAvailable
    }

    @ViewBuilder private var camera: some View {
        #if DEBUG
        if DebbieTestHookCamera.isOn {
            DebbieTestHookCamera()
        } else {
            ScannerRepresentable(onPayload: onPayload)
        }
        #else
        ScannerRepresentable(onPayload: onPayload)
        #endif
    }
}

#if DEBUG
/// Debug-only stand-in for the camera, which the Simulator doesn't have (`DEBBIE_FAKE_CAMERA=1`). Like
/// DataScannerViewController's view it has no size of its own, so tests see the layout a real iPhone gets.
struct DebbieTestHookCamera: UIViewControllerRepresentable {
    static var isOn: Bool { ProcessInfo.processInfo.environment["DEBBIE_FAKE_CAMERA"] == "1" }
    func makeUIViewController(context: Context) -> UIViewController {
        let controller = UIViewController()
        controller.view.backgroundColor = UIColor(Color.dText)
        return controller
    }
    func updateUIViewController(_ controller: UIViewController, context: Context) {}
}
#endif

/// What the scanner does with each camera callback (CRAFT §5 QR scanner): it hands one code at a time to the screen,
/// stops for good once the screen takes one, and otherwise keeps looking, ignoring each rejected code for 3 s, so a
/// code's error plays at most once per 3 s (CRAFT §4.1 scanInvalid). Before build 8 the first code of any kind stopped
/// the camera (the fix's review, 00:40); the build-8 review found it remembered only the last rejected code (SCAN-3).
/// The Coordinator is a single call to `take`, so ScanGateTests cover the scanner's own decision (SCAN-1).
nonisolated struct ScanGate {
    static let quiet: TimeInterval = 3
    private(set) var done = false
    private var rejected: [String: Date] = [:]

    func offers(_ payload: String, at now: Date) -> Bool {
        guard !done else { return false }
        if let at = rejected[payload], now.timeIntervalSince(at) < Self.quiet { return false }
        return true
    }

    mutating func record(_ payload: String, accepted: Bool, at now: Date) {
        guard !accepted else { done = true; rejected = [:]; return }
        rejected = rejected.filter { now.timeIntervalSince($0.value) < Self.quiet }
        rejected[payload] = now
    }

    /// One camera callback: the first code it may offer goes to `screen`, which answers whether it took it. Returns
    /// whether to stop the camera.
    mutating func take(_ payloads: [String], at now: Date, screen: (String) -> Bool) -> Bool {
        guard let payload = payloads.first(where: { offers($0, at: now) }) else { return false }
        let accepted = screen(payload)
        record(payload, accepted: accepted, at: now)
        return accepted
    }
}

private struct ScannerRepresentable: UIViewControllerRepresentable {
    let onPayload: (String) -> Bool

    func makeCoordinator() -> Coordinator { Coordinator(onPayload: onPayload) }

    func makeUIViewController(context: Context) -> DataScannerViewController {
        let vc = DataScannerViewController(recognizedDataTypes: [.barcode(symbologies: [.qr])], qualityLevel: .balanced,
                                           recognizesMultipleItems: false, isHighFrameRateTrackingEnabled: false,
                                           isPinchToZoomEnabled: true, isGuidanceEnabled: false, isHighlightingEnabled: false)
        vc.delegate = context.coordinator
        try? vc.startScanning()
        return vc
    }

    /// Scanning starts when the view is made; if the scanner wasn't ready then, it starts on the next update.
    func updateUIViewController(_ vc: DataScannerViewController, context: Context) {
        if !vc.isScanning && !context.coordinator.gate.done { try? vc.startScanning() }
    }

    @MainActor
    final class Coordinator: NSObject, DataScannerViewControllerDelegate {
        let onPayload: (String) -> Bool
        var gate = ScanGate()
        init(onPayload: @escaping (String) -> Bool) { self.onPayload = onPayload }
        func dataScanner(_ scanner: DataScannerViewController, didAdd items: [RecognizedItem], allItems: [RecognizedItem]) {
            let payloads = items.compactMap { item -> String? in
                if case .barcode(let code) = item { return code.payloadStringValue }
                return nil
            }
            if gate.take(payloads, at: .now, screen: onPayload) { scanner.stopScanning() }
        }
    }
}
