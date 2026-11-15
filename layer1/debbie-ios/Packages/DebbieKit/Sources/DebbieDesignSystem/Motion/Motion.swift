import SwiftUI
import UIKit

/// The motion vocabulary (CRAFT.md §3.1). Views never name a curve; lint M1–M8 enforces it.
public enum Motion {
    public static let pressSpring = Spring(duration: 0.20, bounce: 0)
    public static let stateSpring = Spring(duration: 0.40, bounce: 0)
    public static let settleSpring = Spring(duration: 0.40, bounce: 0.15)
    public static let alertArriveSpring = Spring(duration: 0.45, bounce: 0)
    public static let presentSpring = Spring(duration: 0.50, bounce: 0)
    public static let exitSpring = Spring(duration: 0.30, bounce: 0)
    /// The tab bar's selection highlight moving to the tapped tab; retargets mid-flight (research note 16 R8).
    public static let tabSelectSpring = Spring(duration: 0.30, bounce: 0)
    /// Icon effects (§3.5; note 16 R9): a quick first step, then a settle. Any overshoot is an explicit pose, never bounce.
    public static let iconQuickSpring = Spring(duration: 0.15, bounce: 0)
    public static let iconSettleSpring = Spring(duration: 0.25, bounce: 0)

    public static let press = Animation.spring(pressSpring)
    public static let tabSelect = Animation.spring(tabSelectSpring)
    public static let iconQuick = Animation.spring(iconQuickSpring)
    public static let iconSettle = Animation.spring(iconSettleSpring)
    /// Switching tabs: the content cross-fades in place, as the system tab bar does (note 16 R7).
    public static let tabFade = Animation.easeInOut(duration: 0.15)
    public static let state = Animation.spring(stateSpring)
    public static let settle = Animation.spring(settleSpring)
    public static let alertArrive = Animation.spring(alertArriveSpring)
    public static let present = Animation.spring(presentSpring)
    public static let exit = Animation.spring(exitSpring)
    public static let fadeIn = Animation.easeOut(duration: 0.25)
    public static let fadeOut = Animation.easeIn(duration: 0.20)
    public static let crossFade = Animation.easeInOut(duration: 0.30)
    public static let spin = Animation.linear(duration: 1.0).repeatForever(autoreverses: false)

    public static let allSprings: [(name: String, spring: Spring)] = [
        ("press", pressSpring), ("state", stateSpring), ("settle", settleSpring),
        ("alertArrive", alertArriveSpring), ("present", presentSpring), ("exit", exitSpring),
        ("tabSelect", tabSelectSpring), ("iconQuick", iconQuickSpring), ("iconSettle", iconSettleSpring),
    ]

    /// Named transitions (CRAFT.md §3.3).
    public static let arrive = AnyTransition.move(edge: .top).combined(with: .opacity)
    public static let leave = AnyTransition.opacity
    public static let swap = AnyTransition.opacity
    public static let numeric = ContentTransition.numericText()

    /// Content settling into place beneath something that is arriving (the welcome's words and buttons as the intro's
    /// lockup glides in): it rises from 24 pt below on the same `present` spring, so the screen arrives as one movement
    /// rather than a glide followed by a pop. `delay` staggers groups 40 ms apart, never more than 80 ms (M5; §3.7).
    public static func settleIn(delay: TimeInterval = 0) -> AnyTransition {
        AnyTransition.offset(y: 24).combined(with: .opacity).animation(Motion.present.delay(delay))
    }

