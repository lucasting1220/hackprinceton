@testable import DebbieFeatures
import Foundation
import Testing

/// The QR scanner's own decision (D-035; CRAFT §5 QR scanner). The camera's delegate is a single call to
/// `ScanGate.take`, so these tests run the code that decides whether the camera stops: build 7 stopped it on the first
/// code of any kind, and build 8's first gate remembered only the last rejected code (the build-8 review, SCAN-1/3).
@Suite struct ScanGateTests {
    let t0 = Date(timeIntervalSince1970: 1_000_000)

    /// A screen that takes only `right`, and remembers what it was handed.
    final class Screen {
        var handed: [String] = []
        func take(_ payload: String) -> Bool { handed.append(payload); return payload == "right" }
    }

    @Test func aRejectedCodeKeepsTheCameraLookingAndTheRightOneStopsIt() {
        var gate = ScanGate()
        let screen = Screen()
        let afterWrong = gate.take(["wrong"], at: t0, screen: screen.take)
        #expect(!afterWrong, "keep looking after a wrong code")
        let afterRight = gate.take(["right"], at: t0.addingTimeInterval(0.5), screen: screen.take)
        #expect(afterRight, "stop on the code the screen takes")
        #expect(gate.done)
        let afterDone = gate.take(["right"], at: t0.addingTimeInterval(1), screen: screen.take)
        #expect(!afterDone, "nothing after that")
        #expect(screen.handed == ["wrong", "right"])
    }

    @Test func theSameRejectedCodeWaitsThreeSeconds() {
        var gate = ScanGate()
        let screen = Screen()
        _ = gate.take(["wrong"], at: t0, screen: screen.take)
        _ = gate.take(["wrong"], at: t0.addingTimeInterval(2.9), screen: screen.take)
        _ = gate.take(["wrong"], at: t0.addingTimeInterval(3.1), screen: screen.take)
        #expect(screen.handed == ["wrong", "wrong"], "once, then again only after 3 s")
    }

    @Test func alternatingWrongCodesEachWaitThreeSeconds() {
        var gate = ScanGate()
        let screen = Screen()
        for (i, code) in ["a", "b", "a", "b", "a"].enumerated() { _ = gate.take([code], at: t0.addingTimeInterval(Double(i) * 0.5), screen: screen.take) }
        #expect(screen.handed == ["a", "b"], "panning between two wrong codes hands each over once in 3 s")
        _ = gate.take(["a"], at: t0.addingTimeInterval(3.1), screen: screen.take)
        #expect(screen.handed == ["a", "b", "a"])
    }

    @Test func oneCodePerCallbackAndAHeldBackCodeLetsTheNextThrough() {
        var gate = ScanGate()
        let screen = Screen()
        _ = gate.take(["wrong", "other"], at: t0, screen: screen.take)
        #expect(screen.handed == ["wrong"], "one code per camera callback")
        let stopped = gate.take(["wrong", "right"], at: t0.addingTimeInterval(0.2), screen: screen.take)
        #expect(stopped, "the held-back code doesn't hide the next")
        #expect(screen.handed == ["wrong", "right"])
    }

    @Test func aFrameWithNoCodesChangesNothing() {
        var gate = ScanGate()
        let screen = Screen()
        let stopped = gate.take([], at: t0, screen: screen.take)
        #expect(!stopped)
        #expect(!gate.done && screen.handed.isEmpty)
    }
}
