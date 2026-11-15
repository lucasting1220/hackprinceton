// tools/design/kit/motion-probe.swift
//
// Re-measures the SwiftUI timing facts that DesignerKit/09-motion quotes (`measuredSteps` in motion.swift):
//   1. how a phase animator paces each icon step (hop, beat, spin) and the typing dots;
//   2. that an icon effect triggered in the same update that removes or replaces its view never shows
//      (Sync Now's arrows, and the pop on Send, I'm On It and Stop).
// It uses the same springs and view structure as IconMotion.swift and Chat.swift, opens a small borderless window in the
// bottom-left corner of the screen for about 9 s, prints what it measured and quits. Not part of the kit's outputs.
//
// Run from the repo root:
//   xcrun swiftc -parse-as-library tools/design/kit/motion-probe.swift -o "${TMPDIR:-/tmp}/motion-probe" && "${TMPDIR:-/tmp}/motion-probe"

import AppKit
import QuartzCore
import SwiftUI

@MainActor final class Probe {
    static var t0 = CACurrentMediaTime()
    static var last: [String: Int] = [:]
    static var log: [String: [(ms: Double, phase: Int)]] = [:]
    static func start(_ title: String) { t0 = CACurrentMediaTime(); print("--- \(title)") }
    static func now() -> Double { (CACurrentMediaTime() - t0) * 1000 }
    static func phase(_ tag: String, _ p: Int) {
        guard last[tag] != p else { return }
        last[tag] = p
        log[tag, default: []].append((now(), p))
        print(String(format: "%8.1f ms  %@ -> phase %d", now(), tag, p))
    }
    static func note(_ s: String) { print(String(format: "%8.1f ms  %@", now(), s)) }
}

let iconQuick = Spring(duration: 0.15, bounce: 0), iconSettle = Spring(duration: 0.25, bounce: 0), present = Spring(duration: 0.50, bounce: 0)

/// A stand-in for DAnimatedIcon: phases with their own springs; the return to phase 0 is instant (nil), as in IconMotion.swift.
struct Effect: View {
    let tag: String
    let scales: [Double]
    let angles: [Double]
    let springs: [Spring?]
    let trigger: Int
    var body: some View {
        Rectangle().frame(width: 12, height: 12)
            .phaseAnimator(Array(scales.indices), trigger: trigger) { content, p in
                let _ = Probe.phase(tag, p)
                content.scaleEffect(scales[p]).rotationEffect(.degrees(angles[p]))
            } animation: { p in springs[p].map { Animation.spring($0) } }
            .onDisappear { Probe.note("\(tag) removed") }
    }
}

struct ProbeView: View {
    @State private var hop = 0
    @State private var beat = 0
    @State private var spin = 0
    @State private var swapTrigger = 0
    @State private var showSwap = true
    @State private var fadeTrigger = 0
    @State private var showFade = true
    @State private var taskTrigger = 0
    @State private var showTask = true
    @State private var dots = false

    var body: some View {
        VStack(spacing: 6) {
            HStack {
                Effect(tag: "hop", scales: [1, 1.1, 1], angles: [0, 0, 0], springs: [nil, iconQuick, iconSettle], trigger: hop)
                Effect(tag: "beat", scales: [1, 1.1, 0.97, 1.06, 1], angles: [0, 0, 0, 0, 0], springs: [nil, iconQuick, iconQuick, iconQuick, iconQuick], trigger: beat)
                Effect(tag: "spin", scales: [1, 1], angles: [0, 360], springs: [nil, present], trigger: spin)
            }
            HStack {
                // Sync Now: the trigger and the removal in one update; the view comes back with the trigger bumped again.
                if showSwap { Effect(tag: "sync arrows", scales: [1, 1], angles: [0, 360], springs: [nil, present], trigger: swapTrigger) }
                // Send → Stop: the trigger and an animated fade-out removal in one update.
                if showFade { Effect(tag: "send pop", scales: [1, 1.1, 1], angles: [0, 0, 0], springs: [nil, iconQuick, iconSettle], trigger: fadeTrigger).transition(.opacity) }
                // I'm On It / Stop: the trigger, then the removal in a main-actor Task.
                if showTask { Effect(tag: "ack pop", scales: [1, 1.1, 1], angles: [0, 0, 0], springs: [nil, iconQuick, iconSettle], trigger: taskTrigger) }
            }
            .animation(.spring(Spring(duration: 0.4, bounce: 0)), value: showFade)
            if dots {
                // DTypingIndicator's dots: the lit dot is opaque and 125 %, the others 35 %.
                PhaseAnimator([0, 1, 2]) { lit in
                    let _ = Probe.phase("typing dots", lit)
                    HStack(spacing: 4) {
                        ForEach(0..<3, id: \.self) { i in
                            Circle().frame(width: 8, height: 8).opacity(lit == i ? 1 : 0.35).scaleEffect(lit == i ? 1.25 : 1)
                        }
                    }
                } animation: { _ in .spring(iconSettle) }
            }
        }
        .frame(width: 160, height: 120)
        .task { await run() }
    }

