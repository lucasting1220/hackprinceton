// Designer kit helper (used only by tools/design/kit/icons-debbie.sh; nothing here ships).
// Prints Debbie's idle pose for every frame of the kit's clip, computed by the app's own `IdlePose`, which the kit
// script copies verbatim out of Persona/DebbieAvatar.swift and compiles beside this file:
//
//   swiftc -parse-as-library icons-debbie-idle.swift IdlePose.swift
//   icons-debbie-idle <t0> <fps> <frames> <poses.csv> <blinks.txt>
//
// t0 is the clip's first frame as seconds after 2001-01-01 00:00 UTC (Date.timeIntervalSinceReferenceDate, the clock
// IdlePose reads). Frame n is at t0 + n / fps. blinks.txt lists every eye-state change near the clip, found by sampling
// the app's blink function every 0.5 ms, with times relative to t0.
import CoreGraphics
import Foundation

@main
struct IconsDebbieIdle {
    static func main() {
        let args = CommandLine.arguments
        guard args.count == 6, let t0 = Double(args[1]), let fps = Double(args[2]), let count = Int(args[3]) else {
            FileHandle.standardError.write(Data("usage: icons-debbie-idle <t0> <fps> <frames> <poses.csv> <blinks.txt>\n".utf8))
            exit(2)
        }
        func name(_ e: IdlePose.Eyes) -> String {
            switch e {
            case .open: return "open"
            case .squash: return "squash"
            case .closed: return "closed"
            }
        }
        var csv = "frame,t,breath,tilt,lift,eyes\n"
        for i in 0..<count {
            let rel = Double(i) / fps
            let pose = IdlePose(at: Date(timeIntervalSinceReferenceDate: t0 + rel))
            csv += String(format: "%d,%.6f,%.9f,%.9f,%.9f,", i, rel, Double(pose.breath), pose.tilt, Double(pose.lift)) + name(pose.eyes) + "\n"
        }
        var blinks = String(format: "# t0 = %.6f s after 2001-01-01 00:00 UTC; times below are seconds after t0\n", t0)
        let step = 0.0005
        var previous = IdlePose.eyes(at: t0 - 0.3)
        var k = 1
        while true {
            let rel = -0.3 + Double(k) * step
            if rel > Double(count) / fps { break }
            let now = IdlePose.eyes(at: t0 + rel)
            if now != previous {
                blinks += String(format: "%.4f %@ -> %@\n", rel, name(previous), name(now))
                previous = now
            }
            k += 1
        }
        do {
            try csv.write(toFile: args[4], atomically: true, encoding: .utf8)
            try blinks.write(toFile: args[5], atomically: true, encoding: .utf8)
        } catch {
            FileHandle.standardError.write(Data("icons-debbie-idle: \(error)\n".utf8))
            exit(1)
        }
        print("idle: \(count) frames at \(fps) fps from t0 \(String(format: "%.1f", t0)) s")
    }
}