    /// The launch intro (CRAFT.md §3.7; D-033): a heartbeat that becomes the mark, then the welcome screen. One clock
    /// drives pure functions of time, as Debbie's idle does, so every frame is reproducible. Times are seconds from the
    /// first frame; the timeline is checked in order by `IntroShapeTests`.
    public nonisolated enum Intro {
        /// The monitor's paper speed in points per second: one whole beat stays in view behind the pen on the smallest iPhone.
        public static let paperSpeed: CGFloat = 120
        /// The monitor was already running: this much paper (0.9 s, 108 pt of line) is on screen in the first frame.
        public static let preroll: TimeInterval = 0.90
        /// A resting heart at the brisk end, 80 beats a minute. The first beat is already on the strip, drifting, when
        /// the app appears (it struck half a second before the first frame); the second strikes at 0.25 s; the third,
        /// one beat later, is the mark (owner, 22:55 and 23:30: the beats were taking too long).
        public static let beatInterval: TimeInterval = 0.75
        public static let firstBeat: TimeInterval = -0.50
        /// The paper brakes evenly to a stop between these two moments (a short brake, so the pen never seems to pause),
        /// then the pen strikes up the stem. The stop falls exactly one beat after the second R wave.
        public static let flowEnds: TimeInterval = 0.89
        public static let stemEntry: TimeInterval = 1.11
        /// The outline is drawn in one movement. The curve starts with speed, so the stem is the fastest stroke, as an
        /// R wave rises, and the bowl and the close are the soft part.
        public static let flourish: TimeInterval = 0.42
        public static let flourishCurve = UnitCurve.bezier(startControlPoint: UnitPoint(x: 0.20, y: 0.45), endControlPoint: UnitPoint(x: 0.30, y: 1))
        /// The line sets into the solid mark while the pen's glow swells into the mint tile (on `Motion.settleSpring`,
        /// whose small overshoot is the lockup's one beat).
        public static let setBegins: TimeInterval = 1.48
        public static let setDuration: TimeInterval = 0.26
        public static let wordmarkAt: TimeInterval = 1.54
        public static let wordmarkDuration: TimeInterval = 0.30
        /// The lockup glides to its place on the welcome screen (`present`) and the mark becomes Debbie; a quarter of a
        /// second in, once the lockup has passed where the words will be, the words and buttons rise in beneath it on
        /// the same spring, so it all arrives as one movement. The overlays are swapped for the layout's own views only
        /// once the spring has settled.
        public static let handoffAt: TimeInterval = 1.95
        public static let arriveAt: TimeInterval = 2.20
        public static let doneAt: TimeInterval = 2.80
        /// The drawing's own measures.
        public static let traceWidth: CGFloat = 3
        public static let setWidth: CGFloat = 5
        public static let penRadius: CGFloat = 3
        public static let glowRadius: CGFloat = 16
        public static let glowAlpha: CGFloat = 0.30
        public static let glowSwell: CGFloat = 2.5
        /// Trace older than this many beats fades towards `persistenceFloor` at the edge, like phosphor.
        public static let persistenceBeats: CGFloat = 1.1
        public static let persistenceFloor: CGFloat = 0.18
        public static let drainSoftness: CGFloat = 24
        public static let tileStartScale: CGFloat = 0.5
        public static let tileFade: TimeInterval = 0.20
        public static let penFadeIn: TimeInterval = 0.08
        public static let penFadeOut: TimeInterval = 0.10
        public static let wordmarkRise: CGFloat = 10
        /// The handoff's two halves: the mark leaves quickly (`exit`, shrinking toward the tile's centre) and Debbie
        /// arrives on `present` a breath later, so the two are never both half-shown.
        public static let markLeaveScale: CGFloat = 0.7
        public static let faceDelay: TimeInterval = 0.08
        /// Reduce Motion: the lockup fades in where it will stay, holds, then the words fade in. Nothing moves.
        public static let reducedHandoffAt: TimeInterval = 0.80
        public static let reducedArriveAt: TimeInterval = 0.80
        public static let reducedDoneAt: TimeInterval = 1.20
        public static let easeOut = UnitCurve.easeOut
        public static let easeInOut = UnitCurve.easeInOut
    }
}

/// Reduce Motion and Prefer Cross-Fade, combined (CRAFT.md §3.2 M9).
public struct MotionPolicy: Sendable, Equatable {
    public var reduce: Bool
    public init(reduce: Bool) { self.reduce = reduce }

    public func animation(_ a: Animation, fallback: Animation = Motion.crossFade) -> Animation { reduce ? fallback : a }
    public var state: Animation { animation(Motion.state) }
    public var press: Animation { reduce ? Motion.state : Motion.press }
    public var arriveAnimation: Animation { reduce ? Motion.fadeIn : Motion.alertArrive }
    public var arrive: AnyTransition { reduce ? .opacity : Motion.arrive }
    public var settle: Animation { reduce ? Animation.spring(Spring(duration: 0.40, bounce: 0)) : Motion.settle }
    /// A step in a linear flow (T6): forward pushes from the trailing edge, Back from the leading edge.
    public func step(forward: Bool) -> AnyTransition { reduce ? .opacity : .push(from: forward ? .trailing : .leading) }
    /// Under Reduce Motion the highlight fades at the old tab and in at the new one instead of moving.
    public var tabSelect: Animation { reduce ? Motion.tabFade : Motion.tabSelect }
    /// Scrolling content into view (the chat's newest message). Under Reduce Motion it jumps: a scroll is movement.
    public var scroll: Animation? { reduce ? nil : Motion.state }
    /// An alert card in Home's list: arrives from the top (T7) and leaves by fading (T8).
    public var alertCard: AnyTransition { reduce ? .opacity : .asymmetric(insertion: Motion.arrive, removal: Motion.leave) }
    /// Something arriving on screen, such as the intro's lockup taking its place (T19).
    public var present: Animation { animation(Motion.present) }
    /// Settling in beneath it: under Reduce Motion a plain fade on the same stagger.
    public func settleIn(delay: TimeInterval = 0) -> AnyTransition {
        reduce ? AnyTransition.opacity.animation(Motion.crossFade.delay(delay)) : Motion.settleIn(delay: delay)
    }
}

private struct MotionPolicyKey: EnvironmentKey { static let defaultValue = MotionPolicy(reduce: false) }

public extension EnvironmentValues {
    var motion: MotionPolicy {
        get { self[MotionPolicyKey.self] }
        set { self[MotionPolicyKey.self] = newValue }
    }
}

/// Reads the system settings into `\.motion` (apply once at the app root).
public struct MotionPolicyReader: ViewModifier {
    @Environment(\.accessibilityReduceMotion) private var reduceMotion
    private let forced: Bool
    public init(forced: Bool = false) { self.forced = forced }
    public func body(content: Content) -> some View {
        content.environment(\.motion, MotionPolicy(reduce: forced || reduceMotion || UIAccessibility.prefersCrossFadeTransitions))
    }
}
