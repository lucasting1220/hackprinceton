// tools/design/kit/motion.swift
//
// Designer kit, parts 09-motion and 10-haptics.
// Reads the motion, icon-effect and haptic tokens from the app's Swift sources, simulates every spring, fits curves for
// design tools, draws curves.png and writes the Markdown and JSON. Run it through the wrapper, from the repo root:
//
//     tools/design/kit/motion.sh
//
// Writes (all regenerated on every run):
//     DesignerKit/09-motion/motion.md, motion-tokens.json, curves.png, icon-animations.md
//     DesignerKit/10-haptics/haptics.md
//
// The prose is written by hand inside this file. So that it can't go stale silently, the script stops with an error
// when a token appears or disappears without a description, or when a code fact the prose relies on (`facts`) changes.
// The SwiftUI timing facts quoted from `motion-probe.swift` (same folder) are re-measured by running that probe.

import AppKit
import CoreText
import Foundation
import ImageIO
import SwiftUI
import UniformTypeIdentifiers

// MARK: - Paths (relative to the repo root)

let src = "Packages/DebbieKit/Sources"
let motionPath = "\(src)/DebbieDesignSystem/Motion/Motion.swift"
let iconPath = "\(src)/DebbieDesignSystem/Motion/IconMotion.swift"
let hapticPath = "\(src)/DebbieDesignSystem/Haptics/Haptics.swift"
let colorsPath = "Design/tokens/colors.json"
let outMotion = "DesignerKit/09-motion"
let outHaptics = "DesignerKit/10-haptics"
let scanRoots = [src, "App", "NotificationService"]

// MARK: - Small helpers

func fail(_ message: String) -> Never {
    FileHandle.standardError.write(Data("motion.swift: \(message)\n".utf8))
    exit(1)
}

func readText(_ path: String) -> String {
    guard let text = try? String(contentsOfFile: path, encoding: .utf8) else {
        fail("can't read \(path); run tools/design/kit/motion.sh from the repo root")
    }
    return text
}

func write(_ path: String, _ data: Data) {
    let url = URL(fileURLWithPath: path)
    do {
        try FileManager.default.createDirectory(at: url.deletingLastPathComponent(), withIntermediateDirectories: true)
        try data.write(to: url, options: .atomic)
    } catch { fail("can't write \(path): \(error)") }
    print("wrote \(path) (\(data.count) bytes)")
}

func write(_ path: String, text: String) { write(path, Data(text.utf8)) }

func captures(_ pattern: String, in text: String) -> [[String]] {
    guard let regex = try? NSRegularExpression(pattern: pattern) else { fail("bad pattern \(pattern)") }
    let ns = text as NSString
    return regex.matches(in: text, range: NSRange(location: 0, length: ns.length)).map { match in
        (0..<match.numberOfRanges).map { i in
            let r = match.range(at: i)
            return r.location == NSNotFound ? "" : ns.substring(with: r)
        }
    }
}

func section(_ text: String, from start: String, to end: String) -> String {
    guard let a = text.range(of: start) else { fail("can't find `\(start)`") }
    guard let b = text.range(of: end, range: a.upperBound..<text.endIndex) else { fail("can't find `\(end)` after `\(start)`") }
    return String(text[a.lowerBound..<b.lowerBound])
}

/// Fixed decimals, never "-0".
func fixed(_ x: Double, _ digits: Int) -> String {
    let p = pow(10.0, Double(digits))
    let r = (x * p).rounded() / p
    return String(format: "%.\(digits)f", r == 0 ? 0 : r)
}

/// Up to `digits` decimals, trailing zeros removed.
func short(_ x: Double, _ digits: Int) -> String {
    var s = fixed(x, digits)
    if s.contains(".") {
        while s.hasSuffix("0") { s.removeLast() }
        if s.hasSuffix(".") { s.removeLast() }
    }
    return s
}

func msInt(_ seconds: Double) -> Int { Int((seconds * 1000).rounded()) }
func ms(_ seconds: Double) -> String { "\(msInt(seconds)) ms" }
func pct(_ fraction: Double, _ digits: Int = 1) -> String { fixed(fraction * 100, digits) + " %" }

func table(_ header: [String], _ rows: [[String]]) -> String {
    var lines = ["| " + header.joined(separator: " | ") + " |", "|" + header.map { _ in "---" }.joined(separator: "|") + "|"]
    for row in rows { lines.append("| " + row.map { $0.replacingOccurrences(of: "|", with: "\\|") }.joined(separator: " | ") + " |") }
    return lines.joined(separator: "\n")
}

func fileName(_ path: String) -> String { (path as NSString).lastPathComponent }

// MARK: - Ordered JSON

indirect enum JSON {
    case object([(String, JSON)]), array([JSON]), string(String), number(Double, Int), integer(Int), bool(Bool), null

    var isScalar: Bool {
        switch self { case .object, .array: false; default: true }
    }

    func render(_ indent: String = "") -> String {
        let inner = indent + "  "
        switch self {
        case .object(let pairs):
            if pairs.isEmpty { return "{}" }
            return "{\n" + pairs.map { inner + jsonQuote($0.0) + ": " + $0.1.render(inner) }.joined(separator: ",\n") + "\n" + indent + "}"
        case .array(let items):
            if items.isEmpty { return "[]" }
            if items.allSatisfy(\.isScalar) { return "[" + items.map { $0.render(inner) }.joined(separator: ", ") + "]" }
            return "[\n" + items.map { inner + $0.render(inner) }.joined(separator: ",\n") + "\n" + indent + "]"
        case .string(let s): return jsonQuote(s)
        case .number(let x, let digits): return short(x, digits)
        case .integer(let i): return String(i)
        case .bool(let b): return b ? "true" : "false"
        case .null: return "null"
        }
    }
}

func jsonQuote(_ s: String) -> String {
    var out = "\""
    for ch in s.unicodeScalars {
        switch ch {
        case "\"": out += "\\\""
        case "\\": out += "\\\\"
        case "\n": out += "\\n"
        case "\t": out += "\\t"
        default:
            if ch.value < 0x20 { out += String(format: "\\u%04x", ch.value) } else { out.unicodeScalars.append(ch) }
        }
    }
    return out + "\""
}

// MARK: - Code facts the prose relies on (the script stops if one changes)