    private func pause(_ ms: Int) async { try? await Task.sleep(for: .milliseconds(ms)) }

    private func run() async {
        await pause(600)
        Probe.start("hop: quick (150 ms) then settle (250 ms)"); hop += 1; await pause(900)
        Probe.start("beat: four quick steps"); beat += 1; await pause(1100)
        Probe.start("spin: one slow step (present, 500 ms)"); spin += 1; await pause(1000)

        Probe.start("Sync Now: trigger + remove in one update, then show + trigger again")
        swapTrigger += 1; showSwap = false
        await pause(700)
        showSwap = true; swapTrigger += 1
        Probe.note("arrows back")
        await pause(900)

        Probe.start("Send: trigger + animated fade-out removal in one update")
        fadeTrigger += 1; showFade = false
        await pause(900)

        Probe.start("I'm On It / Stop: trigger, removal in a Task")
        taskTrigger += 1
        Task { showTask = false }
        await pause(600)

        Probe.start("typing dots (continuous)"); dots = true; await pause(2000); dots = false
        await pause(100)
        summarize()
        NSApp.terminate(nil)
    }

    private func summarize() {
        // Each entry's time is from the start of its own segment; the trigger lands the effect on phase 1 at about 0 ms.
        func steps(_ tag: String) -> String {
            let run = (Probe.log[tag] ?? []).drop { $0.phase != 1 }
            return run.map { String(Int($0.ms.rounded())) }.joined(separator: " → ") + " ms"
        }
        print("\nSUMMARY")
        print("hop: \(steps("hop")) (expected about 0 → 150 → 400, each within a frame)")
        print("beat: \(steps("beat")) (expected about 0 → 150 → 300 → 450 → 600)")
        print("spin: \(steps("spin")) (expected about 0 → 500)")
        let swapped = (Probe.log["sync arrows"] ?? []).contains { $0.phase == 1 }
        let faded = (Probe.log["send pop"] ?? []).contains { $0.phase == 1 }
        print("Sync Now arrows turned: \(swapped) (expected false)")
        print("Send pop played: \(faded) (expected false)")
        let ack = Probe.log["ack pop"] ?? []
        print("I'm On It pop reached phase 1 at \(ack.first { $0.phase == 1 }.map { Int($0.ms.rounded()) }.map(String.init) ?? "never") ms, then the view was removed (see 'ack pop removed' above; same frame = never visible)")
        let d = (Probe.log["typing dots"] ?? []).map(\.ms)
        if d.count > 3 {
            let steps = zip(d.dropFirst(2), d.dropFirst(3)).map { $1 - $0 }
            print("typing dots: one step every \(Int(steps.min()!.rounded()))–\(Int(steps.max()!.rounded())) ms (expected about 250 ms plus up to a frame)")
        }
    }
}

@main struct Main {
    @MainActor static func main() {
        let app = NSApplication.shared
        app.setActivationPolicy(.accessory)
        let window = NSWindow(contentRect: NSRect(x: 0, y: 0, width: 160, height: 120), styleMask: [.borderless], backing: .buffered, defer: false)
        window.contentView = NSHostingView(rootView: ProbeView())
        window.setFrameOrigin(.zero)
        window.level = .floating
        window.orderFrontRegardless()
        app.run()
    }
}
