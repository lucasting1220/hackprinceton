import SwiftUI

/// What an icon's own animation means (CRAFT.md §3.5). Each icon moves the way its object would. An effect plays once
/// per trigger, is built only from the named springs, and lasts under a second. Under Reduce Motion only the
/// outline-to-fill change remains (M8, M9).
public enum DIconEffect: Sendable, Hashable {
    /// Home: a small hop that lands with a squash.
    case hop
    /// Camera: the body widens like a shutter, then settles.
    case lensPop
    /// History: turns back, then returns.
    case rewind
    /// Laptop: the lid drops and lifts again from the hinge.
    case lidOpen
    /// Gear: turns one tooth (60°; a six-tooth gear looks the same afterwards).
    case turn
    /// Heart: two beats.
    case beat
    /// Sync: one full turn.
    case spin
    /// A short pop, for confirmations.
    case pop

    var anchor: UnitPoint {
        switch self {
        case .hop, .lidOpen: .bottom
        default: .center
        }
    }

    /// Step 0 is rest. The return to step 0 is instant, and every sequence ends on a pose that looks like rest.
    /// Bounds (note 16 R9): ≤ 0.6 s, scale 0.85–1.15, ≤ 4 pt travel, ≤ 15° turn except symmetric glyphs.
    var poses: [IconPose] {
        switch self {
        case .hop: [.rest, IconPose(step: 1, sx: 1.03, sy: 0.94, dy: 2, pace: .quick), IconPose(step: 2)]
        case .lensPop: [.rest, IconPose(step: 1, scale: 1.10, pace: .quick), IconPose(step: 2)]
        case .rewind: [.rest, IconPose(step: 1, angle: -45, pace: .quick), IconPose(step: 2)]
        case .lidOpen: [.rest, IconPose(step: 1, sy: 0.88, pace: .quick), IconPose(step: 2)]
        case .turn: [.rest, IconPose(step: 1, angle: 60)]
        case .beat: [.rest, IconPose(step: 1, scale: 1.10, pace: .quick), IconPose(step: 2, scale: 0.97, pace: .quick),
                     IconPose(step: 3, scale: 1.06, pace: .quick), IconPose(step: 4, pace: .quick)]
        case .spin: [.rest, IconPose(step: 1, angle: 360, pace: .slow)]
        case .pop: [.rest, IconPose(step: 1, scale: 1.10, pace: .quick), IconPose(step: 2)]
        }
    }
}

public struct IconPose: Equatable, Sendable {
    enum Pace: Sendable { case quick, settle, slow }
    var step: Int
    var scale: CGFloat = 1
    var sx: CGFloat = 1
    var sy: CGFloat = 1
    var angle: Double = 0
    var dy: CGFloat = 0
    var pace: Pace = .settle
    static let rest = IconPose(step: 0)

    /// The step's animation: quick (0.15 s), settle (0.25 s) or slow (`present`, 0.5 s, for a full turn).
    var animation: Animation? {
        guard step > 0 else { return nil }
        switch pace {
        case .quick: return Motion.iconQuick
        case .settle: return Motion.iconSettle
        case .slow: return Motion.present
        }
    }
}

/// A custom symbol with its own animation and an optional filled twin for the selected or active state
/// (CRAFT.md §2.6 I3: outline by default, filled only when selected or active).
public struct DAnimatedIcon: View {
    let name: String
    let filled: String?
    let effect: DIconEffect
    let trigger: Int
    let active: Bool
    let label: String?
    @Environment(\.motion) private var motion

    public init(_ name: String, filled: String? = nil, effect: DIconEffect, trigger: Int, active: Bool = false, label: String? = nil) {
        self.name = name; self.filled = filled; self.effect = effect; self.trigger = trigger; self.active = active; self.label = label
    }

    public var body: some View {
        let glyph = ZStack {
            DIcon(name).opacity(filled != nil && active ? 0 : 1)
            if let filled { DIcon(filled).opacity(active ? 1 : 0) }
        }
        .animation(motion.state, value: active)
        .accessibilityElement(children: .ignore)
        .accessibilityLabel(Text(label ?? ""))
        .accessibilityAddTraits(.isImage)
        .accessibilityHidden(label == nil)

        if motion.reduce {
            glyph
        } else {
            glyph.phaseAnimator(effect.poses, trigger: trigger) { content, pose in
                content
                    .scaleEffect(x: pose.sx * pose.scale, y: pose.sy * pose.scale, anchor: effect.anchor)
                    .rotationEffect(.degrees(pose.angle))
                    .offset(y: pose.dy)
            } animation: { pose in
                // Each step has its own pace. The snap back to rest (step 0) is instant and invisible.
                pose.animation
            }
        }
    }
}
