@testable import DebbieDesignSystem
import Foundation
import Testing

/// Icon effects and Debbie's idle stay within CRAFT.md §3.5–§3.6 and research notes 16 R9 and 17 R23.
@MainActor @Suite struct MotionShapeTests {
    static let pace: [IconPose.Pace: Double] = [.quick: 0.15, .settle: 0.25, .slow: 0.50]

    @Test func everyIconEffectEndsAtRestWithinBounds() {
        let effects: [DIconEffect] = [.hop, .lensPop, .rewind, .lidOpen, .turn, .beat, .spin, .pop]
        for effect in effects {
            let poses = effect.poses
            #expect(poses.first == .rest, "\(effect) starts at rest")
            let last = poses[poses.count - 1]
            let symmetric = effect == .turn || effect == .spin
            #expect(last.scale == 1 && last.sx == 1 && last.sy == 1 && last.dy == 0, "\(effect) ends at rest")
            #expect(symmetric ? last.angle.truncatingRemainder(dividingBy: 60) == 0 : last.angle == 0, "\(effect) ends on an identical pose")
            let total = poses.dropFirst().reduce(0.0) { $0 + (Self.pace[$1.pace] ?? 1) }
            #expect(total <= 0.6 + 1e-9, "\(effect) lasts \(total) s")
            for pose in poses {
                #expect((0.85...1.15).contains(pose.scale * pose.sx) && (0.85...1.15).contains(pose.scale * pose.sy), "\(effect) scale")
                #expect(abs(pose.dy) <= 4, "\(effect) travel")
                #expect(symmetric || abs(pose.angle) <= 45, "\(effect) turn")
            }
        }
    }

    @Test func blinkClosesFasterThanItOpensAndNeverCrowds() {
        // Ten minutes at 30 frames a second.
        var starts: [Double] = []
        var previous = IdlePose.Eyes.open
        var sequence: [IdlePose.Eyes] = []
        var sequences: [[IdlePose.Eyes]] = []
        for frame in 0..<(30 * 600) {
            let t = 800_000_000 + Double(frame) / 30
            let eyes = IdlePose.eyes(at: t)
            if previous == .open, eyes != .open { starts.append(t); sequence = [] }
            if eyes != .open { sequence.append(eyes) }
            if previous != .open, eyes == .open { sequences.append(sequence) }
            previous = eyes
        }
        #expect(starts.count >= 120, "about one blink every 4.4 s")
        for (a, b) in zip(starts, starts.dropFirst()) {
            let gap = b - a
            #expect(gap >= 2.0, "blinks \(gap) s apart: one at a time, never a fast double")
        }
        for s in sequences {
            #expect(s.first == .squash && s.last == .squash && s.contains(.closed), "squash, closed, squash: \(s)")
            if let firstClosed = s.firstIndex(of: .closed), let lastClosed = s.lastIndex(of: .closed) {
                #expect(firstClosed <= s.count - 1 - lastClosed, "closes faster than it opens")
            }
        }
    }
}