struct Fact { let file: String; let snippet: String; let why: String }
let ds = "\(src)/DebbieDesignSystem"
let features = "\(src)/DebbieFeatures"
let facts: [Fact] = [
    Fact(file: "\(ds)/Components/Components.swift", snippet: ".scaleEffect(pressed && !motion.reduce ? 0.97 : 1)", why: "text buttons press to 97 %"),
    Fact(file: "\(ds)/Components/Components.swift", snippet: "case .primary: return pressed ? .dMintPressed : .dMint", why: "mint button's pressed colour"),
    Fact(file: "\(ds)/Components/Components.swift", snippet: "case .urgent: return pressed ? .dUrgentPressed : .dUrgentFill", why: "red button's pressed colour"),
    Fact(file: "\(ds)/Components/Components.swift", snippet: "case .secondary, .destructive: return pressed ? .dSurfacePressed : .dSurface", why: "grey button's pressed colour"),
    Fact(file: "\(ds)/Components/Components.swift", snippet: ".background(configuration.isPressed ? Color.dSurfacePressed : .clear, in: Circle())", why: "icon buttons show a pressed circle"),
    Fact(file: "\(ds)/Components/Components.swift", snippet: "Circle().trim(from: 0, to: 0.7)", why: "spinner arc is 70 %"),
    Fact(file: "\(ds)/Components/Components.swift", snippet: "StrokeStyle(lineWidth: 2.5, lineCap: .round)", why: "spinner stroke"),
    Fact(file: "\(ds)/Components/Components.swift", snippet: ".frame(width: 18, height: 18)", why: "spinner size"),
    Fact(file: "\(ds)/Components/Components.swift", snippet: ".animation(Motion.spin, value: on)", why: "spinner ignores Reduce Motion"),
    Fact(file: "\(ds)/Components/Components.swift", snippet: "selected ? Color.dMintTint : Color.dSurface", why: "role card fill"),
    Fact(file: "\(ds)/Components/Components.swift", snippet: "strokeBorder(selected ? Color.dAccent : Color.dBorder, lineWidth: selected ? 2.5 : 1)", why: "role card outline"),
    Fact(file: "\(ds)/Components/Components.swift", snippet: ".animation(motion.state, value: selected)", why: "role card animates on state"),
    Fact(file: "\(ds)/Components/Components.swift", snippet: "Capsule().fill(configuration.isOn ? Color.dMint : Color.dSunken).frame(width: 52, height: 32)", why: "switch track"),
    Fact(file: "\(ds)/Components/Components.swift", snippet: ".frame(width: 24, height: 24)", why: "switch knob"),
    Fact(file: "\(ds)/Components/Components.swift", snippet: ".animation(motion.state, value: configuration.isOn)", why: "switch animates on state"),
    Fact(file: "\(ds)/Components/Components.swift", snippet: "public init(_ title: String, icon: String, effect: DIconEffect = .pop, plays: Int)", why: "DButtonLabel's default effect is pop"),
    Fact(file: "\(ds)/Components/Chat.swift", snippet: ".scaleEffect(configuration.isPressed && !motion.reduce ? 0.95 : 1)", why: "chips press to 95 %"),
    Fact(file: "\(ds)/Components/Chat.swift", snippet: ".scaleEffect(configuration.isPressed && !motion.reduce ? 0.92 : 1)", why: "Send/Stop press to 92 %"),
    Fact(file: "\(ds)/Components/Chat.swift", snippet: "PhaseAnimator([0, 1, 2]) { lit in dots(lit: lit) } animation: { _ in Motion.iconSettle }", why: "typing dots step on iconSettle"),
    Fact(file: "\(ds)/Components/Chat.swift", snippet: ".opacity(lit == nil || lit == i ? 1 : 0.35)", why: "typing dot opacity"),
    Fact(file: "\(ds)/Components/Chat.swift", snippet: ".scaleEffect(lit == i ? 1.25 : 1)", why: "typing dot scale"),
    Fact(file: "\(ds)/Components/Chat.swift", snippet: ".frame(width: Space.s8, height: Space.s8)", why: "typing dot size"),
    Fact(file: "\(ds)/Components/Chat.swift", snippet: #"motion.reduce ? "Debbie is writing…" : nil"#, why: "typing words under Reduce Motion"),
    Fact(file: "\(ds)/Components/Chat.swift", snippet: ".animation(motion.state, value: busy)", why: "Send/Stop swap on state"),
    Fact(file: "\(ds)/Chrome/DebbieTabBar.swift", snippet: "withAnimation(motion.tabSelect) { selection = tab.id }", why: "tab selection animates on tabSelect"),
    Fact(file: "\(ds)/Chrome/DebbieTabBar.swift", snippet: #"matchedGeometryEffect(id: "highlight", in: highlight)"#, why: "highlight slides between tabs"),
    Fact(file: "\(ds)/Chrome/DebbieTabBar.swift", snippet: "Capsule().fill(Color.dMintTint).transition(Motion.swap)", why: "highlight fades under Reduce Motion"),
    Fact(file: "\(ds)/Chrome/DebbieTabBar.swift", snippet: ".scaleEffect(configuration.isPressed && !motion.reduce ? 0.97 : 1)", why: "tab items press to 97 %"),
    Fact(file: "\(ds)/Chrome/DebbieTabBar.swift", snippet: ".foregroundStyle(selected ? Color.dAccent : Color.dText2)", why: "tab label colours"),
    Fact(file: "\(ds)/Chrome/DebbieCornerButton.swift", snippet: ".scaleEffect(configuration.isPressed && !motion.reduce ? 0.97 : 1)", why: "gear presses to 97 %"),
    Fact(file: "\(ds)/Motion/IconMotion.swift", snippet: ".animation(motion.state, value: active)", why: "outline-to-filled swap on state"),
    Fact(file: "\(ds)/Motion/IconMotion.swift", snippet: "if motion.reduce {\n            glyph\n", why: "no icon movement under Reduce Motion"),
    Fact(file: "\(ds)/Motion/Motion.swift", snippet: "MotionPolicy(reduce: forced || reduceMotion || UIAccessibility.prefersCrossFadeTransitions)", why: "what turns the policy on"),
    Fact(file: "\(ds)/Persona/DebbieAvatar.swift", snippet: "sin(2 * .pi * t / 4.8)", why: "breath period"),
    Fact(file: "\(ds)/Persona/DebbieAvatar.swift", snippet: "breath = 1 + 0.008 * CGFloat(breathPhase)", why: "breath amount"),
    Fact(file: "\(ds)/Persona/DebbieAvatar.swift", snippet: "lift = -0.002 * CGFloat(breathPhase)", why: "head lift"),
    Fact(file: "\(ds)/Persona/DebbieAvatar.swift", snippet: "tilt = 2.0 * sin(2 * .pi * t / 7.3)", why: "head tilt"),
    Fact(file: "\(ds)/Persona/DebbieAvatar.swift", snippet: "let window = 4.4", why: "blink window"),
    Fact(file: "\(ds)/Persona/DebbieAvatar.swift", snippet: "hash(index) * 2.0", why: "blink start range"),
    Fact(file: "\(ds)/Persona/DebbieAvatar.swift", snippet: "if d < 0.04 { return .squash }", why: "blink squash"),
    Fact(file: "\(ds)/Persona/DebbieAvatar.swift", snippet: "if d < 0.173 { return .closed }", why: "blink closed"),
    Fact(file: "\(ds)/Persona/DebbieAvatar.swift", snippet: "if d < 0 || d >= 0.24 { return nil }", why: "blink length"),
    Fact(file: "\(ds)/Persona/DebbieAvatar.swift", snippet: "anchor: UnitPoint(x: 0.5, y: 0.471)", why: "blink squash line"),
    Fact(file: "\(ds)/Persona/DebbieAvatar.swift", snippet: "anchor: UnitPoint(x: 0.5, y: 0.75)", why: "head pivot"),
    Fact(file: "\(ds)/Persona/DebbieAvatar.swift", snippet: "minimumInterval: 1.0 / 30.0", why: "idle frame rate"),
    Fact(file: "\(ds)/Persona/DebbieAvatar.swift", snippet: "lively ?? (size >= Size.avatarGuide)", why: "idle only at guide size and up"),
    Fact(file: "\(ds)/Tokens/Tokens.swift", snippet: "avatarSmall: CGFloat = 44, avatarGuide: CGFloat = 64, avatarHero: CGFloat = 148", why: "avatar sizes"),
    Fact(file: "\(ds)/Tokens/Tokens.swift", snippet: "tabAvatar: CGFloat = 30", why: "tab avatar size"),
    Fact(file: "\(features)/Views.swift", snippet: ".animation(Motion.crossFade, value: model.phase)", why: "whole-screen cross-fade"),
    Fact(file: "\(features)/Views.swift", snippet: ".transition(motion.step(forward: forward))", why: "onboarding push"),
    Fact(file: "\(features)/Views.swift", snippet: ".animation(motion.state, value: step)", why: "onboarding on state"),
    Fact(file: "\(features)/Views.swift", snippet: ".animation(Motion.tabFade, value: tab)", why: "tab pages cross-fade"),
    Fact(file: "\(features)/Views.swift", snippet: ".animation(motion.state, value: barHidden)", why: "tab bar steps aside on state"),
    Fact(file: "\(features)/Views.swift", snippet: ".transition(motion.alertCard)", why: "alert cards arrive from the top and leave by fading (D-034)"),
    Fact(file: "\(features)/Views.swift", snippet: #".animation(motion.arriveAnimation, value: model.alerts.map { "\($0.alertID)|\($0.acknowledgedAt != nil)" })"#, why: "alert list animates on new IDs and on acknowledgement (D-034)"),
    Fact(file: "\(features)/Views.swift", snippet: ".animation(Motion.crossFade, value: stateKey)", why: "live view panels cross-fade"),
    Fact(file: "\(features)/Views.swift", snippet: #"DAnimatedIcon("sync", effect: .spin, trigger: spins)"#, why: "the sync arrows stay while sending, so their turn shows (D-034)"),
    Fact(file: "\(features)/Views.swift", snippet: "        spins += 1\n        syncing = true\n", why: "the spin is triggered in the same update that hides the arrows"),
    Fact(file: "\(features)/Views.swift", snippet: ".onChange(of: model.lastReading?.t) { beats += 1 }", why: "heart beats on a new reading"),
    Fact(file: "\(features)/Views.swift", snippet: "withAnimation(motion.tabSelect) { tab = .home }", why: "chat's Open jumps to Home on tabSelect"),
    Fact(file: "\(features)/Views.swift", snippet: "Button { stops += 1; model.stopLiveView() }", why: "Stop's pop"),
    Fact(file: "\(features)/Views.swift", snippet: "{ role = .caregiver; choiceCount += 1 }", why: "choiceChanged plays on every tap"),
    Fact(file: "\(features)/DebbieChat.swift", snippet: ".transition(motion.reduce ? Motion.swap : Motion.arrive)", why: "bubbles arrive"),
    Fact(file: "\(features)/DebbieChat.swift", snippet: ".animation(motion.arriveAnimation, value: chat.messages.count)", why: "bubbles on alertArrive"),
    Fact(file: "\(features)/DebbieChat.swift", snippet: ".animation(motion.state, value: focused)", why: "composer focus on state"),
    Fact(file: "\(features)/DebbieChat.swift", snippet: ".animation(motion.state, value: chat.showsSuggestions)", why: "suggestions fade on state"),
    Fact(file: "\(features)/DebbieChatModel.swift", snippet: "guard ContinuousClock.now - lastShown >= .milliseconds(80) else { continue }", why: "80 ms coalescing"),
    Fact(file: "\(features)/DebbieChatModel.swift", snippet: "quiet.disablesAnimations = true", why: "streamed text isn't animated"),
    Fact(file: "\(features)/DebbieChatModel.swift", snippet: "try? await Task.sleep(for: .seconds(3))", why: "3 s before the 'Summarizing' words"),
    Fact(file: "\(features)/AppModel.swift", snippet: "public func startRefreshing(every seconds: TimeInterval = 10)", why: "refresh every 10 s"),
    Fact(file: "\(features)/AppModel.swift", snippet: "if newUrgent { urgentArrivals += 1 }", why: "urgent haptic trigger"),
    Fact(file: "\(features)/AppModel.swift", snippet: "        phase = .welcome\n        return told\n", why: "unpair leaves Settings before reporting"),
    Fact(file: "\(features)/DemoControls.swift", snippet: #"case .success: "success, two quick rising taps""#, why: "success feel"),
    Fact(file: "\(features)/DemoControls.swift", snippet: #"case .warning: "warning, two taps that fall""#, why: "warning feel"),
    Fact(file: "\(features)/DemoControls.swift", snippet: #"case .error: "error, three quick taps""#, why: "error feel"),
    Fact(file: "\(features)/DemoControls.swift", snippet: #"case .selection: "selection, a faint tick""#, why: "selection feel"),
    Fact(file: "\(features)/DemoControls.swift", snippet: #"default: "a light tap""#, why: "impact feel"),
    Fact(file: "\(src)/DebbieCareScreens/CareScreens.swift", snippet: "trigger: care?.heartRateBPM ?? 0", why: "Home's heart beats when the number changes"),
    Fact(file: "\(src)/DebbieCareScreens/CareScreens.swift", snippet: #"DButtonLabel("I'm On It", icon: "ack", plays: plays)"#, why: "I'm On It's pop"),
    Fact(file: "App/DemoHome/DemoHomeService.swift", snippet: "try await Task.sleep(for: .milliseconds(600))", why: "demo sync takes 0.6 s"),
    Fact(file: "App/DemoHome/DemoHomeService.swift", snippet: "try await Task.sleep(for: .seconds(5))", why: "demo pairing confirms after 5 s"),
    Fact(file: "App/DemoHome/DemoHomeService.swift", snippet: "func approveLaptop(_ join: JoinQR) async throws { try await Task.sleep(for: .seconds(1)) }", why: "demo approval takes 1 s"),
    Fact(file: "App/DemoHome/DemoHomeService.swift", snippet: #"if age < 1.5 { return make("requested") }"#, why: "demo live view asks for ~2 s"),
    Fact(file: "App/DemoHome/FakeMediaEngine.swift", snippet: "try await Task.sleep(for: .milliseconds(900))", why: "demo camera connects in 0.9 s"),
]
for fact in facts where !readText(fact.file).contains(fact.snippet) {
    fail("\(fact.file) no longer contains `\(fact.snippet)` (\(fact.why)). Update the prose in tools/design/kit/motion.swift, then this fact.")
}

// MARK: - Colours (light values, from Design/tokens/colors.json)

let palette: [String: String] = {
    guard let data = FileManager.default.contents(atPath: colorsPath),
          let json = try? JSONSerialization.jsonObject(with: data) as? [String: Any],
          let tokens = json["tokens"] as? [String: [String: Any]] else { fail("can't read \(colorsPath)") }
    var map: [String: String] = [:]
    for (name, values) in tokens { if let hex = values["light"] as? String { map[name] = hex } }
    return map
}()

func hex(_ token: String) -> String {
    guard let value = palette[token] else { fail("colour token \(token) is missing from \(colorsPath)") }
    return value
}

func cgColor(_ token: String, _ alpha: CGFloat = 1) -> CGColor {
    var v: UInt64 = 0
    Scanner(string: String(hex(token).dropFirst())).scanHexInt64(&v)
    return CGColor(srgbRed: CGFloat((v >> 16) & 0xFF) / 255, green: CGFloat((v >> 8) & 0xFF) / 255, blue: CGFloat(v & 0xFF) / 255, alpha: alpha)
}

/// "`mint.fill` #6CDCB0"
func swatch(_ token: String) -> String { "`\(token)` \(hex(token))" }

// MARK: - Parse Motion.swift

let motionText = readText(motionPath)

struct SpringModel {
    let name: String
    let duration: Double
    let bounce: Double
    var omega: Double { 2 * Double.pi / duration }
    var zeta: Double { bounce >= 0 ? 1 - bounce : 1 / (1 + bounce) }
    let mass = 1.0
    var stiffness: Double { pow(2 * Double.pi / duration, 2) }
    var damping: Double { bounce >= 0 ? (1 - bounce) * 4 * Double.pi / duration : 4 * Double.pi / (duration * (1 + bounce)) }

    /// Closed-form step response from 0 to 1, starting at rest.
    func value(_ t: Double) -> Double {
        let w = omega, z = zeta
        if abs(z - 1) < 1e-12 { return 1 - (1 + w * t) * exp(-w * t) }
        if z < 1 {
            let wd = w * (1 - z * z).squareRoot()
            return 1 - exp(-z * w * t) * (cos(wd * t) + (z * w / wd) * sin(wd * t))
        }
        let s = (z * z - 1).squareRoot()
        let r1 = -w * (z - s), r2 = -w * (z + s)
        return 1 + (r2 * exp(r1 * t) - r1 * exp(r2 * t)) / (r1 - r2)
    }
}

let springSpecs = captures(#"static let (\w+)Spring = Spring\(duration: ([0-9.]+), bounce: (-?[0-9.]+)\)"#, in: motionText).map {
    SpringModel(name: $0[1], duration: Double($0[2])!, bounce: Double($0[3])!)
}
let springOrder = captures(#"\("(\w+)", (\w+)Spring\)"#, in: section(motionText, from: "allSprings", to: "]\n")).map { row -> String in
    guard row[1] == row[2] else { fail("Motion.allSprings pairs \(row[1]) with \(row[2])Spring") }
    return row[1]
}
guard springOrder.count == springSpecs.count, Set(springOrder) == Set(springSpecs.map(\.name)) else {
    fail("Motion.allSprings doesn't list every spring in Motion.swift")
}
let springModels = springOrder.map { name in springSpecs.first { $0.name == name }! }

struct AnimToken { let name: String; let code: String; let kind: String; let springRef: String; let duration: Double; let repeats: Bool; let autoreverses: Bool }
let animTokens = captures(#"static let (\w+) = (Animation\.(spring|easeInOut|easeOut|easeIn|linear)\((?:(\w+)Spring|duration: ([0-9.]+))\)(\.repeatForever\(autoreverses: (true|false)\))?)"#, in: motionText).map {
    AnimToken(name: $0[1], code: $0[2], kind: $0[3], springRef: $0[4], duration: Double($0[5]) ?? 0, repeats: !$0[6].isEmpty, autoreverses: $0[7] == "true")
}
for a in animTokens where a.kind == "spring" && (a.name != a.springRef || !springOrder.contains(a.springRef)) {
    fail("Motion.\(a.name) uses \(a.springRef)Spring; the kit assumes each spring animation shares its spring's name")
}
for name in springOrder where !animTokens.contains(where: { $0.name == name }) { fail("Motion.\(name)Spring has no Animation token") }
let easedTokens = animTokens.filter { $0.kind != "spring" }

let transitionTokens = captures(#"static let (\w+) = ((?:AnyTransition|ContentTransition)\.[^\n]+)"#, in: motionText).map { (name: $0[1], code: $0[2]) }

let policyText = section(motionText, from: "public struct MotionPolicy", to: "private struct MotionPolicyKey")
let policyMembers = captures(#"public (?:var (\w+): [\w?]+|func (\w+)\([^)]*\) -> [\w?]+) \{ ([^\n]+) \}"#, in: policyText).map {
    (name: $0[1].isEmpty ? $0[2] : $0[1], body: $0[3])
}

// MARK: - Parse IconMotion.swift

let iconText = readText(iconPath)

struct Pose {
    var step = 0
    var scale = 1.0, sx = 1.0, sy = 1.0, angle = 0.0, dy = 0.0
    var pace = "settle"
    var scaleX: Double { sx * scale }
    var scaleY: Double { sy * scale }
}

struct IconEffect { let name: String; let meaning: String; let anchor: String; let poses: [Pose] }

guard let defaultPace = captures(#"var pace: Pace = \.(\w+)"#, in: iconText).first?[1] else { fail("IconPose has no default pace") }
for row in captures(#"var (scale|sx|sy|angle|dy): (?:CGFloat|Double) = ([0-9.]+)"#, in: iconText) {
    let expected = ["scale": 1.0, "sx": 1.0, "sy": 1.0, "angle": 0.0, "dy": 0.0][row[1]]!
    if Double(row[2]) != expected { fail("IconPose.\(row[1]) now defaults to \(row[2]); update Pose in motion.swift") }
}
let effectComments = captures(#"/// ([^\n]+)\n\s+case (\w+)\n"#, in: section(iconText, from: "public enum DIconEffect", to: "var anchor: UnitPoint")).map { (name: $0[2], comment: $0[1]) }
let anchorBlock = section(iconText, from: "var anchor: UnitPoint", to: "var poses")
var anchors: [String: String] = [:]
for row in captures(#"case ([.\w, ]+): \.(\w+)"#, in: anchorBlock) {
    for name in row[1].split(separator: ",") { anchors[name.trimmingCharacters(in: .whitespaces).trimmingCharacters(in: CharacterSet(charactersIn: "."))] = row[2] }
}
guard let defaultAnchor = captures(#"default: \.(\w+)"#, in: anchorBlock).first?[1] else { fail("DIconEffect.anchor has no default") }
let paceTokens: [String: String] = Dictionary(uniqueKeysWithValues: captures(#"case \.(\w+): return Motion\.(\w+)"#, in: section(iconText, from: "var animation: Animation?", to: "public struct DAnimatedIcon")).map { ($0[1], $0[2]) })

let iconEffects: [IconEffect] = captures(#"case \.(\w+): \[([^\]]*)\]"#, in: section(iconText, from: "var poses: [IconPose]", to: "public struct IconPose")).map { row in
    let poses = captures(#"(\.rest|IconPose\(([^)]*)\))"#, in: row[2]).map { item -> Pose in
        if item[1] == ".rest" { return Pose() }
        var pose = Pose(pace: defaultPace)
        for pair in item[2].components(separatedBy: ", ") {
            let kv = pair.components(separatedBy: ": ")
            guard kv.count == 2 else { fail("can't read IconPose argument `\(pair)`") }
            let value = kv[1].trimmingCharacters(in: .whitespaces)
            switch kv[0].trimmingCharacters(in: .whitespaces) {
            case "step": pose.step = Int(value)!
            case "scale": pose.scale = Double(value)!
            case "sx": pose.sx = Double(value)!
            case "sy": pose.sy = Double(value)!
            case "angle": pose.angle = Double(value)!
            case "dy": pose.dy = Double(value)!
            case "pace": pose.pace = String(value.dropFirst())
            default: fail("unknown IconPose argument `\(pair)`")
            }
        }
        return pose
    }
    guard let meaning = effectComments.first(where: { $0.name == row[1] })?.comment else { fail("DIconEffect.\(row[1]) has no doc comment") }
    return IconEffect(name: row[1], meaning: meaning, anchor: anchors[row[1]] ?? defaultAnchor, poses: poses)
}
guard iconEffects.count == effectComments.count else { fail("every DIconEffect case needs poses") }
for effect in iconEffects {
    for (i, pose) in effect.poses.enumerated() where pose.step != i { fail("DIconEffect.\(effect.name) pose \(i) has step \(pose.step)") }
    for pose in effect.poses.dropFirst() where paceTokens[pose.pace] == nil { fail("pace .\(pose.pace) has no token") }
}

// MARK: - Parse Haptics.swift

let hapticText = readText(hapticPath)
let hapticNames: [String] = captures(#"case ([a-zA-Z, ]+)\n"#, in: section(hapticText, from: "public enum DebbieHaptic", to: "public var feedback")).flatMap {
    $0[1].split(separator: ",").map { $0.trimmingCharacters(in: .whitespaces) }
}
var hapticFeedback: [String: String] = [:]
for row in captures(#"case ((?:\.\w+(?:, )?)+): \.([^\n]+)"#, in: section(hapticText, from: "public var feedback", to: "public extension View")) {
    for name in row[1].split(separator: ",") { hapticFeedback[name.trimmingCharacters(in: CharacterSet(charactersIn: " ."))] = row[2].trimmingCharacters(in: .whitespaces) }
}
for name in hapticNames where hapticFeedback[name] == nil { fail("DebbieHaptic.\(name) has no feedback") }

// MARK: - Call sites

struct CodeLine { let file: String; let number: Int; let text: String }
let codeLines: [CodeLine] = {
    var out: [CodeLine] = []
    for root in scanRoots {
        guard let walker = FileManager.default.enumerator(atPath: root) else { continue }
        var files: [String] = []
        for case let rel as String in walker where rel.hasSuffix(".swift") && !rel.contains("Tests") && !rel.contains("DebbieDebugTools") {
            files.append(root + "/" + rel)
        }
        for path in files.sorted() {
            for (i, line) in readText(path).components(separatedBy: "\n").enumerated() { out.append(CodeLine(file: path, number: i + 1, text: line)) }
        }
    }
    return out
}()
func isComment(_ line: CodeLine) -> Bool { line.text.trimmingCharacters(in: .whitespaces).hasPrefix("//") }
func ref(_ line: CodeLine) -> String { "\(fileName(line.file)):\(line.number)" }
func refs(_ lines: [CodeLine]?) -> String {
    guard let lines, !lines.isEmpty else { return "none" }
    var seen = Set<String>()
    return lines.map(ref).filter { seen.insert($0).inserted }.joined(separator: ", ")
}

var motionRefs: [String: [CodeLine]] = [:]
for line in codeLines where !line.file.hasSuffix("/Motion/Motion.swift") && !isComment(line) {
    for m in captures(#"\b(Motion|motion)\.(\w+)"#, in: line.text) { motionRefs["\(m[1]).\(m[2])", default: []].append(line) }
}
var iconRefs: [String: [CodeLine]] = [:]
for line in codeLines where !line.file.hasSuffix("IconMotion.swift") && !isComment(line) {
    var effect = captures(#"effect: \.(\w+)"#, in: line.text).first?[1]
    if effect == nil, line.text.contains("DButtonLabel(") { effect = "pop" }
    if let effect { iconRefs[effect, default: []].append(line) }
}
var hapticRefs: [String: [CodeLine]] = [:]
for (i, line) in codeLines.enumerated() where line.text.contains("debbieHaptic(") && !isComment(line) {
    if line.file.hasSuffix("/Haptics.swift") || line.file.hasSuffix("DemoControls.swift") { continue }
    if let name = captures(#"debbieHaptic\(\.(\w+)"#, in: line.text).first?[1] {
        hapticRefs[name, default: []].append(line)
    } else if line.text.contains("debbieHaptic(trigger:"), i + 1 < codeLines.count, codeLines[i + 1].file == line.file {
        for m in captures(#"\.(\w+)\b"#, in: codeLines[i + 1].text) where hapticNames.contains(m[1]) { hapticRefs[m[1], default: []].append(line) }
    }
}

// MARK: - Curated descriptions (plain English; the script stops if a token has none)

struct SpringInfo { let usedFor: String; let seen: String; let reduceMotion: String; let inBuild3: Bool }
let springInfo: [String: SpringInfo] = [
    "press": SpringInfo(usedFor: "The pressed look of every Debbie control, going down and coming back up.",
                        seen: "Text buttons 97 % with a pressed colour; tab items and the Settings gear 97 %; suggestion chips 95 %; the round Send/Stop button 92 %; Back and Close show a pressed circle instead of scaling.",
                        reduceMotion: "No scale. The colour change uses `state` (400 ms).", inBuild3: true),
    "state": SpringInfo(usedFor: "Changes inside a screen.",
                        seen: "Set Up steps sliding; the chosen role card filling; the switch knob; icons swapping outline → filled; Send ↔ Stop; suggestions and the typing bubble appearing; the message field's focus outline; the tab bar stepping aside while you type; the chat scrolling to the newest message.",
                        reduceMotion: "`crossFade` (300 ms ease-in-out). The chat jumps instead of scrolling.", inBuild3: true),
    "settle": SpringInfo(usedFor: "Reserved for letting go of a drag that carries momentum. The only token with bounce.",
                         seen: "Not used in build 3 (nothing is draggable).",
                         reduceMotion: "Spring(0.40 s, bounce 0), the same as `state`.", inBuild3: false),
    "alertArrive": SpringInfo(usedFor: "Something new landing in a list.",
                              seen: "An alert card arriving on Home, and the cards below making room; a chat bubble arriving.",
                              reduceMotion: "`fadeIn` (250 ms ease-out) with no slide.", inBuild3: true),
    "present": SpringInfo(usedFor: "Large moves. In build 3, only the sync arrows' full turn.",
                          seen: "Sync Now's arrows (one full turn) when tapped, and again when the send succeeds (since D-034).",
                          reduceMotion: "No movement (icon effects are off).", inBuild3: true),
    "exit": SpringInfo(usedFor: "Custom elements leaving.",
                       seen: "Not used in build 3.",
                       reduceMotion: "`fadeOut`.", inBuild3: false),
    "tabSelect": SpringInfo(usedFor: "The tab bar's mint highlight sliding to the tapped tab, with the label colours. A tap mid-slide turns it toward the new tab from where it is.",
                            seen: "Caregiver tab bar; also the jump to Home when you tap Open on the chat's urgent row.",
                            reduceMotion: "`tabFade`: the highlight fades out at the old tab and in at the new one.", inBuild3: true),
    "iconQuick": SpringInfo(usedFor: "The first, quick step of an icon animation, like the touch that started it.",
                            seen: "Step 1 of every icon effect; all four steps of the heartbeat.",
                            reduceMotion: "Icon effects don't play.", inBuild3: true),
    "iconSettle": SpringInfo(usedFor: "An icon animation's return to rest.",
                             seen: "The last step of hop, lensPop, rewind, lidOpen and pop; the gear's one-tooth turn; each step of the typing dots.",
                             reduceMotion: "Icon effects don't play; the typing dots hold still.", inBuild3: true),
]
struct EasedInfo { let usedFor: String; let seen: String; let reduceMotion: String; let inBuild3: Bool }
let easedInfo: [String: EasedInfo] = [
    "tabFade": EasedInfo(usedFor: "Switching tabs: the old page fades out and the new one fades in, in place. No slide.",
                         seen: "Caregiver tabs. Under Reduce Motion, also the tab highlight.", reduceMotion: "Same.", inBuild3: true),
    "fadeIn": EasedInfo(usedFor: "Entrances when Reduce Motion is on.",
                        seen: "Alert cards and chat bubbles under Reduce Motion.", reduceMotion: "(It is the Reduce Motion version.)", inBuild3: true),
    "fadeOut": EasedInfo(usedFor: "Exits.", seen: "Not used in build 3.", reduceMotion: "Same.", inBuild3: false),
    "crossFade": EasedInfo(usedFor: "Swapping whole screens, and the Reduce Motion stand-in for `state`.",
                           seen: "Welcome ↔ Set Up ↔ Home or the resident screen; the live-view panels (Asking home… → Connecting… → video → ended).",
                           reduceMotion: "Same.", inBuild3: true),
    "spin": EasedInfo(usedFor: "Indeterminate loading only.",
                      seen: "The loading spinner: buttons while they work (Set Up's Continue, Approve), the pairing-code step, and live view while asking, connecting or stopping. Sync Now shows its turning arrows and \"Sending…\" instead.",
                      reduceMotion: "Keeps turning in build 3 (CRAFT M8 wants it still, with words).", inBuild3: true),
]
struct TransitionInfo { let does: String; let seen: String; let reduceMotion: String }
let transitionInfo: [String: TransitionInfo] = [
    "arrive": TransitionInfo(does: "Slides in from above (it starts one item-height higher, SwiftUI's `move(edge: .top)`) while fading in. Leaving is the reverse.",
                             seen: "Alert cards on Home; chat bubbles.", reduceMotion: "Fade only."),
    "leave": TransitionInfo(does: "Fade.", seen: "Not used in build 3.", reduceMotion: "Same."),
    "swap": TransitionInfo(does: "Fade; a cross-fade when one view replaces another.",
                           seen: "Tab pages; whole screens; the tab bar stepping aside; Send ↔ Stop; the typing bubble; suggestions; the live-view video, LIVE bar and Stop.", reduceMotion: "Same."),
    "numeric": TransitionInfo(does: "SwiftUI's rolling digits for a number that changes.",
                              seen: "The heart rate on Home's card and on the resident screen. It only rolls when the change is animated; in build 3 readings arrive without animation, so the digits change in place.",
                              reduceMotion: "Same."),
]
struct PolicyInfo { let body: String; let normal: String; let reduced: String; let usedBy: String }
let policyInfo: [(name: String, info: PolicyInfo)] = [
    ("state", PolicyInfo(body: "animation(Motion.state)", normal: "`state` spring", reduced: "`crossFade` (300 ms ease-in-out)", usedBy: "Every in-screen change listed under `state`.")),
    ("press", PolicyInfo(body: "reduce ? Motion.state : Motion.press", normal: "`press` spring, with the scale", reduced: "`state` spring, colour only (each control drops its scale)", usedBy: "Every button, chip, tab item and the gear.")),
    ("arriveAnimation", PolicyInfo(body: "reduce ? Motion.fadeIn : Motion.alertArrive", normal: "`alertArrive` spring", reduced: "`fadeIn` (250 ms ease-out)", usedBy: "Alert cards on Home; chat bubbles.")),
    ("arrive", PolicyInfo(body: "reduce ? .opacity : Motion.arrive", normal: "`Motion.arrive` (from above + fade)", reduced: "fade", usedBy: "The insertion half of `alertCard`; the chat makes the same switch itself.")),
    ("alertCard", PolicyInfo(body: "reduce ? .opacity : .asymmetric(insertion: Motion.arrive, removal: Motion.leave)", normal: "in from above with a fade (T7); out by fading (T8)", reduced: "fade both ways", usedBy: "Alert cards on Home, since D-034 (an answered card leaves with its fade).")),
    ("present", PolicyInfo(body: "animation(Motion.present)", normal: "`present` spring", reduced: "`crossFade` (300 ms ease-in-out)", usedBy: "The launch intro's lockup gliding into the welcome (T19), and the mark becoming Debbie.")),
    ("step", PolicyInfo(body: "reduce ? .opacity : .push(from: forward ? .trailing : .leading)", normal: "push from the right (forward) or the left (Back)", reduced: "fade", usedBy: "Set Up steps.")),
    ("tabSelect", PolicyInfo(body: "reduce ? Motion.tabFade : Motion.tabSelect", normal: "`tabSelect` spring (the highlight slides)", reduced: "`tabFade` (the highlight fades in place)", usedBy: "Tab bar; the chat's Open → Home.")),
    ("scroll", PolicyInfo(body: "reduce ? nil : Motion.state", normal: "`state` spring", reduced: "no animation (jumps)", usedBy: "The chat scrolling to the newest message.")),
    ("settle", PolicyInfo(body: "reduce ? Animation.spring(Spring(duration: 0.40, bounce: 0)) : Motion.settle", normal: "`settle` spring", reduced: "Spring(0.40 s, bounce 0)", usedBy: "Nothing in build 3.")),
    ("animation", PolicyInfo(body: "reduce ? fallback : a", normal: "the animation passed in", reduced: "the fallback, `crossFade` unless given", usedBy: "The helper behind `state`.")),
]
struct IconInfo { let usedOn: String; let shows: String }
let iconInfo: [String: IconInfo] = [
    "hop": IconInfo(usedOn: "Home tab (`home` → `home.fill`).", shows: "Yes."),
    "lensPop": IconInfo(usedOn: "Live tab (`camera` → `camera.fill`); the big camera on the Live tab's card and the camera in Start Live View (both play when you tap Start Live View).", shows: "Yes on the tab. On Start Live View it plays while the live view rises over it."),
    "rewind": IconInfo(usedOn: "History tab (`history` → `history.fill`).", shows: "Yes."),
    "lidOpen": IconInfo(usedOn: "Devices tab (`laptop` → `laptop.fill`).", shows: "Yes."),
    "turn": IconInfo(usedOn: "The Settings gear (`gear`), top right of every main screen and of the resident screen.", shows: "Yes, as the Settings sheet rises."),
    "beat": IconInfo(usedOn: "The heart (`heart` → `heart.fill`): on the resident screen when a new reading arrives (every Sync Now in the demo), and on Home's heart-rate card when the number changes.", shows: "Yes."),
    "spin": IconInfo(usedOn: "Sync Now's arrows (`sync`) on the resident screen, when tapped and again when the send succeeds.", shows: "Yes, since D-034: the arrows stay on the button while it sends (before, a spinner replaced them in the same update, so the turn was never seen)."),
    "pop": IconInfo(usedOn: "Add a Laptop (`add-laptop`); I'm On It (`ack`); Stop in live view (`stop`); Send in Debbie's chat (`send`). The Debbie tab is also set to `pop`, but it shows her face, not an icon, so it never plays.", shows: "Only on Add a Laptop, while the sheet rises. On I'm On It, Stop and Send the button disappears in the same update, so the pop never shows (measured)."),
]
struct HapticInfo { let firesWhen: String; let onScreen: String; let means: String; let cue: String }
let hapticInfo: [String: HapticInfo] = [
    "scanRecognized": HapticInfo(firesWhen: "The camera reads a valid Debbie code: the pairing code in Set Up, or a laptop code in Add a Laptop.",
                                 onScreen: "Set Up slides on to \"Name this iPhone\". Add a Laptop asks \"Add Kitchen laptop to your home?\"",
                                 means: "Got it: the code clicked into place.", cue: "Buzz ×1, mint. A soft click."),
    "scanInvalid": HapticInfo(firesWhen: "The code isn't Debbie's, has expired, or is the wrong kind (a laptop code during Set Up).",
                              onScreen: "A red message appears under the camera.",
                              means: "That code won't work.", cue: "Buzz ×3, error red. Three soft low taps."),
    "paired": HapticInfo(firesWhen: "The home laptop confirms the 4-digit code. The demo confirms 5 s after the code appears.",
                         onScreen: "\"Paired with Demo Home\" slides in, with Debbie and a check badge.",
                         means: "You're connected.", cue: "Buzz ×2 rising, mint. Two soft rising notes."),
    "pairingFailed": HapticInfo(firesWhen: "Pairing can't finish: the code was used or expired, the laptop still shows an older code, it was cancelled on the laptop, or the laptop can't be found.",
                                onScreen: "Set Up slides back to Scan the Code, with the reason in red.",
                                means: "Pairing didn't work.", cue: "Buzz ×3, error red."),
    "alertUrgentArrived": HapticInfo(firesWhen: "A refresh (every 10 s) brings a new urgent alert, such as a possible fall, that nobody has answered, while Debbie is open on any caregiver tab. Not on the first load after the app opens.",
                                     onScreen: "On Home, the red card slides in at the top. The Home tab gets a red count badge.",
                                     means: "Something needs you now.", cue: "Buzz ×2 falling, urgent red. The film's one distinct sound: a calm two-tone chime, never a siren."),
    "acknowledged": HapticInfo(firesWhen: "You tap I'm On It (on Home, on the alert's screen or in History), or confirm Mark as a False Alarm.",
                               onScreen: "Home: the card disappears and the badge count drops. Alert screen and History: the button becomes \"You said you're on it at 4:31 PM.\"",
                               means: "Done: the home knows you're on it.", cue: "Ripple ×2 rising from the button, mint. Two soft rising notes."),
    "liveViewStarted": HapticInfo(firesWhen: "The first video frame plays (about 2.9 s after the live view opens in the demo).",
                                  onScreen: "The video fades in; the blue LIVE bar with its countdown and the red Stop button appear.",
                                  means: "You're watching.", cue: "Buzz ×2 rising, mint."),
    "liveViewDenied": HapticInfo(firesWhen: "The home replies that live view is off there.",
                                 onScreen: "\"Live view is off at home\" with a Done button.",
                                 means: "Not allowed right now.", cue: "Buzz ×2 falling, amber."),
    "liveViewEndedByResident": HapticInfo(firesWhen: "The person at home turns live view off while you watch.",
                                          onScreen: "The video gives way to \"Live view ended. Live view was turned off at home.\"",
                                          means: "They turned it off.", cue: "Buzz ×2 falling, amber."),
    "liveViewLost": HapticInfo(firesWhen: "The connection fails or drops, or the camera doesn't answer. Not when you press Stop or the 5 minutes run out.",
                               onScreen: "\"Couldn't start live view\", or \"Live view ended. The connection to the home camera was lost.\"",
                               means: "Lost the camera.", cue: "Buzz ×3, error red."),
    "laptopApproved": HapticInfo(firesWhen: "The home confirms the new laptop after you tap Approve (about 1 s in the demo).",
                                 onScreen: "The Add a Laptop sheet closes.",
                                 means: "Laptop added.", cue: "Ripple ×2 rising from Approve, mint."),
    "laptopApprovalFailed": HapticInfo(firesWhen: "The approval can't be delivered or is refused.",
                                       onScreen: "A red message: \"Couldn't approve the laptop…\"",
                                       means: "Not added.", cue: "Ripple ×3 from Approve, error red."),
    "syncSucceeded": HapticInfo(firesWhen: "The resident's Sync Now is accepted by the home (about 0.6 s in the demo). Not on the demo's automatic first send.",
                                onScreen: "\"Sending…\" turns back into Sync Now, and \"Sent to home at 4:31 PM\" appears.",
                                means: "Sent.", cue: "Ripple ×2 rising from Sync Now, mint."),
    "syncFailed": HapticInfo(firesWhen: "Sync Now can't reach the home.",
                             onScreen: "\"Will send when you're home.\"",
                             means: "Not sent yet.", cue: "Ripple ×3 from Sync Now, error red."),
    "toggleChanged": HapticInfo(firesWhen: "Meant for flipping a Debbie switch. Not connected in build 3: the one switch (Settings → Resident mode) plays nothing.",
                                onScreen: "(Nothing in build 3.)",
                                means: "Switched.", cue: "Ripple ×1 small, mint, only if you show it."),
    "choiceChanged": HapticInfo(firesWhen: "You tap a role card in Set Up (\"A family member\" or \"The person at home\"). It plays on every tap, even on the card already chosen.",
                                onScreen: "The card fills with mint tint and gets a 2.5 pt green outline.",
                                means: "Picked.", cue: "Ripple ×1 small, mint. A faint tick."),
    "unpairIncomplete": HapticInfo(firesWhen: "Meant for: this iPhone forgot the home but couldn't tell the home. It can't happen in the demo (Leave Demo never unpairs), and in a real pairing it doesn't show in build 3 (see the notes for engineers).",
                                   onScreen: "(Nothing in build 3: the app is already back on Welcome.)",
                                   means: "Unpaired on this iPhone only.", cue: "Don't show."),
    "formInvalid": HapticInfo(firesWhen: "Defined but not connected in build 3. Only Demo Controls plays it.",
                              onScreen: "(Nothing in build 3.)",
                              means: "Check this field.", cue: "Ripple ×3, error red, only if you show it."),
]
var missing: [String] = []
missing += springOrder.filter { springInfo[$0] == nil }
missing += easedTokens.map(\.name).filter { easedInfo[$0] == nil }
missing += transitionTokens.map(\.name).filter { transitionInfo[$0] == nil }
missing += iconEffects.map(\.name).filter { iconInfo[$0] == nil }
missing += hapticNames.filter { hapticInfo[$0] == nil }
if !missing.isEmpty { fail("no description in motion.swift for: \(missing.joined(separator: ", "))") }
var extra: [String] = []
extra += springInfo.keys.filter { !springOrder.contains($0) }
extra += easedInfo.keys.filter { name in !easedTokens.contains { $0.name == name } }
extra += transitionInfo.keys.filter { name in !transitionTokens.contains { $0.name == name } }
extra += iconInfo.keys.filter { name in !iconEffects.contains { $0.name == name } }
extra += hapticInfo.keys.filter { !hapticNames.contains($0) }
if !extra.isEmpty { fail("motion.swift describes tokens that no longer exist: \(extra.sorted().joined(separator: ", "))") }
for (name, info) in policyInfo {
    guard let member = policyMembers.first(where: { $0.name == name }) else { fail("MotionPolicy.\(name) no longer exists") }
    if member.body != info.body { fail("MotionPolicy.\(name) is now `\(member.body)`; update its row in motion.swift") }
}
for member in policyMembers where !policyInfo.contains(where: { $0.name == member.name }) { fail("MotionPolicy.\(member.name) has no description") }

// MARK: - Curves

struct Bezier {
    var x1, y1, x2, y2: Double
    func bx(_ s: Double) -> Double { let u = 1 - s; return 3 * u * u * s * x1 + 3 * u * s * s * x2 + s * s * s }
    func by(_ s: Double) -> Double { let u = 1 - s; return 3 * u * u * s * y1 + 3 * u * s * s * y2 + s * s * s }
    func dbx(_ s: Double) -> Double { let u = 1 - s; return 3 * u * u * x1 + 6 * u * s * (x2 - x1) + 3 * s * s * (1 - x2) }
    /// Progress at time fraction `x` (Newton's method, kept inside a bracket).
    func value(at x: Double) -> Double {
        if x <= 0 { return 0 }
        if x >= 1 { return 1 }
        var lo = 0.0, hi = 1.0, s = x
        for _ in 0..<40 {
            let f = bx(s) - x
            if abs(f) < 1e-12 { break }
            if f > 0 { hi = s } else { lo = s }
            let d = dbx(s)
            var next = d > 1e-9 ? s - f / d : (lo + hi) / 2
            if next <= lo || next >= hi { next = (lo + hi) / 2 }
            s = next
        }
        return by(s)
    }
    func rounded(_ digits: Int) -> Bezier {
        let p = pow(10.0, Double(digits))
        return Bezier(x1: (x1 * p).rounded() / p, y1: (y1 * p).rounded() / p, x2: (x2 * p).rounded() / p, y2: (y2 * p).rounded() / p)
    }
    var css: String { "cubic-bezier(\(short(x1, 3)), \(short(y1, 3)), \(short(x2, 3)), \(short(y2, 3)))" }
    var list: [Double] { [x1, y1, x2, y2] }
}

let standardCurves: [(name: String, label: String, bezier: Bezier)] = [
    ("easeInOut", "ease-in-out", Bezier(x1: 0.42, y1: 0, x2: 0.58, y2: 1)),
    ("easeOut", "ease-out", Bezier(x1: 0, y1: 0, x2: 0.58, y2: 1)),
    ("easeIn", "ease-in", Bezier(x1: 0.42, y1: 0, x2: 1, y2: 1)),
    ("linear", "linear", Bezier(x1: 0, y1: 0, x2: 1, y2: 1)),
]
let aeEasyEase = Bezier(x1: 1.0 / 3.0, y1: 0, x2: 2.0 / 3.0, y2: 1)

func nelderMead(_ f: ([Double]) -> Double, start: [Double], scale: Double, iterations: Int) -> [Double] {
    let n = start.count
    var simplex = [start]
    for i in 0..<n { var p = start; p[i] += scale; simplex.append(p) }
    var values = simplex.map(f)
    for _ in 0..<iterations {
        let order = values.indices.sorted { values[$0] < values[$1] }
        simplex = order.map { simplex[$0] }
        values = order.map { values[$0] }
        if values[n] - values[0] < 1e-16 { break }
        var centroid = [Double](repeating: 0, count: n)
        for p in simplex.dropLast() { for j in 0..<n { centroid[j] += p[j] / Double(n) } }
        func along(_ t: Double) -> [Double] { (0..<n).map { centroid[$0] + t * (simplex[n][$0] - centroid[$0]) } }
        let r = along(-1), fr = f(r)
        if fr < values[0] {
            let e = along(-2), fe = f(e)
            if fe < fr { simplex[n] = e; values[n] = fe } else { simplex[n] = r; values[n] = fr }
        } else if fr < values[n - 1] {
            simplex[n] = r; values[n] = fr
        } else {
            let c = fr < values[n] ? along(-0.5) : along(0.5)
            let fc = f(c)
            if fc < min(fr, values[n]) {
                simplex[n] = c; values[n] = fc
            } else {
                for i in 1...n {
                    simplex[i] = (0..<n).map { simplex[0][$0] + 0.5 * (simplex[i][$0] - simplex[0][$0]) }
                    values[i] = f(simplex[i])
                }
            }
        }
    }
    return simplex[values.indices.min { values[$0] < values[$1] }!]
}

struct FitResult { let bezier: Bezier; let maxError: Double; let rms: Double }

func errors(of bezier: Bezier, against target: (Double) -> Double) -> (max: Double, rms: Double) {
    var worst = 0.0, sum = 0.0
    let n = 4000
    for i in 0...n {
        let u = Double(i) / Double(n)
        let d = abs(bezier.value(at: u) - target(u))
        worst = max(worst, d)
        sum += d * d
    }
    return (worst, (sum / Double(n + 1)).squareRoot())
}

/// Least-squares cubic-bezier through `target` (progress against time fraction, both 0…1).
/// `free`: all four numbers (CSS, Flow). Otherwise y1 = 0 and y2 = 1, which After Effects can enter as two influences.
func fitBezier(_ target: (Double) -> Double, free: Bool) -> FitResult {
    let us = (0...300).map { Double($0) / 300 }
    let ys = us.map(target)
    func make(_ p: [Double]) -> Bezier { free ? Bezier(x1: p[0], y1: p[1], x2: p[2], y2: p[3]) : Bezier(x1: p[0], y1: 0, x2: p[1], y2: 1) }
    func cost(_ p: [Double]) -> Double {
        for x in (free ? [p[0], p[2]] : [p[0], p[1]]) where x < 0 || x > 1 { return 10 + abs(x) }
        let b = make(p)
        var sum = 0.0
        for (u, y) in zip(us, ys) { let d = b.value(at: u) - y; sum += d * d }
        return sum / Double(us.count)
    }
    let starts: [[Double]] = free
        ? [[0.2, 0.0, 0.2, 1.0], [0.1, 0.4, 0.3, 1.0], [0.3, 0.1, 0.5, 1.0], [0.05, 0.6, 0.25, 1.0]]
        : [[0.2, 0.2], [0.1, 0.4], [0.3, 0.6], [0.05, 0.1]]
    var best = starts[0], bestCost = Double.infinity
    for start in starts {
        var p = nelderMead(cost, start: start, scale: 0.1, iterations: 2500)
        p = nelderMead(cost, start: p, scale: 0.01, iterations: 2500)
        let c = cost(p)
        if c < bestCost { bestCost = c; best = p }
    }
    let bezier = make(best).rounded(3)
    let e = errors(of: bezier, against: target)
    return FitResult(bezier: bezier, maxError: e.max, rms: e.rms)
}

// MARK: - Springs: simulate, cross-check with SwiftUI, fit

/// Fourth-order Runge–Kutta from rest at 0 toward 1 (mass 1), sampled every `dt`.
func simulate(_ s: SpringModel, dt: Double, until tMax: Double) -> [Double] {
    let k = s.stiffness, c = s.damping, m = s.mass
    func acc(_ x: Double, _ v: Double) -> Double { (-k * (x - 1) - c * v) / m }
    var x = 0.0, v = 0.0
    var out = [x]
    out.reserveCapacity(Int(tMax / dt) + 2)
    for _ in 0..<Int((tMax / dt).rounded()) {
        let k1x = v, k1v = acc(x, v)
        let k2x = v + 0.5 * dt * k1v, k2v = acc(x + 0.5 * dt * k1x, v + 0.5 * dt * k1v)
        let k3x = v + 0.5 * dt * k2v, k3v = acc(x + 0.5 * dt * k2x, v + 0.5 * dt * k2v)
        let k4x = v + dt * k3v, k4v = acc(x + dt * k3x, v + dt * k3v)
        x += dt / 6 * (k1x + 2 * k2x + 2 * k3x + k4x)
        v += dt / 6 * (k1v + 2 * k2v + 2 * k3v + k4v)
        out.append(x)
    }
    return out
}

struct SpringResult {
    let model: SpringModel
    let settle1: Double          // s: stays within 1 % of the target after this
    let t95: Double              // s: first reaches 95 %
    let overshoot: Double        // fraction of the move
    let atDuration: Double       // progress at t = duration
    let appleSettling: Double    // SwiftUI's Spring.settlingDuration
    let swiftUIParameterDiff: Double
    let swiftUICurveDiff: Double // largest |SwiftUI value − simulation|
    let analyticDiff: Double     // largest |closed form − simulation|
    let fit: FitResult           // free bezier over the 1 % settle time
    let ae: FitResult            // y1 = 0, y2 = 1 over the 1 % settle time
    let standard: [(label: String, maxError: Double)]
    let stepFit: FitResult       // free bezier over [0, duration] (one icon step)
    let stepAE: FitResult
    let css: String
    let cssMaxError: Double
}

var fitCache: [String: (FitResult, FitResult)] = [:]
func cachedFits(_ s: SpringModel, window: Double) -> (FitResult, FitResult) {
    // Springs with the same bounce have the same shape, so the fit depends only on bounce and window ÷ duration.
    let key = "\(s.bounce)/\(fixed(window / s.duration, 4))"
    if let hit = fitCache[key] { return hit }
    let target = { (u: Double) in s.value(u * window) }
    let result = (fitBezier(target, free: true), fitBezier(target, free: false))
    fitCache[key] = result
    return result
}

let dt = 1e-5
let springResults: [SpringResult] = springModels.map { s in
    let xs = simulate(s, dt: dt, until: 2.0)
    var i = xs.count - 1
    while i > 0 && abs(xs[i] - 1) <= 0.01 { i -= 1 }
    guard i < xs.count - 1, i > 0 else { fail("\(s.name) didn't settle within 2 s") }
    let a = abs(xs[i] - 1) - 0.01, b = abs(xs[i + 1] - 1) - 0.01
    let settle1 = (Double(i) + a / (a - b)) * dt
    let i95 = xs.firstIndex { $0 >= 0.95 }!
    let t95 = (Double(i95 - 1) + (0.95 - xs[i95 - 1]) / (xs[i95] - xs[i95 - 1])) * dt
    let overshoot = max(0, (xs.max() ?? 1) - 1)

    let apple = Spring(duration: s.duration, bounce: s.bounce)
    let parameterDiff = max(abs(apple.stiffness - s.stiffness) / s.stiffness, abs(apple.damping - s.damping) / s.damping, abs(apple.mass - s.mass))
    var curveDiff = 0.0, analyticDiff = 0.0
    for j in stride(from: 0, to: xs.count, by: 100) {
        let t = Double(j) * dt
        curveDiff = max(curveDiff, abs(apple.value(target: 1.0, initialVelocity: 0.0, time: t) - xs[j]))
        analyticDiff = max(analyticDiff, abs(s.value(t) - xs[j]))
    }
    if parameterDiff > 1e-9 { fail("\(s.name): the stiffness/damping formula disagrees with SwiftUI's Spring") }
    if curveDiff > 1e-4 { fail("\(s.name): the simulation disagrees with SwiftUI's Spring by \(curveDiff)") }

    let (fit, ae) = cachedFits(s, window: settle1)
    let (stepFit, stepAE) = cachedFits(s, window: s.duration)
    let target = { (u: Double) in s.value(u * settle1) }
    let standard = (standardCurves.map { ($0.label, $0.bezier) } + [("AE Easy Ease", aeEasyEase)]).map { (label: $0.0, maxError: errors(of: $0.1, against: target).max) }

    var samples = (0...20).map { s.value(Double($0) / 20 * settle1) }
    samples[0] = 0
    samples[20] = 1
    let rounded = samples.map { (($0 * 1000).rounded()) / 1000 }
    var cssError = 0.0
    for j in 0...2000 {
        let u = Double(j) / 2000
        let seg = min(19, Int(u * 20))
        let f = u * 20 - Double(seg)
        cssError = max(cssError, abs(rounded[seg] + (rounded[seg + 1] - rounded[seg]) * f - target(u)))
    }
    let css = "linear(" + rounded.map { short($0, 3) }.joined(separator: ", ") + ")"

    return SpringResult(model: s, settle1: settle1, t95: t95, overshoot: overshoot, atDuration: s.value(s.duration),
                        appleSettling: apple.settlingDuration, swiftUIParameterDiff: parameterDiff, swiftUICurveDiff: curveDiff,
                        analyticDiff: analyticDiff, fit: fit, ae: ae, standard: standard, stepFit: stepFit, stepAE: stepAE,
                        css: css, cssMaxError: cssError)
}
func S(_ name: String) -> SpringResult {
    guard let r = springResults.first(where: { $0.model.name == name }) else { fail("no spring named \(name)") }
    return r
}
func settleMs(_ name: String) -> String { ms(S(name).settle1) }
/// The standard ease (and length, as a share of the settle time) that tracks a spring best: for Keynote's presets.
struct PresetFit { let label: String; let scale: Double; let maxError: Double }
var presetCache: [String: PresetFit] = [:]
func bestPreset(_ r: SpringResult, among curves: [(label: String, bezier: Bezier)]) -> PresetFit {
    let key = "\(r.model.bounce)/" + curves.map(\.label).joined(separator: ",")
    if let hit = presetCache[key] { return PresetFit(label: hit.label, scale: hit.scale, maxError: hit.maxError) }
    let s = r.model, settle = r.settle1
    var best = PresetFit(label: "", scale: 1, maxError: .infinity)
    for c in curves {
        for i in 0...120 {
            let m = 0.40 + Double(i) * 0.01
            var worst = 0.0
            for j in 0...600 {
                let u = Double(j) / 600
                worst = max(worst, abs(c.bezier.value(at: min(1, u / m)) - s.value(u * settle)))
            }
            if worst < best.maxError { best = PresetFit(label: c.label, scale: m, maxError: worst) }
        }
    }
    presetCache[key] = best
    return best
}
func keynote(_ r: SpringResult) -> PresetFit { bestPreset(r, among: standardCurves.map { ($0.label, $0.bezier) }) }
func easyEase(_ r: SpringResult) -> PresetFit { bestPreset(r, among: [("AE Easy Ease", aeEasyEase)]) }
func presetName(_ label: String) -> String {
    ["ease-in-out": "Ease In and Out", "ease-out": "Ease Out", "ease-in": "Ease In", "linear": "None (linear)"][label] ?? label
}

// The eased curves are the standard ones: check against SwiftUI's own UnitCurve.
let unitCurves: [String: UnitCurve] = ["easeInOut": .easeInOut, "easeOut": .easeOut, "easeIn": .easeIn, "linear": .linear]
var unitCurveDiff = 0.0
for c in standardCurves {
    for j in 0...1000 {
        let x = Double(j) / 1000
        unitCurveDiff = max(unitCurveDiff, abs(unitCurves[c.name]!.value(at: x) - c.bezier.value(at: x)))
    }
}
if unitCurveDiff > 1e-3 { fail("SwiftUI's UnitCurve disagrees with the standard control points by \(unitCurveDiff)") }
func standardBezier(_ kind: String) -> Bezier { standardCurves.first { $0.name == kind }!.bezier }

let maxCurveDiff = springResults.map(\.swiftUICurveDiff).max()!
let maxParameterDiff = springResults.map(\.swiftUIParameterDiff).max()!
let maxAnalyticDiff = springResults.map(\.analyticDiff).max()!
let bounceZero = springResults.filter { $0.model.bounce == 0 }
func closestSameLength(_ r: SpringResult) -> (label: String, maxError: Double) {
    r.standard.filter { $0.label != "AE Easy Ease" }.min { $0.maxError < $1.maxError }!
}
let zeroFit = bounceZero[0].fit, zeroAE = bounceZero[0].ae
let settleRatio = bounceZero[0].settle1 / bounceZero[0].model.duration

// MARK: - Icon timelines

struct Keyframe { let time: Double; let pose: Pose; let spring: String? }
func keyframes(_ effect: IconEffect) -> [Keyframe] {
    var t = 0.0
    var out = [Keyframe(time: 0, pose: effect.poses[0], spring: nil)]
    for pose in effect.poses.dropFirst() {
        let token = paceTokens[pose.pace]!
        t += S(token).model.duration
        out.append(Keyframe(time: t, pose: pose, spring: token))
    }
    return out
}
func paceName(_ token: String) -> String { paceTokens.first { $0.value == token }?.key ?? token }

/// SwiftUI timing measured by motion-probe.swift (macOS 26 SwiftUI, 60 Hz display): each step starts when the previous
/// step's spring reaches its duration, plus at most a frame.
let measuredSteps = "hop 0 → 158–162 → 408–417 ms; beat 0 → 154 → 304 → 454–462 → 612–621 ms; spin 0 → 504–517 ms; typing dots one step every 258–275 ms (three runs, 60 Hz display)"

// MARK: - Shared wording

let generatedNote = "> Generated by `tools/design/kit/motion.sh` from the app's Swift sources. Don't edit by hand: change the code (or the prose in `tools/design/kit/motion.swift`) and re-run the script."
let ptNote = "Sizes are in points (pt). In a 3× iPhone mockup, 1 pt = 3 px."

// MARK: - motion.md

var md: [String] = []
func add(_ s: String = "") { md.append(s) }

add("# Motion")
add()
add("How things move in Debbie (build 3, iOS 26), with the exact values to rebuild them in Figma, After Effects, Keynote, ProtoPie or CSS. Every animation in the app comes from a named token in `Motion.swift`; screens never invent their own curves.")
add()
add(generatedNote)
add()
add("Also in this folder: `curves.png` (every curve, plotted), `motion-tokens.json` (the same numbers for tools and scripts) and `icon-animations.md` (the icons' own animations). Haptics are in `../10-haptics/haptics.md`. \(ptNote)")
add()
add("## The feel in one minute")
add()
add("- **Calm and quick.** Springs with no bounce move things; short eases fade things. The only bouncy token (`settle`) isn't used anywhere in build 3.")
add("- **Short.** Every spring and fade lasts 150–500 ms, and everything is at rest within 0.6 s. Only the loading spinner (one turn a second), the typing dots and Debbie's idle face repeat.")
add("- **One kind of motion per job.** A press gives a little (97 %). New things arrive from above. Tab pages cross-fade in place. Set Up steps slide sideways. Whole screens cross-fade.")
add("- **Never the only signal.** Every animated change also changes words, an icon or a colour.")
add("- **Reduce Motion** (or Prefer Cross-Fade Transitions) turns every slide, scale and turn into a fade (section 5).")
add()
add("## 1. Reading a spring")
add()
add("SwiftUI describes a spring by a `duration` and a `bounce`: `Spring(duration:bounce:)`. With bounce 0, which every token but one uses, the value is \(pct(bounceZero[0].atDuration)) of the way there at `duration`, within 1 % at \(fixed(settleRatio, 3)) × `duration`, and it never overshoots.")
add()
add("For tools that take mass, stiffness and damping, the physical equivalent is (mass 1):")
add()
add("- **stiffness** = (2π ÷ duration)²")
add("- **damping** = (1 − bounce) × 4π ÷ duration, for bounce ≥ 0")
add("- **damping ratio** = 1 − bounce (1 means critically damped: the fastest move with no overshoot)")
add()
add("These are Apple's own numbers: the script reads SwiftUI's `Spring` back and the largest difference is \(String(format: "%.0e", max(maxParameterDiff, 1e-16))) (relative). Its step-by-step simulation (Runge–Kutta, 0.01 ms steps) matches SwiftUI's curve to within \(String(format: "%.0e", maxCurveDiff)) of the move.")
add()
add("**Every bounce-0 spring has the same shape, only stretched in time.** So one curve fits them all: `\(zeroFit.bezier.css)` over the \"settles (1 %)\" length, for every token except `settle`.")
add()
add("How to use the numbers:")
add()
add(table(["Tool", "What to enter"], [
    ["Figma (prototype → Custom spring)", "Mass 1, and Stiffness and Damping from table 2b."],
    ["ProtoPie, Principle", "Their spring fields are called Tension and Friction, and their units aren't documented. Tension = stiffness and Friction = damping (mass 1) is the usual mapping; check it against `curves.png`. Safer: Cubic Bezier with the bezier and length from table 2c."],
    ["After Effects", "Keyframe length = \"settles (1 %)\". Easing = the cubic-bezier, with a bezier plugin such as Flow. Without a plugin: Keyframe Velocity, speed 0 on both keyframes, and the two influences from table 2c."],
    ["Keynote", "Acceleration = \(presetName(keynote(bounceZero[0]).label)), with the shorter duration from the Keynote column of table 2c. That's the closest a preset gets (about \(fixed(keynote(bounceZero[0]).maxError * 100, 0)) % off); use it for fades and small moves."],
    ["CSS, web, Lottie", "The `linear()` easing in section 2d, with its duration. Or the cubic-bezier."],
]))
add()
add("## 2. Springs")
add()
add("### 2a. What each spring is for")
add()
add(table(["Token", "SwiftUI", "Used for", "Where you see it", "Reduce Motion"], springResults.map { r in
    let info = springInfo[r.model.name]!
    let code = animTokens.first { $0.name == r.model.name }!
    return ["`Motion.\(r.model.name)`", "`Spring(duration: \(fixed(r.model.duration, 2)), bounce: \(short(r.model.bounce, 2)))`, as `\(code.code)`",
            info.usedFor, info.seen, info.reduceMotion]
}))
add()
add("### 2b. Numbers")
add()
add(table(["Token", "Duration", "Bounce", "Mass", "Stiffness", "Damping", "Damping ratio", "95 % at", "Settles (1 %)", "Overshoot", "Apple's `settlingDuration`"], springResults.map { r in
    ["`\(r.model.name)`", ms(r.model.duration), short(r.model.bounce, 2), "1", fixed(r.model.stiffness, 2), fixed(r.model.damping, 3),
     short(r.model.zeta, 2), ms(r.t95), fixed(r.settle1 * 1000, 1) + " ms", r.overshoot > 1e-6 ? pct(r.overshoot, 2) : "none", ms(r.appleSettling)]
}))
add()
add("- \"Settles (1 %)\" is simulated: after it, the value stays within 1 % of the target. Use it as the animation length in timeline tools.")
add("- Apple's `settlingDuration` uses a much tighter threshold and rounds up to 0.1 s. CRAFT.md's \"Settled\" column quotes it. Past the 1 % point nothing visible happens.")
add()
add("### 2c. Curves for design tools")
add()
add("Max error is the largest gap between the curve and the real spring, as a share of the move: 1 % of a 200 pt move is 2 pt.")
add()
add(table(["Token", "Length (settles 1 %)", "Cubic-bezier", "Max error", "AE influence (out → in, speed 0)", "Max error", "Keynote preset", "Max error"], springResults.map { r in
    let k = keynote(r)
    return ["`\(r.model.name)`", fixed(r.settle1 * 1000, 0) + " ms", "`\(r.fit.bezier.css)`", pct(r.fit.maxError),
            "\(fixed(r.ae.bezier.x1 * 100, 1)) % → \(fixed((1 - r.ae.bezier.x2) * 100, 1)) %", pct(r.ae.maxError),
            "\(presetName(k.label)) over \(msInt(k.scale * r.settle1)) ms", pct(k.maxError)]
}))
add()
add("- The bezier and the influences are least-squares fits over the settle time (the script also reports each fit's RMS error in `motion-tokens.json`).")
add("- In After Effects' Keyframe Velocity dialog the first number is the first keyframe's **Outgoing** influence and the second is the next keyframe's **Incoming** influence. Leave both speeds at 0.")
add("- The Keynote column is the standard curve, and the length, that stays closest to the spring: a spring starts faster and lands more gently than any preset, so a preset needs a shorter length. Same-length \(presetName(closestSameLength(bounceZero[0]).label)) is off by \(pct(closestSameLength(bounceZero[0]).maxError, 0)).")
add("- Don't use After Effects' Easy Ease (33.3 % both sides): it is too slow to start, off by \(pct(bounceZero[0].standard.first { $0.label == "AE Easy Ease" }!.maxError, 0)) at the same length and \(pct(easyEase(bounceZero[0]).maxError, 0)) even at its best length.")
add()
add("### 2d. CSS `linear()`")
add()
add("21 evenly spaced samples over the settle time (the last one rounded up to 1). Use with the duration shown.")
add()
add("```")
for r in springResults {
    add("\(r.model.name.padding(toLength: 12, withPad: " ", startingAt: 0)) \(String(format: "%4d", Int((r.settle1 * 1000).rounded()))) ms  \(r.css)")
}
add("```")
add()
add("Largest error of these against the real spring: \(pct(springResults.map(\.cssMaxError).max()!)), at the very end, where the spring is still 1 % short.")
add()
add("## 3. Eased animations (fades and the spinner)")
add()
add(table(["Token", "SwiftUI", "Length", "Cubic-bezier", "Used for", "Where you see it", "Reduce Motion"], easedTokens.map { a in
    let info = easedInfo[a.name]!
    let length = a.repeats ? "\(ms(a.duration)) per turn, repeats\(a.autoreverses ? " back and forth" : " forever, never reverses")" : ms(a.duration)
    return ["`Motion.\(a.name)`", "`\(a.code)`", length, "`\(standardBezier(a.kind).css)`", info.usedFor, info.seen, info.reduceMotion]
}))
add()
add("SwiftUI's ease curves use the standard control points (the same as CSS and Core Animation): the script checks them against SwiftUI's `UnitCurve` (largest difference \(String(format: "%.0e", max(unitCurveDiff, 1e-16)))). Opacity-only changes use these timing curves; anything that moves uses a spring.")
add()
add("## 4. Named transitions")
add()
add(table(["Token", "SwiftUI", "What it does", "Where you see it", "Reduce Motion"], transitionTokens.map { t in
    let info = transitionInfo[t.name]!
    return ["`Motion.\(t.name)`", "`\(t.code)`", info.does, info.seen, info.reduceMotion]
} + [["`motion.step(forward:)`", "`.push(from: .trailing)` forward, `.push(from: .leading)` back", "The new step slides in from one side while fading in; the old one slides out the other side while fading out, each by its own width (the full screen).", "Set Up steps.", "Fade."]]))
add()
add("## 5. Reduce Motion")
add()
add("Debbie switches to its Reduce Motion versions when either iOS setting is on: Settings → Accessibility → Motion → **Reduce Motion**, or **Prefer Cross-Fade Transitions**. `MotionPolicy` swaps:")
add()
add(table(["In code", "Normally", "With Reduce Motion", "Used by"], policyInfo.map { p in
    ["`motion.\(p.name)`", p.info.normal, p.info.reduced, p.info.usedBy]
}))
add()
add("Inside the components:")
add()
add("- Presses don't scale; only the colour changes.")
add("- Icon effects don't play. The outline-to-filled swap stays, as a cross-fade.")
add("- The tab highlight fades in place instead of sliding.")
add("- Chat bubbles and alert cards fade in instead of sliding from above.")
add("- The typing dots hold still, with the words \"Debbie is writing…\".")
add("- Debbie's face holds still, eyes open.")
add("- The chat jumps to the newest message instead of scrolling.")
add("- The loading spinner still turns in build 3 (a difference from CRAFT; section 8).")
add()
add("## 6. Each transition, step by step")
add()
add("### Tab switch (caregiver)")
add()
add("- The tapped item gives under the finger: 97 % on `press`.")
add("- The highlight capsule (\(swatch("mint.tint"))) slides from the old tab to the new one on `tabSelect` (within 1 % by \(settleMs("tabSelect"))). Tap another tab mid-slide and it turns toward that tab from where it is, keeping its speed.")
add("- The new tab's label and icon turn \(swatch("accent.text")); the old tab's turn \(swatch("text.secondary")). Labels change on `tabSelect`, icons on `state`.")
add("- The new tab's icon cross-fades from outline to filled on `state` (\(settleMs("state"))) and plays its own effect: Home hops, Live's lens pops, History rewinds, Devices' lid dips (`icon-animations.md`).")
add("- The centre Debbie tab shows her 30 pt face instead of an icon. When selected, its ring changes from a faint 1 pt grey to a 2 pt \(swatch("accent.text")) outline, on `tabSelect`. It plays no effect.")
add("- The page doesn't slide: the old page fades out and the new one fades in, in place, on `tabFade` (150 ms ease-in-out).")
add("- No haptic. Apple's tab bars play none.")
add("- Tapping Home again while on Home pops back to its top (the system's navigation animation) and replays the hop.")
add("- Reduce Motion: the highlight fades out at the old tab and in at the new one (`tabFade`). Icons don't move; the outline-to-filled swap is a 300 ms cross-fade.")
add()
add("### Set Up steps (onboarding)")
add()
add("- Continue: the current step slides out to the left while fading out, and the next slides in from the right while fading in, each by the full width of the screen, on `state` (\(settleMs("state"))).")
add("- Back: the mirror image. The current step leaves to the right and the previous one comes in from the left. When you change direction, the outgoing step leaves the new way, so the two never cross.")
add("- The \"Set Up\" bar at the top stays put; its Back arrow appears or disappears instantly.")
add("- Debbie's guide face keeps breathing and blinking on each step.")
add("- Reduce Motion: a 300 ms cross-fade (`crossFade`), no slide.")
add()
add("### Urgent alert arrives (Home)")
add()
add("- Debbie checks for news every 10 s. A new alert's card enters the list (urgent first, then newest): it starts one card-height higher and transparent, then slides down into place while fading in (`Motion.arrive`) on `alertArrive` (\(settleMs("alertArrive"))). The cards below, and the heart-rate card, move down to make room on the same spring.")
add("- The leading urgent card (for example \"Possible fall\") is \(swatch("urgent.fill")) with white text; the others are grey cards.")
add("- Alerts that arrive together slide in together; there's no stagger.")
add("- At the same moment the Home tab gets a red count badge (instantly) and the phone plays the `warning` haptic.")
add("- Reduce Motion: the card fades in (`fadeIn`, 250 ms ease-out). The cards below still move down, on the same 250 ms ease-out.")
add()
add("### Acknowledged card leaves (I'm On It)")
add()
add("- The button gives under the finger (97 %, `press`) and the phone plays `success`.")
add("- **Build 3:** on Home the card disappears at once and the cards below jump up. The badge count drops, and when it was the last alert, \"No alerts\" appears. The list only animates when an alert is added or removed, and an answered alert is neither.")
add("- **In the app since D-034** (CRAFT T8): the answered card fades out while the cards below close the gap, both on the `alertArrive` spring (\(settleMs("alertArrive"))). Under Reduce Motion it fades with no reflow animation.")
add("- On the alert's own screen and in History the card stays; its button is replaced by \"You said you're on it at 4:31 PM.\" instantly.")
add("- The button's `ack` icon pop doesn't show: the button is gone in the same frame.")
add()
add("### Button press")
add()
add(table(["Control", "Pressed size", "Pressed colour", "Token"], [
    ["Text buttons", "97 %", "Mint \(hex("mint.fill")) → \(swatch("mint.fill.pressed")); red \(hex("urgent.fill")) → \(swatch("urgent.fill.pressed")); grey and quiet → \(swatch("surface.pressed"))", "`press`"],
    ["Tab bar items", "97 %", "none", "`press`"],
    ["Settings gear (glass circle)", "97 %", "none (glass)", "`press`"],
    ["Suggestion chips", "95 %", "none", "`press`"],
    ["Send / Stop (round, mint)", "92 %", "\(swatch("mint.fill.pressed"))", "`press`"],
    ["Back, Close (icon buttons)", "no scale", "a \(swatch("surface.pressed")) circle appears behind the icon", "`press`"],
    ["Role cards, switches", "no scale (the system's plain button style dims them slightly while pressed)", "They change when selected (`state`)", "`state`"],
]))
add()
add("- Pressing and releasing both use `press` (within 1 % by \(settleMs("press"))). Letting go early, or sliding off, reverses smoothly from wherever it is.")
add("- Reduce Motion: no scale. The colour change uses `state` (\(settleMs("state"))).")
add()
add("### Sheets and the live view (system presentations)")
add()
add("- Settings, Add a Laptop, Demo Controls and the confirm sheets (Unpair, Mark as a False Alarm) are iOS sheets. They rise from the bottom with the system's own animation, not a Debbie token. The confirm sheets stop at half height and show a grab handle.")
add("- Live view is an iOS full-screen cover. It rises from the bottom over everything.")
add("- Close, Done or a swipe down dismisses with the system animation.")
add("- When the gear opens Settings, the gear turns one tooth (250 ms) as the sheet rises.")
add("- For a mockup, trace a screen recording. If you need a stand-in, `present` (500 ms, no bounce) is the closest Debbie token, but compare it with a recording before relying on it.")
add()
add("### Debbie's chat")
add()
add("- **Bubbles.** Yours sit on the right on \(swatch("mint.tint")); Debbie's sit on the left on \(swatch("bg.surface")). Corners 20 pt; padding 16 pt × 12 pt.")
add("- **A new bubble** arrives like an alert card: from one bubble-height above, sliding down while fading in (`Motion.arrive` on `alertArrive`, \(settleMs("alertArrive"))). The conversation scrolls to the newest message on `state` (\(settleMs("state"))).")
add("- **Typing dots.** Three 8 pt dots, 4 pt apart, in \(swatch("text.secondary")), inside a surface bubble. The lit dot is fully opaque and grows to 125 %; the others stay at 100 % and 35 % opacity. The lit dot moves one place to the right every 250 ms (`iconSettle`) and wraps back to the first, so one sweep takes 750 ms. It loops while Debbie writes. Measured: one step every 258–275 ms (250 ms plus up to a frame).")
add("- **Slow answers.** After 3 s with no words, \"Summarizing the latest from home…\" appears beside the dots.")
add("- **Streaming** (only in builds with the Gemini AI key): the text grows at most once every 80 ms, with no animation, so it reads as chunks rather than flicker.")
add("- **Build 3 has no AI key.** Debbie's answer is written on the phone and arrives at once, together with your question, so the typing dots barely show, if at all. In the film you can hold the dots for a pause of your choice before her bubble arrives.")
add("- **Typing.** Tapping the field fades out the tab bar and the suggestions on `state`, and the field's outline becomes a 2 pt \(swatch("focus.ring")). Send (a round mint button) appears when there's text. While Debbie writes it becomes Stop, in the same place, cross-fading on `state`.")
add("- **Reduce Motion:** bubbles fade in (`fadeIn`, 250 ms), scrolling jumps, and the dots hold still beside the words \"Debbie is writing…\".")
add()
add("### Heart beat on a new reading")
add()
let beat = keyframes(iconEffects.first { $0.name == "beat" }!)
add("- The heart beats once, lub-dub: " + beat.dropFirst().map { "\(fixed($0.pose.scaleX * 100, 0)) % at \(msInt($0.time)) ms" }.joined(separator: ", ") + ". Each step uses `iconQuick`.")
add("- Resident screen: on every new reading. In the demo that's every Sync Now, because each send stamps a fresh reading. The heart turns filled once there is a reading.")
add("- Home's heart-rate card: when the number changes. In the demo that's once, when the first reading loads.")
add("- The number itself changes in place (see `Motion.numeric`).")
add("- Reduce Motion: no beat; the outline-to-filled swap is a cross-fade.")
add()
add("### Sync spin (the resident's Sync Now)")
add()
add("- **Intent** (code and CRAFT): the sync arrows make one full clockwise turn on `present` (500 ms; within 1 % by \(settleMs("present"))) when you tap, and again when the send succeeds.")
add("- **Build 3: neither turn shows.** Tapping swaps the arrows for the loading spinner, and \"Sync Now\" for \"Sending…\", in the same update. When the send finishes, the arrows come back already at rest. An animation triggered in the same update that removes its view never plays (measured with `tools/design/kit/motion-probe.swift`).")
add("- **What you do see:** the spinner (18 pt ring, 70 % arc, 2.5 pt round-capped stroke, one turn per second, linear) for about 0.6 s in the demo. The heart beats as the new reading appears. Then \"Sent to home at …\" and the `success` haptic.")
add("- For the film: match the app if you cut against real screen recordings. If you want the intended turn, rotate the arrows 360° clockwise over 500 ms with `\(S("present").stepFit.bezier.css)`.")
add()
add("### Whole-screen changes")
add()
add("- Welcome → Set Up → Home (or the resident screen), Try the Demo, Leave Demo and Unpair: the old screen fades out while the new one fades in, on `crossFade` (300 ms, `\(standardBezier("easeInOut").css)`). Reduce Motion: the same.")
add()
add("### Live view states")
add()
add("- The panels (Asking home… → Connecting to the camera… → the video → Stopping… → Live view ended) cross-fade on `crossFade` (300 ms). A spinner turns while asking, connecting and stopping.")
add("- The LIVE bar (\(swatch("live.fill")) with a white outline, the place and a countdown) and the red Stop button appear at once with the first video frame and disappear at once when it ends. The countdown ticks every second with no animation (fixed-width digits).")
add("- Demo timing: about 2 s on \"Asking home…\", 0.9 s on \"Connecting to the camera…\", then the demo camera (a calm, animated drawing of a room).")
add("- Live view always uses its dark look (white text on the near-black \(swatch("live.scrim"))), although the rest of the app is light only.")
add()
add("### Role cards and the switch")
add()
add("- Role card (Set Up's \"Who uses this iPhone?\"): the tapped card fills with \(swatch("mint.tint")) and gets a 2.5 pt \(swatch("accent.text")) outline. The other returns to \(swatch("bg.surface")) with a 1 pt \(swatch("border.control")) outline. Both change on `state` (\(settleMs("state"))); there's no moving highlight. The `selection` haptic plays.")
add("- Switch (Settings → Resident mode on this iPhone): a 52 × 32 pt track and a 24 pt knob. The knob slides and the track turns \(swatch("mint.fill")) on `state`. No haptic in build 3.")
add("- Reduce Motion: the same changes, as a 300 ms cross-fade.")
add()
add("### Debbie's idle face")
add()
add(table(["Part", "Motion", "Amount", "Timing"], [
    ["Body", "Breathes: scales from its bottom edge", "±0.8 %", "Sine, 4.8 s per breath"],
    ["Head (hair, face, eyes, brows, mouth)", "Rises with each breath", "0.2 % of the avatar's size (0.3 pt at 148 pt)", "Same 4.8 s sine, in step with the body"],
    ["Head", "Tilts around the neck, at (100, 150) on the 200 × 200 artboard", "±2°", "Sine, 7.3 s"],
    ["Eyes", "Blink: squash to 40 % height (around y = 94.2 of 200) → closed lids → squash → open", "40 ms + 133 ms + 67 ms = 240 ms", "One blink, starting within the first 2 s of every 4.4 s window, so blinks are at least 2.4 s apart. Never a double blink."],
]))
add()
add("- It runs only at 64 pt and up (the Set Up guide and the resident greeting at 64 pt, Welcome at 148 pt), redrawn 30 times a second. The smaller faces (the chat header at 44 pt, the tab at 30 pt) hold still.")
add("- Reduce Motion: still, with eyes open. Debbie's face never appears on urgent surfaces (alerts, live view, the status card).")
add("- For a seamless loop in After Effects: 4.8 s and 7.3 s share no short loop. A 14.4 s loop with a 7.2 s tilt (three breaths, two tilts) looks the same. (A suggestion; the app uses 7.3 s.)")
add("- The layered art is in `../07-debbie`.")
add()
add("## 7. What moves when")
add()
add("Time 0 is the moment the finger lifts (a tap) or the event happens. \"Ends\" is when the motion is within 1 % of rest. Spring steps inside an icon effect end when the next step starts.")
add()
func timeline(_ title: String, _ rows: [[String]], note: String? = nil) {
    add("### \(title)")
    add()
    add(table(["Starts", "Ends", "What moves", "How"], rows.map { $0.map { $0.isEmpty ? "—" : $0 } }))
    if let note { add(); add(note) }
    add()
}
let pressEnd = settleMs("press")
func iconRows(_ name: String, _ what: String) -> [[String]] {
    let k = keyframes(iconEffects.first { $0.name == name }!)
    return zip(k, k.dropFirst()).map { a, b in
        let p = b.pose
        var parts: [String] = []
        if abs(p.scaleX - 1) > 1e-9 || abs(p.scaleY - 1) > 1e-9 {
            parts.append(abs(p.scaleX - p.scaleY) < 1e-9 ? "\(fixed(p.scaleX * 100, 0)) %" : "\(fixed(p.scaleX * 100, 0)) % wide × \(fixed(p.scaleY * 100, 0)) % tall")
        }
        if p.dy != 0 { parts.append("\(short(p.dy, 1)) pt down") }
        if p.angle != 0 { parts.append("\(short(p.angle, 0))°") }
        let pose = parts.isEmpty ? "back to rest" : parts.joined(separator: ", ")
        return [a.time == 0 ? "0" : "\(msInt(a.time)) ms", "\(msInt(b.time)) ms", "\(what): \(pose)", "`\(b.spring!)`"]
    }
}
timeline("Switch tabs (Home → Devices)", [
    ["finger down", "+\(pressEnd)", "The Devices item shrinks to 97 %", "`press`"],
    ["0", pressEnd, "The item grows back to 100 %", "`press`"],
    ["0", "150 ms", "Home's page fades out and Devices' fades in, in place", "`tabFade`"],
    ["0", settleMs("tabSelect"), "The mint-tint highlight slides from Home to Devices; Home's label turns grey, Devices' turns green", "`tabSelect`"],
    ["0", settleMs("state"), "Laptop outline → filled; home filled → outline (cross-fades)", "`state`"],
] + iconRows("lidOpen", "Laptop icon, pivoting on its bottom edge"), note: "No haptic.")
timeline("Set Up: Continue", [
    ["finger down", "+\(pressEnd)", "The button shrinks to 97 %; mint → mint pressed \(hex("mint.fill.pressed"))", "`press`"],
    ["0", pressEnd, "The button returns to 100 % and to mint", "`press`"],
    ["0", settleMs("state"), "The current step slides out to the left and fades; the next slides in from the right and fades in (full screen width)", "`state`"],
], note: "Back is the mirror image. Reduce Motion: a 300 ms cross-fade.")
timeline("An urgent alert arrives (Home open)", [
    ["0", "0", "`warning` haptic; a red count badge appears on the Home tab", "instant"],
    ["0", settleMs("alertArrive"), "The new card slides down from one card-height above while fading in", "`alertArrive`"],
    ["0", settleMs("alertArrive"), "The cards below move down to make room", "`alertArrive`"],
], note: "Reduce Motion: the card fades in and the cards below move over 250 ms ease-out (`fadeIn`).")
timeline("I'm On It (Home)", [
    ["finger down", "+\(pressEnd)", "The button shrinks to 97 % with its pressed colour", "`press`"],
    ["0", "0", "`success` haptic; the card disappears, the cards below jump up, the badge count drops (\"No alerts\" appears if it was the last)", "instant (build 3)"],
], note: "Since D-034 (CRAFT T8): the card fades out while the cards below close the gap, both on the `alertArrive` spring (\(settleMs("alertArrive"))).")
timeline("Ask Debbie (tap a suggestion)", [
    ["finger down", "+\(pressEnd)", "The chip shrinks to 95 %", "`press`"],
    ["0", settleMs("alertArrive"), "Your question bubble slides down from above and fades in; the typing bubble fades in", "`alertArrive`"],
    ["0", settleMs("state"), "The suggestions fade out; the chat scrolls to the bottom", "`state`"],
    ["0", "while writing", "The lit typing dot steps one place to the right every 250 ms", "`iconSettle`, repeating"],
    ["3 s", "3 s", "\"Summarizing the latest from home…\" appears beside the dots (only if no words yet)", "instant"],
    ["first words", "+\(settleMs("alertArrive"))", "Debbie's bubble slides down and fades in; the typing bubble fades out", "`alertArrive`"],
    ["while streaming", "", "Her text grows in steps, at most once every 80 ms (AI builds only)", "no animation"],
], note: "Build 3 answers on the phone, so her bubble arrives straight away, together with your question.")
timeline("Sync Now (resident)", [
    ["finger down", "+\(pressEnd)", "The button shrinks to 97 %; mint → mint pressed", "`press`"],
    ["0", "0", "The arrows become the spinner; \"Sync Now\" becomes \"Sending…\"", "instant"],
    ["0", "until sent", "The spinner turns once per second", "`spin` (linear)"],
] + iconRows("beat", "The heart (new reading)") + [
    ["≈ 600 ms (demo)", "", "The spinner becomes the arrows; \"Sending…\" becomes \"Sync Now\"; \"Sent to home at …\" appears; `success` haptic", "instant"],
], note: "Intended but not visible in build 3: the arrows turn once (500 ms, `present`) at the tap and again on success.")
timeline("Start Live View", [
    ["finger down", "+\(pressEnd)", "The button shrinks to 97 %", "`press`"],
] + iconRows("lensPop", "Both camera icons (button and card)") + [
    ["0", "system", "The live view rises over the screen", "system full-screen cover"],
    ["≈ 2 s (demo)", "+300 ms", "\"Asking home…\" cross-fades to \"Connecting to the camera…\"", "`crossFade`"],
    ["≈ 2.9 s (demo)", "+300 ms", "The video cross-fades in; the LIVE bar and Stop appear at once; `success` haptic", "`crossFade` / instant"],
], note: "Stop: \"Stopping…\" then \"Live view ended\" cross-fade in (300 ms each); the LIVE bar and Stop disappear at once.")
timeline("Open Settings", [
    ["finger down", "+\(pressEnd)", "The glass gear button shrinks to 97 %", "`press`"],
] + iconRows("turn", "The gear (one tooth)") + [
    ["0", "system", "The Settings sheet rises", "system sheet"],
], note: "After the turn the gear jumps back to 0°, which looks identical (six teeth, 60° apart).")
timeline("Pick a role (Set Up)", [
    ["0", "0", "`selection` haptic", "instant"],
    ["0", settleMs("state"), "The chosen card fills with mint tint and gets a 2.5 pt green outline; the other card returns to grey with a 1 pt outline", "`state`"],
])
add("## 8. Where the code and CRAFT.md differ (the code wins)")
add()
add("This kit describes what build 3 does. Where CRAFT.md says something else:")
add()
for line in [
    "`press` under Reduce Motion: CRAFT says the same spring without the scale. The code uses `state` (400 ms) for the colour change.",
    "`state` under Reduce Motion: CRAFT keeps `state` for colour and opacity and reflows position without animation. The code turns everything on `state` into `crossFade` (300 ms), moves included.",
    "`alertArrive` under Reduce Motion: CRAFT reflows the other cards without animation. The code animates them with `fadeIn` (250 ms ease-out).",
    "`present`: CRAFT reserves it for custom presentations, banners and morphs. The code uses it only for the sync arrows' turn.",
    "`alertArrive`: CRAFT reserves it for alerts entering a list. The code also uses it for chat bubbles.",
    "`exit`, `fadeOut`, `leave` and `settle` are defined but not used anywhere in build 3.",
    "T8 (an answered alert leaves): fixed in D-034. The card fades out and the cards below close the gap on one spring, `alertArrive` (CRAFT names `exit`/`state`; one list, one spring).",
    "T9 (status card) and T10 (heart-rate number): CRAFT animates them on `state`. The code changes them in place: the rolling digits are set up, but readings arrive without animation.",
    "T13 (role selection): CRAFT moves a highlight with matched geometry. The code cross-fades each card's fill and outline on `state`.",
    "T14 (live view): CRAFT fades the video in with `fadeIn`. The code cross-fades it with the panels (`crossFade`, 300 ms).",
    "T15 (LIVE bar): CRAFT fades it in. The code shows it at once (and removes it at once, as CRAFT says).",
    "T18 (Settings gear): CRAFT pairs `press` with an icon step. The turn is one 250 ms step on `iconSettle`.",
    "CRAFT §3.5 (every icon button animates): the sync turn and the pop on Send, I'm On It and Stop never show, because each button is replaced in the same update (measured).",
    "M8 (working effects are still under Reduce Motion): the loading spinner keeps turning.",
    "§3.6 (Debbie's idle): blinks are at least 2.4 s apart in the code (CRAFT: 2 s).",
    "M6 (no effects on restored data): Home's heart beats when the first reading loads (listed as deferred in D-032).",
] { add("- \(line)") }
add()
add("## 9. Code references (generated)")
add()
add("Where each token is used, found by scanning the app's sources (`file:line`). Use these to check a detail with an engineer.")
add()
// Which tokens each MotionPolicy member hands out (read from its code; `animation(...)` falls back to its default).
let fallbackToken = captures(#"fallback: Animation = Motion\.(\w+)"#, in: policyText).first?[1] ?? "crossFade"
var policyTokens: [String: [String]] = [:]      // normal branch
var policyReduced: [String: [String]] = [:]     // Reduce Motion branch
for p in policyInfo {
    if let split = captures(#"^reduce \? (.+?) : (.+)$"#, in: p.info.body).first {
        policyReduced[p.name] = captures(#"Motion\.(\w+)"#, in: split[1]).map { $0[1] }
        policyTokens[p.name] = captures(#"Motion\.(\w+)"#, in: split[2]).map { $0[1] }
    } else {
        policyTokens[p.name] = captures(#"Motion\.(\w+)"#, in: p.info.body).map { $0[1] }
        if p.info.body.hasPrefix("animation(") { policyReduced[p.name] = [fallbackToken] }
    }
}
func tokenRow(_ name: String) -> [String] {
    var parts: [String] = []
    if let direct = motionRefs["Motion.\(name)"], !direct.isEmpty { parts.append("directly: " + refs(direct)) }
    for p in policyInfo {
        guard let via = motionRefs["motion.\(p.name)"], !via.isEmpty else { continue }
        if policyTokens[p.name]?.contains(name) == true { parts.append("through `motion.\(p.name)`: " + refs(via)) }
        if policyReduced[p.name]?.contains(name) == true { parts.append("through `motion.\(p.name)` under Reduce Motion: " + refs(via)) }
    }
    return ["`Motion.\(name)`", parts.isEmpty ? "not used" : parts.joined(separator: "; ")]
}
var codeRows: [[String]] = springResults.map { tokenRow($0.model.name) }
codeRows += easedTokens.map { tokenRow($0.name) }
codeRows += transitionTokens.map { tokenRow($0.name) }
codeRows.append(["`motion.step(forward:)`", refs(motionRefs["motion.step"])])
codeRows.append(["`motion.reduce` (reads the setting)", refs(motionRefs["motion.reduce"])])
add(table(["Token", "Used at"], codeRows))
add()
add("Sources: `\(motionPath)`, `\(iconPath)`, CRAFT.md §3, docs/DECISIONS.md D-029 to D-032.")
add()
write("\(outMotion)/motion.md", text: md.joined(separator: "\n"))

// MARK: - icon-animations.md

md = []
add("# Icon animations")
add()
add("Each tappable icon plays a short, one-shot animation that matches its object: the house hops, the camera's lens pops, the clock rewinds. They're defined in `IconMotion.swift` (`DIconEffect`) and built only from the named springs in `../09-motion/motion.md`.")
add()
add(generatedNote)
add()
add("## How an effect plays")
add()
add("- An effect is a list of poses. Pose 0 is rest. On a tap the icon springs to pose 1, then pose 2, and so on.")
add("- Each step has a pace: " + paceTokens.sorted { S($0.value).model.duration < S($1.value).model.duration }.map { "**\($0.key)** = `\($0.value)` (\(ms(S($0.value).model.duration)))" }.joined(separator: ", ") + ". The next step starts when the current spring reaches its duration, \(pct(bounceZero[0].atDuration)) of the way there.")
add("- Measured with SwiftUI (`tools/design/kit/motion-probe.swift`): \(measuredSteps). Each lands within one or two frames (17–33 ms at 60 Hz) of the sum of the durations.")
add("- After the last pose the icon returns to rest with no animation. You never see that jump, because the last pose looks the same as rest: the gear's 60° is one tooth of a six-tooth gear, and a full turn is 360°.")
add("- Values: **scale** (both directions), **scale X / scale Y** (one direction), **Y offset** in points (positive = down) and **rotation** in degrees (positive = clockwise). The tables give Scale X = `scale` × `sx` and Scale Y = `scale` × `sy` from the code's poses (`motion-tokens.json` has the raw values). \(ptNote)")
add("- **Pivot:** `hop` and `lidOpen` scale from the icon's bottom centre (in After Effects, put the anchor point on the bottom edge). All the others pivot on the centre.")
add("- An effect plays once per tap and never repeats by itself. CRAFT says effects never play on data restored at launch; the one exception in build 3 is Home's heart, which beats when the first reading loads.")
add("- **Outline → filled.** A selected or active icon swaps from its outline glyph to its filled twin (`home` → `home.fill`) as a cross-fade on `state` (\(settleMs("state"))). Tab icons swap when their tab is selected; the Live card's camera is always filled; the heart fills once there is a reading.")
add("- **Reduce Motion:** no movement at all. Only the outline-to-filled swap remains, as a 300 ms ease-in-out cross-fade.")
add()
add("## Summary")
add()
add(table(["Effect", "What it means (from the code)", "Icons and buttons", "Steps", "Length", "Pivot", "Shows in build 3?"], iconEffects.map { e in
    let k = keyframes(e)
    return ["`\(e.name)`", e.meaning, iconInfo[e.name]!.usedOn, "\(e.poses.count - 1)", ms(k.last!.time), e.anchor == "bottom" ? "bottom centre" : "centre", iconInfo[e.name]!.shows]
}))
add()
add("## Easing for each step")
add()
add("Each step is one spring, cut off when the next step starts (at its duration). These fits are over that window, so use them between two keyframes:")
add()
let paceRows = paceTokens.sorted { S($0.value).model.duration < S($1.value).model.duration }.map { pace, token -> [String] in
    let r = S(token)
    return ["\(pace)", "`\(token)`", ms(r.model.duration), "`\(r.stepFit.bezier.css)`", pct(r.stepFit.maxError), "\(fixed(r.stepAE.bezier.x1 * 100, 1)) % → \(fixed((1 - r.stepAE.bezier.x2) * 100, 1)) %", pct(r.stepAE.maxError)]
}
add(table(["Pace", "Spring", "Step length", "Cubic-bezier", "Max error", "AE influence (out → in, speed 0)", "Max error"], paceRows))
add()
add("All three springs have no bounce, so the curve is the same; only the length changes. Max error is a share of the step's move: 1.4 % of a 10 % scale change is 0.14 %, which you can't see.")
add()
add("## Effects")
for e in iconEffects {
    let k = keyframes(e)
    add()
    add("### `\(e.name)`")
    add()
    add("*\(e.meaning)*")
    add()
    add("Used on: \(iconInfo[e.name]!.usedOn)")
    add()
    add("Shows in build 3: \(iconInfo[e.name]!.shows)")
    add()
    add(table(["Keyframe", "Time", "Scale X", "Scale Y", "Y offset", "Rotation", "Easing into this keyframe"], k.enumerated().map { i, f in
        let easing: String
        if let token = f.spring {
            let r = S(token)
            easing = "\(paceName(token)) (`\(token)`): `\(r.stepFit.bezier.css)`, or AE \(fixed(r.stepAE.bezier.x1 * 100, 1)) % → \(fixed((1 - r.stepAE.bezier.x2) * 100, 1)) %"
        } else {
            easing = "(rest)"
        }
        return ["\(i)", "\(msInt(f.time)) ms", "\(fixed(f.pose.scaleX * 100, 0)) %", "\(fixed(f.pose.scaleY * 100, 0)) %", "\(short(f.pose.dy, 1)) pt", "\(short(f.pose.angle, 0))°", easing]
    }))
    add()
    var notes: [String] = []
    notes.append("Total \(ms(k.last!.time)). Pivot: \(e.anchor == "bottom" ? "bottom centre (anchor point on the bottom edge)" : "centre").")
    if k.contains(where: { abs($0.pose.scaleX - $0.pose.scaleY) > 1e-9 }) { notes.append("Scale X and Y differ: unlink the scale in After Effects.") }
    if let last = k.last, last.pose.angle != 0 {
        notes.append("After \(ms(last.time)) the icon jumps back to 0°, which looks identical (\(Int(last.pose.angle))° \(Int(last.pose.angle) == 360 ? "is a full turn" : "is one tooth of the six-tooth gear")).")
    } else {
        notes.append("It ends exactly at rest.")
    }
    if e.name == "spin" { notes.append("In build 3 this never shows (see `motion.md`, Sync spin). If you animate it, the turn is clockwise.") }
    if e.name == "pop" { notes.append("Only Add a Laptop shows it in build 3 (see the summary).") }
    if e.name == "rewind" { notes.append("The 45° turn is larger than CRAFT's 15° bound for icon turns. It's in both the code and CRAFT §3.5, so it's intended.") }
    for n in notes { add("- \(n)") }
}
add()
add("## Code references (generated)")
add()
add(table(["Effect", "Used at"], iconEffects.map { ["`\($0.name)`", refs(iconRefs[$0.name])] }))
add()
write("\(outMotion)/icon-animations.md", text: md.joined(separator: "\n"))

// MARK: - haptics.md

md = []
let patterns: [(feedback: String, label: String, feel: String, use: String, rhythm: String)] = [
    ("success", "`.success`", "Two quick taps, rising", "Something you did worked", "2 pulses, 100 ms apart, the second bigger"),
    ("warning", "`.warning`", "Two taps that fall", "Needs your attention", "2 pulses, 100 ms apart, the second smaller"),
    ("error", "`.error`", "Three quick taps", "Didn't work", "3 equal pulses, 80 ms apart"),
    ("selection", "`.selection`", "One faint tick", "You picked something", "1 small pulse"),
    ("impact(weight: .light)", "`.impact(weight: .light)`", "One light tap", "Something clicked into place", "1 pulse"),
]
for name in hapticNames where !patterns.contains(where: { $0.feedback == hapticFeedback[name] }) {
    fail("DebbieHaptic.\(name) uses .\(hapticFeedback[name]!), which haptics.md doesn't describe")
}
add("# Haptics")
add()
add("Debbie plays a haptic for \(hapticNames.count) named events and nothing else. Each uses one of iOS's standard feedback patterns; Debbie doesn't design custom vibrations. Haptics don't show on video, so every event below has a suggested on-screen cue (and an optional sound) for the demo film.")
add()
add(generatedNote)
add()
add("## The five patterns")
add()
add(table(["Pattern", "How it feels", "Debbie uses it for", "Events", "Cue rhythm (suggested)"], patterns.map { p in
    [p.label, p.feel, p.use, hapticNames.filter { hapticFeedback[$0] == p.feedback }.map { "`\($0)`" }.joined(separator: ", "), p.rhythm]
}))
add()
add("\"How it feels\" uses the app's own wording (Settings → Demo Controls). All play at full intensity; iOS decides the exact feel.")
add()
add("## A cue system for the film (suggestion)")
add()
add("A small, consistent visual language, so viewers \"see\" each haptic without it getting loud:")
add()
add("- **Ripple**, for a haptic that answers your tap within about a second: rings grow from the finger's touch point.")
add("- **Buzz**, for a haptic that arrives by itself (a scan, the home answering, an alert): two short curved marks beside the phone's left and right edges, like a vibrating phone.")
add("- **Rhythm carries the pattern** (the table above). One ring or one pair of marks per pulse.")
add("- **Motion, from Debbie's own tokens:** each pulse grows over 250 ms on `fadeIn`'s curve `\(standardBezier("easeOut").css)` and fades over 200 ms on `fadeOut`'s `\(standardBezier("easeIn").css)`. Rings grow from 0 to 48 pt (24 pt for selection) with a 3 pt stroke. Buzz marks are 16 pt arcs with a 3 pt round-capped stroke.")
add("- **Colour follows the moment**, never on its own (the rhythm carries the meaning too): mint \(swatch("mint.fill")) for success, selection and taps (use its companion \(swatch("accent.text")) where mint doesn't show, such as over a mint button or small on white); amber \(swatch("caution.fill")) for warnings; red \(swatch("urgent.fill")) only for the urgent alert; \(swatch("urgent.text")) (\"error red\") for errors.")
add("- **Sound (optional):** short (under 300 ms) and soft, well under the voice-over. Success: two soft rising notes. Warning: two notes falling. Error: three soft low taps. Selection: a faint tick. Light impact: a soft click. The urgent alert gets the film's one distinct sound: a calm two-tone chime, never a siren. Debbie stays calm even when it's urgent.")
add("- **Timing:** the app plays each haptic in the same frame as the visible change. Put the cue on that frame.")
add()
add("## Every event")
add()
add(table(["Event", "Pattern", "Fires when", "On screen at the same moment", "What it means", "Film cue"], hapticNames.map { name in
    let info = hapticInfo[name]!
    let label = patterns.first { $0.feedback == hapticFeedback[name] }!.label
    return ["`\(name)`", label, info.firesWhen, info.onScreen, info.means, info.cue]
}))
add()
add("## Never gets a haptic")
add()
add("Tab switches (Apple's tab bars play none), the Settings gear, ordinary taps, navigation, sheets, scrolling, typing and sending a message to Debbie. Status changes (can't reach home, monitoring limited, back online). Non-urgent alerts and alert wording updates. Data arriving in the background, including heart-rate readings. Live view stopped by you or by the 5-minute limit, and its countdown. \"Will send when you're home\". A clean unpair. Permission screens and system prompts. Anything in a notification or in the background. (CRAFT §4.2)")
add()
add("## Rules (CRAFT §4.3) and where build 3 differs")
add()
add("- Only the five patterns above, at full intensity.")
add("- A haptic is never the only signal: every event in use changes words on screen. CRAFT also wants events that happen without a tap announced to VoiceOver; in build 3 only Debbie's chat answers are announced.")
add("- There's no vibration switch in Debbie; iOS Settings → Sounds & Haptics decides.")
add("- Live view never silences haptics.")
add("- CRAFT plays \"landing\" events (an alert card, the paired screen) when their animation finishes. The code plays every haptic in the same update as the change, at the start of the motion.")
add("- CRAFT limits `alertUrgentArrived` to alerts the system didn't already sound for, once per alert ever, with none within 300 ms of another haptic. The code plays it for any new unanswered urgent alert seen since the app opened.")
add("- CRAFT §4.1 lists 17 events; the code has 18 (`formInvalid` is extra). `toggleChanged` and `formInvalid` aren't connected to any control.")
add()
add("## Feel them on a phone")
add()
add("In the demo home, Settings → **Demo Controls** lists every event, with when it plays, and a button that plays it. Use it to feel each one while you time the edit.")
add()
add("## Notes for engineers")
add()
add("- `acknowledged` can play twice from an alert's own screen: Home, still alive under the pushed screen, fires on `model.acknowledgements`, and the alert screen fires again on its own `acked` once the send returns. CRAFT H3 allows none within 300 ms.")
add("- `unpairIncomplete` can't be felt: `AppModel.unpair()` sets `phase = .welcome` before it returns, which removes Settings (and its `.debbieHaptic`) before `incomplete += 1`. `unpairNote` is never set, so the \"remove it on the laptop\" notice never shows either.")
add()
add("## Code references (generated)")
add()
add(table(["Event", "Pattern (code)", "Played at"], hapticNames.map { ["`\($0)`", "`.\(hapticFeedback[$0]!)`", refs(hapticRefs[$0])] }))
add()
add("Every event is also playable from `DemoControls.swift` (demo home only). Sources: `\(hapticPath)`, CRAFT.md §4.")
add()
write("\(outHaptics)/haptics.md", text: md.joined(separator: "\n"))

// MARK: - motion-tokens.json

func bezierJSON(_ b: Bezier) -> JSON { .array(b.list.map { .number($0, 3) }) }
func fitJSON(_ f: FitResult, ae: Bool) -> JSON {
    var pairs: [(String, JSON)] = []
    if ae {
        pairs.append(("outgoingInfluencePercent", .number(f.bezier.x1 * 100, 1)))
        pairs.append(("incomingInfluencePercent", .number((1 - f.bezier.x2) * 100, 1)))
        pairs.append(("speed", .integer(0)))
    } else {
        pairs.append(("cubicBezier", bezierJSON(f.bezier)))
        pairs.append(("css", .string(f.bezier.css)))
    }
    pairs.append(("maxErrorPercent", .number(f.maxError * 100, 2)))
    pairs.append(("rmsErrorPercent", .number(f.rms * 100, 2)))
    return .object(pairs)
}
let json: JSON = .object([
    ("about", .string("Debbie's motion tokens (build 3) for design tools. Generated by tools/design/kit/motion.sh from Motion.swift and IconMotion.swift; don't edit by hand.")),
    ("sources", .array([.string(motionPath), .string(iconPath)])),
    ("units", .object([
        ("time", .string("milliseconds unless the key ends in S")),
        ("springs", .string("mass 1; stiffness = (2π ÷ duration)²; damping = (1 − bounce) × 4π ÷ duration")),
        ("progress", .string("0 = start, 1 = end; errors are a percentage of the move")),
        ("distance", .string("points (pt); positive Y offset = down")),
        ("rotation", .string("degrees; positive = clockwise")),
    ])),
    ("checks", .object([
        ("swiftUISpringParameterMaxRelativeDifference", .number(maxParameterDiff, 15)),
        ("swiftUISpringCurveMaxDifference", .number(maxCurveDiff, 9)),
        ("closedFormMaxDifference", .number(maxAnalyticDiff, 9)),
        ("swiftUIUnitCurveMaxDifference", .number(unitCurveDiff, 9)),
        ("simulation", .string("Runge–Kutta 4, 0.01 ms steps")),
        ("iconStepsMeasured", .string(measuredSteps)),
    ])),
    ("springs", .array(springResults.map { r in
        let info = springInfo[r.model.name]!
        let k = keynote(r)
        return .object([
            ("token", .string("Motion.\(r.model.name)")),
            ("springConstant", .string("Motion.\(r.model.name)Spring")),
            ("swiftUI", .string("Spring(duration: \(fixed(r.model.duration, 2)), bounce: \(short(r.model.bounce, 2)))")),
            ("durationS", .number(r.model.duration, 3)),
            ("bounce", .number(r.model.bounce, 3)),
            ("mass", .integer(1)),
            ("stiffness", .number(r.model.stiffness, 3)),
            ("damping", .number(r.model.damping, 3)),
            ("dampingRatio", .number(r.model.zeta, 3)),
            ("reaches95PercentMs", .number(r.t95 * 1000, 1)),
            ("settlesWithin1PercentMs", .number(r.settle1 * 1000, 1)),
            ("progressAtDuration", .number(r.atDuration, 4)),
            ("overshootPercent", .number(r.overshoot * 100, 2)),
            ("appleSettlingDurationS", .number(r.appleSettling, 3)),
            ("overSettleTime", .object([
                ("lengthMs", .number(r.settle1 * 1000, 1)),
                ("bezier", fitJSON(r.fit, ae: false)),
                ("afterEffects", fitJSON(r.ae, ae: true)),
                ("keynotePreset", .object([("acceleration", .string(presetName(k.label))), ("lengthMs", .integer(msInt(k.scale * r.settle1))), ("maxErrorPercent", .number(k.maxError * 100, 2))])),
                ("cssLinear", .string(r.css)),
                ("cssLinearMaxErrorPercent", .number(r.cssMaxError * 100, 2)),
            ])),
            ("overOneIconStep", .object([
                ("lengthMs", .number(r.model.duration * 1000, 1)),
                ("bezier", fitJSON(r.stepFit, ae: false)),
                ("afterEffects", fitJSON(r.stepAE, ae: true)),
            ])),
            ("usedFor", .string(info.usedFor)),
            ("seen", .string(info.seen)),
            ("reduceMotion", .string(info.reduceMotion)),
            ("usedInBuild3", .bool(info.inBuild3)),
        ])
    })),
    ("eased", .array(easedTokens.map { a in
        let info = easedInfo[a.name]!
        return .object([
            ("token", .string("Motion.\(a.name)")),
            ("swiftUI", .string(a.code)),
            ("durationMs", .integer(msInt(a.duration))),
            ("cubicBezier", bezierJSON(standardBezier(a.kind))),
            ("css", .string(standardBezier(a.kind).css)),
            ("repeats", .bool(a.repeats)),
            ("autoreverses", .bool(a.autoreverses)),
            ("usedFor", .string(info.usedFor)),
            ("seen", .string(info.seen)),
            ("reduceMotion", .string(info.reduceMotion)),
            ("usedInBuild3", .bool(info.inBuild3)),
        ])
    })),
    ("transitions", .array(transitionTokens.map { t in
        let info = transitionInfo[t.name]!
        return .object([("token", .string("Motion.\(t.name)")), ("swiftUI", .string(t.code)), ("does", .string(info.does)), ("seen", .string(info.seen)), ("reduceMotion", .string(info.reduceMotion))])
    })),
    ("reduceMotion", .object([
        ("turnedOnBy", .array([.string("Reduce Motion"), .string("Prefer Cross-Fade Transitions")])),
        ("policy", .array(policyInfo.map { p in
            .object([("member", .string("motion.\(p.name)")), ("code", .string(p.info.body)), ("normally", .string(p.info.normal)), ("withReduceMotion", .string(p.info.reduced)), ("usedBy", .string(p.info.usedBy))])
        })),
    ])),
    ("iconEffects", .array(iconEffects.map { e in
        let k = keyframes(e)
        return .object([
            ("effect", .string(e.name)),
            ("meaning", .string(e.meaning)),
            ("usedOn", .string(iconInfo[e.name]!.usedOn)),
            ("showsInBuild3", .string(iconInfo[e.name]!.shows)),
            ("pivot", .string(e.anchor == "bottom" ? "bottom centre" : "centre")),
            ("totalMs", .integer(msInt(k.last!.time))),
            ("keyframes", .array(k.map { f in
                var pairs: [(String, JSON)] = [
                    ("timeMs", .integer(msInt(f.time))),
                    ("scaleXPercent", .number(f.pose.scaleX * 100, 1)),
                    ("scaleYPercent", .number(f.pose.scaleY * 100, 1)),
                    ("offsetYPt", .number(f.pose.dy, 2)),
                    ("rotationDeg", .number(f.pose.angle, 1)),
                    ("pose", .object([("step", .integer(f.pose.step)), ("scale", .number(f.pose.scale, 3)), ("sx", .number(f.pose.sx, 3)),
                                      ("sy", .number(f.pose.sy, 3)), ("dy", .number(f.pose.dy, 2)), ("angle", .number(f.pose.angle, 1)),
                                      ("pace", f.spring == nil ? .null : .string(f.pose.pace))])),
                ]
                if let token = f.spring {
                    let r = S(token)
                    pairs.append(("easeIn", .object([
                        ("pace", .string(paceName(token))), ("spring", .string("Motion.\(token)")),
                        ("cubicBezier", bezierJSON(r.stepFit.bezier)),
                        ("afterEffectsInfluencePercent", .array([.number(r.stepAE.bezier.x1 * 100, 1), .number((1 - r.stepAE.bezier.x2) * 100, 1)])),
                    ])))
                }
                return .object(pairs)
            })),
        ])
    })),
])
write("\(outMotion)/motion-tokens.json", text: json.render() + "\n")

// MARK: - curves.png

final class Drawing {
    let ctx: CGContext
    let width: Int, height: Int
    enum Align { case left, center, right }

    init(width: Int, height: Int) {
        self.width = width
        self.height = height
        guard let space = CGColorSpace(name: CGColorSpace.sRGB),
              let c = CGContext(data: nil, width: width, height: height, bitsPerComponent: 8, bytesPerRow: 0, space: space,
                                bitmapInfo: CGImageAlphaInfo.premultipliedLast.rawValue) else { fail("can't make a bitmap") }
        ctx = c
        ctx.translateBy(x: 0, y: CGFloat(height))   // top-left origin, y down
        ctx.scaleBy(x: 1, y: -1)
        ctx.setShouldAntialias(true)
        ctx.interpolationQuality = .high
    }

    func font(_ size: CGFloat, _ weight: NSFont.Weight) -> CTFont { NSFont.systemFont(ofSize: size, weight: weight) as CTFont }

    @discardableResult
    func text(_ s: String, _ x: CGFloat, _ baseline: CGFloat, size: CGFloat, weight: NSFont.Weight = .regular, color: CGColor, align: Align = .left) -> CGFloat {
        let attributes: [NSAttributedString.Key: Any] = [
            NSAttributedString.Key(kCTFontAttributeName as String): font(size, weight),
            NSAttributedString.Key(kCTForegroundColorAttributeName as String): color,
        ]
        let line = CTLineCreateWithAttributedString(NSAttributedString(string: s, attributes: attributes))
        let w = CGFloat(CTLineGetTypographicBounds(line, nil, nil, nil))
        let x0 = align == .left ? x : (align == .center ? x - w / 2 : x - w)
        ctx.saveGState()
        ctx.textMatrix = CGAffineTransform(scaleX: 1, y: -1)
        ctx.textPosition = CGPoint(x: x0, y: baseline)
        CTLineDraw(line, ctx)
        ctx.restoreGState()
        return w
    }

    func fill(_ rect: CGRect, _ color: CGColor, radius: CGFloat = 0) {
        ctx.setFillColor(color)
        ctx.addPath(CGPath(roundedRect: rect, cornerWidth: radius, cornerHeight: radius, transform: nil))
        ctx.fillPath()
    }

    func line(_ points: [CGPoint], _ color: CGColor, width: CGFloat, dash: [CGFloat] = [], cap: CGLineCap = .round) {
        guard points.count > 1 else { return }
        ctx.saveGState()
        ctx.setStrokeColor(color)
        ctx.setLineWidth(width)
        ctx.setLineCap(cap)
        ctx.setLineJoin(.round)
        ctx.setLineDash(phase: 0, lengths: dash)
        ctx.addLines(between: points)
        ctx.strokePath()
        ctx.restoreGState()
    }

    func png() -> Data {
        guard let image = ctx.makeImage() else { fail("can't make the image") }
        let data = NSMutableData()
        guard let dest = CGImageDestinationCreateWithData(data, UTType.png.identifier as CFString, 1, nil) else { fail("can't encode PNG") }
        CGImageDestinationAddImage(dest, image, nil)
        guard CGImageDestinationFinalize(dest) else { fail("can't encode PNG") }
        return data as Data
    }
}

struct Panel {
    let title: String
    let subtitle: String
    let detail: String
    let curve: (Double) -> Double        // progress at t (s)
    let fitted: ((Double) -> Double)?    // progress at t (s), drawn up to `fitEnd`
    let fitEnd: Double
    let duration: Double?
    let settle: Double?
}

let panels: [Panel] = springResults.map { r in
    let s = r.model
    return Panel(title: s.name, subtitle: "Spring(\(fixed(s.duration, 2)) s, bounce \(short(s.bounce, 2)))\(springInfo[s.name]!.inBuild3 ? "" : " · unused")",
                 detail: "k \(fixed(s.stiffness, 1)) · c \(fixed(s.damping, 2)) · 1 % at \(fixed(r.settle1 * 1000, 0)) ms",
                 curve: { s.value($0) }, fitted: { r.fit.bezier.value(at: $0 / r.settle1) }, fitEnd: r.settle1,
                 duration: s.duration, settle: r.settle1)
} + easedTokens.map { a in
    let b = standardBezier(a.kind)
    let d = a.duration
    let label = a.repeats ? "linear, 1 turn per \(msInt(d)) ms, repeats" : "\(standardCurves.first { $0.name == a.kind }!.label) \(msInt(d)) ms"
    return Panel(title: a.name, subtitle: label + (easedInfo[a.name]!.inBuild3 ? "" : " · unused"),
                 detail: b.css,
                 curve: { t in a.repeats ? min(1, t / d) : b.value(at: t / d) }, fitted: nil, fitEnd: 0,
                 duration: d, settle: nil)
}

let columns = 4
let pageW = 2000, margin: CGFloat = 56, gap: CGFloat = 28
let panelW = (CGFloat(pageW) - 2 * margin - CGFloat(columns - 1) * gap) / CGFloat(columns)
let panelH: CGFloat = 400
let headerH: CGFloat = 150
let rows = Int(ceil(Double(panels.count + 1) / Double(columns)))
let pageH = Int(headerH + CGFloat(rows) * panelH + CGFloat(rows - 1) * gap + margin)
let drawing = Drawing(width: pageW, height: pageH)
let ink = cgColor("text.primary"), ink2 = cgColor("text.secondary"), grid = cgColor("separator")
let springInk = cgColor("accent.text"), fitInk = cgColor("live.fill"), mint = cgColor("mint.fill"), mintTint = cgColor("mint.tint")
drawing.fill(CGRect(x: 0, y: 0, width: pageW, height: pageH), cgColor("bg.canvas"))
drawing.text("Debbie motion curves", margin, 66, size: 40, weight: .bold, color: ink)
drawing.text("Progress from 0 to 100 % over time for every animation token in Motion.swift (build 3). Shared time axis: 0–1000 ms.", margin, 104, size: 20, color: ink2)
drawing.text("Generated by tools/design/kit/motion.sh. Springs are simulated (mass 1); dashed lines are the fitted cubic-beziers.", margin, 132, size: 20, color: ink2)

let vMin = -0.08, vMax = 1.12, tMax = 1.0
for (index, panel) in (panels.map { Optional($0) } + [nil]).enumerated() {
    let col = index % columns, row = index / columns
    let px = margin + CGFloat(col) * (panelW + gap)
    let py = headerH + CGFloat(row) * (panelH + gap)
    drawing.fill(CGRect(x: px, y: py, width: panelW, height: panelH), cgColor("bg.surface"), radius: 20)
    let plot = CGRect(x: px + 64, y: py + 104, width: panelW - 92, height: panelH - 160)
    guard let panel else {
        // Legend
        drawing.text("Key", px + 24, py + 44, size: 26, weight: .semibold, color: ink)
        let items: [(String, CGColor, CGFloat, [CGFloat])] = [
            ("The real curve (spring simulated)", springInk, 4, []),
            ("Fitted cubic-bezier (within 1.5 %)", fitInk, 3, [10, 7]),
            ("Spring duration (bounce 0: 98.6 %)", ink2, 2, [2, 6]),
            ("Settled within 1 %", mint, 4, []),
        ]
        for (i, item) in items.enumerated() {
            let y = py + 96 + CGFloat(i) * 52
            drawing.line([CGPoint(x: px + 28, y: y), CGPoint(x: px + 96, y: y)], item.1, width: item.2, dash: item.3)
            drawing.text(item.0, px + 112, y + 7, size: 19, color: ink)
        }
        drawing.text("Time axis in milliseconds. Fill: mint tint.", px + 28, py + 318, size: 17, color: ink2)
        drawing.text("Unused: defined, not used in build 3.", px + 28, py + 346, size: 17, color: ink2)
        continue
    }
    drawing.text(panel.title, px + 24, py + 44, size: 28, weight: .semibold, color: ink)
    drawing.text(panel.subtitle, px + 24, py + 72, size: 18, color: ink2)
    drawing.text(panel.detail, px + 24, py + 96, size: 16, color: ink2)
    drawing.fill(plot, cgColor("bg.canvas"))
    func X(_ t: Double) -> CGFloat { plot.minX + CGFloat(t / tMax) * plot.width }
    func Y(_ v: Double) -> CGFloat { plot.maxY - CGFloat((v - vMin) / (vMax - vMin)) * plot.height }
    for v in [0.0, 0.5, 1.0] {
        drawing.line([CGPoint(x: plot.minX, y: Y(v)), CGPoint(x: plot.maxX, y: Y(v))], grid, width: 1.5, cap: .butt)
        drawing.text(v == 0 ? "0" : (v == 1 ? "100 %" : "50 %"), plot.minX - 8, Y(v) + 6, size: 15, color: ink2, align: .right)
    }
    for i in 0...10 {
        let t = Double(i) / 10
        drawing.line([CGPoint(x: X(t), y: plot.maxY), CGPoint(x: X(t), y: plot.maxY + (i % 2 == 0 ? 8 : 4))], ink2, width: 1.5, cap: .butt)
        if i % 2 == 0 { drawing.text("\(i * 100)", X(t), plot.maxY + 28, size: 15, color: ink2, align: .center) }
    }
    let steps = Int(plot.width)
    let points = (0...steps).map { i -> CGPoint in
        let t = Double(i) / Double(steps) * tMax
        return CGPoint(x: X(t), y: Y(panel.curve(t)))
    }
    // Mint tint under the curve.
    drawing.ctx.saveGState()
    drawing.ctx.setFillColor(mintTint)
    drawing.ctx.move(to: CGPoint(x: X(0), y: Y(0)))
    for p in points { drawing.ctx.addLine(to: p) }
    drawing.ctx.addLine(to: CGPoint(x: X(tMax), y: Y(0)))
    drawing.ctx.closePath()
    drawing.ctx.fillPath()
    drawing.ctx.restoreGState()
    if let settle = panel.settle {
        drawing.line([CGPoint(x: X(settle), y: plot.minY + 6), CGPoint(x: X(settle), y: plot.maxY)], mint, width: 4, cap: .butt)
    }
    if let d = panel.duration, panel.settle != nil {
        drawing.line([CGPoint(x: X(d), y: plot.minY + 6), CGPoint(x: X(d), y: plot.maxY)], ink2, width: 2, dash: [2, 6])
    }
    drawing.line(points, springInk, width: 4)
    if let fitted = panel.fitted {
        let fitPoints = (0...steps).compactMap { i -> CGPoint? in
            let t = Double(i) / Double(steps) * tMax
            return t <= panel.fitEnd ? CGPoint(x: X(t), y: Y(fitted(t))) : nil
        }
        drawing.line(fitPoints, fitInk, width: 3, dash: [10, 7])
    }
}
write("\(outMotion)/curves.png", drawing.png())

print("checks: SwiftUI Spring parameters ≤ \(maxParameterDiff), SwiftUI curve ≤ \(maxCurveDiff), closed form ≤ \(maxAnalyticDiff), UnitCurve ≤ \(unitCurveDiff)")
print("bounce-0 springs: 1 % at \(fixed(settleRatio, 4)) × duration; bezier \(zeroFit.bezier.css) (max \(pct(zeroFit.maxError, 2))); AE \(fixed(zeroAE.bezier.x1 * 100, 1)) % → \(fixed((1 - zeroAE.bezier.x2) * 100, 1)) % (max \(pct(zeroAE.maxError, 2)))")
