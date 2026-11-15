@testable import DebbieDesignSystem
import SwiftUI
import Testing
import UIKit

@MainActor @Suite struct ColorTokenTests {
    func luminance(_ c: UIColor) -> Double {
        var r: CGFloat = 0, g: CGFloat = 0, b: CGFloat = 0, a: CGFloat = 0
        c.getRed(&r, green: &g, blue: &b, alpha: &a)
        func lin(_ v: CGFloat) -> Double { let x = Double(v); return x <= 0.04045 ? x / 12.92 : pow((x + 0.055) / 1.055, 2.4) }
        return 0.2126 * lin(r) + 0.7152 * lin(g) + 0.0722 * lin(b)
    }
    func ratio(_ a: UIColor, _ b: UIColor) -> Double { let x = luminance(a), y = luminance(b); return (max(x, y) + 0.05) / (min(x, y) + 0.05) }

    @Test(arguments: [(UIUserInterfaceStyle.light, UIAccessibilityContrast.normal), (.dark, .normal), (.light, .high), (.dark, .high)])
    func everyPairingMeetsItsThreshold(style: UIUserInterfaceStyle, contrast: UIAccessibilityContrast) {
        let traits = UITraitCollection { $0.userInterfaceStyle = style; $0.accessibilityContrast = contrast }
        let byName = Dictionary(uniqueKeysWithValues: DebbiePalette.all.map { ($0.name, $0.color) })
        for p in DebbiePalette.pairings {
            guard let fg = byName[p.fg]?.resolvedColor(with: traits), let bg = byName[p.bg]?.resolvedColor(with: traits) else { Issue.record("missing \(p.fg)/\(p.bg)"); continue }
            let need = contrast == .high ? p.minHC : p.min
            #expect(ratio(fg, bg) + 0.005 >= need, "\(p.fg) on \(p.bg) [\(style.rawValue),\(contrast.rawValue)] = \(ratio(fg, bg))")
        }
    }
}

@MainActor @Suite struct MotionTests {
    @Test func springsAreCalmAndBounded() {
        for (name, s) in Motion.allSprings {
            #expect(s.bounce >= 0 && s.bounce <= 0.15 + 1e-9, "\(name) bounce")
            #expect((0.15...0.5).contains(s.duration), "\(name) duration")
            #expect(s.settlingDuration <= 0.8, "\(name) settling \(s.settlingDuration)")
        }
    }
    @Test func reduceMotionSubstitutes() {
        let reduced = MotionPolicy(reduce: true)
        #expect(reduced.state == Motion.crossFade)
        #expect(reduced.arriveAnimation == Motion.fadeIn)
    }
}

@MainActor @Suite struct HapticMapTests {
    @Test func onlyFeedbackThatPlaysOnIPhone() {
        let allowed: [SensoryFeedback] = [.success, .warning, .error, .selection, .impact(weight: .light), .impact(weight: .medium), .impact(weight: .heavy)]
        for event in DebbieHaptic.allCases { #expect(allowed.contains(event.feedback), "\(event)") }
    }
}
