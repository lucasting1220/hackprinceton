import SwiftUI

// The launch intro (owner direction 20:5x; CRAFT.md §3.7; D-033): a heart monitor's line beats, the third beat rises
// into the brand mark, the mark sets and the mint tile blooms behind it, and the lockup glides into the welcome screen.
//
// Everything below the views is a pure function of time and geometry (as `IdlePose` is), so each frame is reproducible,
// `IntroShapeTests` can check the whole timeline, and a tap can jump the clock. Timings live in `Motion.Intro`.

// MARK: - The mark

/// The brand mark in its own 100-unit box (Design/brand/mark.svg): a "D" with its stem on the left and a round window
/// at (49, 50), radius 11. The intro strokes the very path it later fills, so outline and mark can never drift apart.
public nonisolated enum MarkGeometry {
    public static let box: CGFloat = 100
    /// The mark fills 52 % of its tile (24 % padding each side), as in the app icon and `DebbieAvatar`'s fallback.
    public static let scaleInTile: CGFloat = 0.52
    public static let stemX: CGFloat = 20
    public static let windowCentre = CGPoint(x: 49, y: 50)
    public static let windowRadius: CGFloat = 11
    /// The pen's lead-in rounds from the baseline into the stem over this radius and enters the outline at `entry`.
    public static let filletRadius: CGFloat = 10
    public static let entry = CGPoint(x: stemX, y: 50 - filletRadius)

    /// The mark's 100-unit box inside a tile.
    public static func markBox(inTile tile: CGRect) -> CGRect {
        let side = tile.width * scaleInTile
        return CGRect(x: tile.midX - side / 2, y: tile.midY - side / 2, width: side, height: side)
    }

    static func point(_ p: CGPoint, in box: CGRect) -> CGPoint {
        let k = box.width / Self.box
        return CGPoint(x: box.minX + p.x * k, y: box.minY + p.y * k)
    }

    /// The outline as the pen draws it: from the entry up the stem, across the top, around the bowl, back along the
    /// bottom and up the stem to the entry. One closed subpath.
    public static func outline(in box: CGRect) -> Path {
        let k = box.width / Self.box
        func pt(_ x: CGFloat, _ y: CGFloat) -> CGPoint { CGPoint(x: box.minX + x * k, y: box.minY + y * k) }
        var p = Path()
        p.move(to: pt(entry.x, entry.y))
        p.addLine(to: pt(20, 26))
        p.addQuadCurve(to: pt(30, 16), control: pt(20, 16))
        p.addLine(to: pt(52, 16))
        p.addRelativeArc(center: pt(52, 50), radius: 34 * k, startAngle: .degrees(-90), delta: .degrees(180))
        p.addLine(to: pt(30, 84))
        p.addQuadCurve(to: pt(20, 74), control: pt(20, 84))
        p.addLine(to: pt(entry.x, entry.y))
        p.closeSubpath()
        return p
    }

    /// The solid mark with its window; fill it with the even-odd rule.
    public static func fill(in box: CGRect) -> Path {
        var p = outline(in: box)
        let k = box.width / Self.box
        p.addEllipse(in: CGRect(x: box.minX + (windowCentre.x - windowRadius) * k, y: box.minY + (windowCentre.y - windowRadius) * k,
                                width: 2 * windowRadius * k, height: 2 * windowRadius * k))
        return p
    }

    /// The lead-in from the baseline into the stem: a quarter turn that starts level and ends heading up, at `entry`.
    public static func fillet(in box: CGRect) -> Path {
        let k = box.width / Self.box
        var p = Path()
        p.addRelativeArc(center: point(CGPoint(x: stemX - filletRadius, y: 50 - filletRadius), in: box), radius: filletRadius * k,
                         startAngle: .degrees(90), delta: .degrees(-90))
        return p
    }
}

/// The mark, solid, fitted to any tile.
public struct MarkFillShape: Shape {
    public init() {}
    public nonisolated func path(in rect: CGRect) -> Path { MarkGeometry.fill(in: MarkGeometry.markBox(inTile: rect)) }
}

/// The mark's outline as far as the pen has drawn it (0…1), fitted to any tile.
public struct MarkOutlineShape: Shape {
    public var progress: CGFloat
    public init(progress: CGFloat) { self.progress = progress }
    public nonisolated func path(in rect: CGRect) -> Path {
        MarkGeometry.outline(in: MarkGeometry.markBox(inTile: rect)).trimmedPath(from: 0, to: max(0, min(1, progress)))
    }
}

// MARK: - The heartbeat

/// A resting sinus rhythm drawn on moving paper. `u` is a paper position in points; the result is the line's height
/// above the baseline in points. The shapes are the real ones: a small round P wave, a narrow Q dip, the tall sharp R,
/// the S dip, a flat ST segment and a broad T wave, at the proportions of a 67-beat minute.
public nonisolated enum ECGWave {
    /// Paper positions of the two complete beats' R peaks (the paper already carries `preroll` seconds of line at t = 0).
    public static var rPeaks: [CGFloat] {
        let v = Motion.Intro.paperSpeed
        let first = Motion.Intro.firstBeat + Motion.Intro.preroll
        return [CGFloat(first) * v, CGFloat(first + Motion.Intro.beatInterval) * v]
    }

    /// Where the paper stops. The third beat's upstroke is the mark's stem, so it is drawn by the pen, not the paper.
    public static var paperStop: CGFloat {
        let v = Motion.Intro.paperSpeed
        return v * CGFloat(Motion.Intro.flowEnds + Motion.Intro.preroll) + v * CGFloat(Motion.Intro.stemEntry - Motion.Intro.flowEnds) / 2
    }

    public static func y(at u: CGFloat) -> CGFloat {
        let v = Motion.Intro.paperSpeed
        var y: CGFloat = 0
        for r in rPeaks { y += beat(u - r) }
        y += bump(u - (paperStop - 0.17 * v), halfWidth: 0.045 * v, amplitude: 6)   // the third beat's P wave
        return y
    }

    /// One beat, by distance `d` (in points of paper) from its R peak.
    static func beat(_ d: CGFloat) -> CGFloat {
        let v = Motion.Intro.paperSpeed
        return bump(d + 0.17 * v, halfWidth: 0.045 * v, amplitude: 6)
            - bump(d + 0.028 * v, halfWidth: 0.012 * v, amplitude: 4)
            + spike(d, halfWidth: 0.022 * v, amplitude: 58)
            - bump(d - 0.035 * v, halfWidth: 0.018 * v, amplitude: 12)
            + bump(d - 0.27 * v, halfWidth: 0.09 * v, amplitude: 11)
    }

    /// A raised cosine: round, and exactly zero outside its half-width.
    static func bump(_ d: CGFloat, halfWidth w: CGFloat, amplitude a: CGFloat) -> CGFloat {
        abs(d) < w ? a * 0.5 * (1 + cos(.pi * d / w)) : 0
    }

    /// The R wave: straight sides with a barely softened tip.
    static func spike(_ d: CGFloat, halfWidth w: CGFloat, amplitude a: CGFloat) -> CGFloat {
        abs(d) < w ? a * pow(1 - abs(d) / w, 1.2) : 0
    }
}

// MARK: - The pose at an instant

/// `playing`: the clock runs. `handoff`: the lockup is gliding to its place. `arrive`: the words have come in beneath
/// it. `done`: the layout's own views have taken over.
public enum IntroStage: Equatable, Sendable {
    case playing, handoff, arrive, done
    /// Whether the welcome's words and buttons are on screen.
    public var showsContent: Bool { self == .arrive || self == .done }
}

/// Everything the intro shows at one instant, from the clock alone. Scales are factors, alphas 0…1, rises in points.
public nonisolated struct IntroPose: Equatable, Sendable {
    /// The paper position under the pen, in points.
    public var paper: CGFloat = 0
    /// How much of the lead-in fillet has been drawn (by its width, which is what the paper moves through).
    public var fillet: CGFloat = 0
    /// How much of the mark's outline the pen has drawn.
    public var outline: CGFloat = 0
    /// The old trace draining away from the left edge up to the stem.
    public var wipe: CGFloat = 0
    public var trailAlpha: CGFloat = 1
    public var strokeAlpha: CGFloat = 1
    public var strokeWidth: CGFloat = Motion.Intro.traceWidth
    public var fillAlpha: CGFloat = 0
    public var tileAlpha: CGFloat = 0
    public var tileScale: CGFloat = Motion.Intro.tileStartScale
    /// 1: the tile's centre still sits at the pen (on the stem); 0: in place behind the mark.
    public var tileShift: CGFloat = 1
    public var haloAlpha: CGFloat = 0
    public var haloScale: CGFloat = 1
    public var penAlpha: CGFloat = 0
    public var wordmarkAlpha: CGFloat = 0
    public var wordmarkRise: CGFloat = Motion.Intro.wordmarkRise
    /// Reduce Motion: the finished lockup fades in as one.
    public var lockupAlpha: CGFloat = 1

    public init() {}

    /// The pose when everything has arrived.
    public static let finished: IntroPose = {
        var p = IntroPose()
        p.paper = ECGWave.paperStop; p.fillet = 1; p.outline = 1; p.wipe = 1; p.trailAlpha = 0
        p.strokeAlpha = 0; p.strokeWidth = Motion.Intro.setWidth; p.fillAlpha = 1
        p.tileAlpha = 1; p.tileScale = 1; p.tileShift = 0
        p.haloAlpha = 0; p.penAlpha = 0
        p.wordmarkAlpha = 1; p.wordmarkRise = 0
        return p
    }()

    static func unit(_ x: Double) -> CGFloat { CGFloat(min(1, max(0, x))) }

    /// On the main actor only because it reads `Motion.settleSpring`; everything else here is plain arithmetic.
    @MainActor public static func at(_ t: TimeInterval, reduce: Bool) -> IntroPose {
        typealias I = Motion.Intro
        if reduce {
            // Nothing moves: the lockup fades in where it will stay.
            var p = IntroPose.finished
            p.lockupAlpha = CGFloat(I.easeInOut.value(at: Double(unit(t / 0.30))))
            return p
        }
        var p = IntroPose()
        let v = I.paperSpeed

        // The paper: already running in the first frame, steady under the two beats, then an even brake to a stop as the
        // third beat's P wave passes.
        if t <= I.flowEnds {
            p.paper = v * CGFloat(max(0, t) + I.preroll)
        } else if t < I.stemEntry {
            let q = CGFloat((t - I.flowEnds) / (I.stemEntry - I.flowEnds))
            p.paper = v * CGFloat(I.flowEnds + I.preroll) + v * CGFloat(I.stemEntry - I.flowEnds) * (q - q * q / 2)
        } else {
            p.paper = ECGWave.paperStop
        }
        let filletWidth = MarkGeometry.filletRadius * Size.avatarHero * MarkGeometry.scaleInTile / MarkGeometry.box
        p.fillet = t >= I.stemEntry ? 1 : unit(Double((p.paper - (ECGWave.paperStop - filletWidth)) / filletWidth))

        // The flourish: the pen draws the outline in one movement while the old trace drains away behind it.
        let f = unit((t - I.stemEntry) / I.flourish)
        p.outline = f > 0 ? CGFloat(I.flourishCurve.value(at: Double(f))) : 0
        p.wipe = CGFloat(I.easeInOut.value(at: Double(f)))
        p.trailAlpha = f < 1 ? 1 : 0

        // The set: the line thickens and pools into the solid mark.
        let s = CGFloat(I.easeOut.value(at: Double(unit((t - I.setBegins) / I.setDuration))))
        p.strokeAlpha = 1 - s
        p.strokeWidth = I.traceWidth + (I.setWidth - I.traceWidth) * s
        p.fillAlpha = s

        // The bloom: the pen's glow swells from the stem into the mint tile, with a soft settle (its small overshoot is
        // the lockup's one beat).
        let tb = t - I.setBegins
        if tb >= 0 {
            let bloom = Motion.settleSpring.value(fromValue: 0, toValue: 1, initialVelocity: 0, time: tb)
            p.tileScale = I.tileStartScale + (1 - I.tileStartScale) * bloom
            p.tileShift = 1 - bloom
            p.tileAlpha = unit(tb / I.tileFade)
            p.haloAlpha = I.glowAlpha * (1 - unit(tb / 0.15))
            p.haloScale = 1 + (I.glowSwell - 1) * unit(tb / 0.15)
        } else {
            p.haloAlpha = I.glowAlpha * unit(t / 0.15)
        }

        // The pen: there from the first frame, leaves as the outline closes.
        let closes = I.stemEntry + I.flourish
        p.penAlpha = t < closes ? unit(t / I.penFadeIn) : 1 - unit((t - closes) / I.penFadeOut)

        // The wordmark rises in beneath the tile.
        let w = CGFloat(I.easeOut.value(at: Double(unit((t - I.wordmarkAt) / I.wordmarkDuration))))
        p.wordmarkAlpha = w
        p.wordmarkRise = I.wordmarkRise * (1 - w)
        return p
    }
}

// MARK: - Where things sit on the screen

/// The intro's geometry on a screen of `size`: the lockup (tile over wordmark) in the middle, the pen on the mark's stem.
public nonisolated struct IntroLayout {
    public let size: CGSize
    public init(size: CGSize) { self.size = size }

    public var tile: CGRect {
        let side = Size.avatarHero
        let group = side + Space.s20 + Size.brandWordmark
        return CGRect(x: (size.width - side) / 2, y: (size.height - group) / 2, width: side, height: side)
    }
    public var wordmark: CGRect {
        CGRect(x: (size.width - Size.brandWordmarkWidth) / 2, y: tile.maxY + Space.s20, width: Size.brandWordmarkWidth, height: Size.brandWordmark)
    }
    public var markBox: CGRect { MarkGeometry.markBox(inTile: tile) }
    public var baseline: CGFloat { tile.midY }
    /// The pen's x: the mark's stem.
    public var penX: CGFloat { MarkGeometry.point(CGPoint(x: MarkGeometry.stemX, y: 50), in: markBox).x }
    var filletWidth: CGFloat { MarkGeometry.filletRadius * markBox.width / MarkGeometry.box }
    /// A beat's length of trace keeps full ink; older trace fades towards the edge, like phosphor.
    var persistence: CGFloat { CGFloat(Motion.Intro.beatInterval) * Motion.Intro.paperSpeed * Motion.Intro.persistenceBeats }

    /// The lead-in as drawn so far. While the paper still moves, the drawn part rides with it: the pen stays put.
    public func filletPath(_ pose: IntroPose) -> Path {
        guard pose.fillet > 0 else { return Path() }
        let byLength = asin(min(1, pose.fillet)) / (.pi / 2)
        return MarkGeometry.fillet(in: markBox).trimmedPath(from: 0, to: byLength)
            .applying(CGAffineTransform(translationX: filletWidth * (1 - pose.fillet), y: 0))
    }

    /// Where the pen is.
    public func pen(_ pose: IntroPose) -> CGPoint {
        if pose.outline > 0, let p = MarkGeometry.outline(in: markBox).trimmedPath(from: 0, to: pose.outline).currentPoint { return p }
        if pose.fillet > 0, let p = filletPath(pose).currentPoint { return p }
        return CGPoint(x: penX, y: baseline - ECGWave.y(at: pose.paper))
    }

    /// The trace behind the pen, from the left edge up to the lead-in. Samples sit on a grid fixed to the paper (not to
    /// the moving left edge), with every R peak as an explicit sample, so the spikes' heights never waver frame to frame.
    public func trail(_ pose: IntroPose) -> Path {
        var path = Path()
        let step: CGFloat = 0.5
        let end = min(pose.paper, ECGWave.paperStop - filletWidth)
        let start = max(0, pose.paper - penX - 8)
        guard end > start else { return path }
        var samples: [CGFloat] = [start]
        var u = (start / step).rounded(.up) * step
        while u < end { if u > start { samples.append(u) }; u += step }
        samples.append(end)
        samples.append(contentsOf: ECGWave.rPeaks.filter { $0 > start && $0 < end })
        samples.sort()
        path.move(to: point(samples[0], pose))
        for s in samples.dropFirst() { path.addLine(to: point(s, pose)) }
        return path
    }

    private func point(_ u: CGFloat, _ pose: IntroPose) -> CGPoint {
        CGPoint(x: penX - (pose.paper - u), y: baseline - ECGWave.y(at: u))
    }

    /// The trace's ink along the screen's width: phosphor persistence behind the pen, and the drain during the flourish.
    public func trailStops(_ pose: IntroPose, ink: Color) -> [Gradient.Stop] {
        let width = max(1, size.width)
        let wipeX = -8 + pose.wipe * (penX + 8)
        let soft = Motion.Intro.drainSoftness
        let floor = Motion.Intro.persistenceFloor
        func alpha(_ x: CGFloat) -> CGFloat {
            let age = floor + (1 - floor) * min(1, max(0, (x - (penX - persistence)) / persistence))
            let drained = min(1, max(0, (x - wipeX) / soft))
            return age * drained * pose.trailAlpha
        }
        let xs = Set([0, wipeX, wipeX + soft, penX - persistence, penX, width].map { min(width, max(0, $0)) }).sorted()
        return xs.map { Gradient.Stop(color: ink.opacity(Double(alpha($0))), location: $0 / width) }
    }
}

// MARK: - Views

/// The trace behind the pen, in a full-screen layer beneath the lockup.
public struct HeartbeatTraceLayer: View {
    let pose: IntroPose
    public init(pose: IntroPose) { self.pose = pose }
    public var body: some View {
        Canvas { context, size in
            let layout = IntroLayout(size: size)
            var path = layout.trail(pose)
            path.addPath(layout.filletPath(pose))
            let stops = layout.trailStops(pose, ink: Color.dAccent)
            context.stroke(path, with: .linearGradient(Gradient(stops: stops), startPoint: .zero, endPoint: CGPoint(x: size.width, y: 0)),
                           style: StrokeStyle(lineWidth: Motion.Intro.traceWidth, lineCap: .round, lineJoin: .round))
        }
        .accessibilityHidden(true)
    }
}

/// The pen's head and its mint glow, above everything.
public struct IntroPenLayer: View {
    let pose: IntroPose
    public init(pose: IntroPose) { self.pose = pose }
    public var body: some View {
        Canvas { context, size in
            let p = IntroLayout(size: size).pen(pose)
            if pose.haloAlpha > 0 {
                let r = Motion.Intro.glowRadius * pose.haloScale
                context.fill(Path(ellipseIn: CGRect(x: p.x - r, y: p.y - r, width: 2 * r, height: 2 * r)),
                             with: .radialGradient(Gradient(colors: [Color.dMint.opacity(Double(pose.haloAlpha)), Color.dMint.opacity(0)]),
                                                   center: p, startRadius: 0, endRadius: r))
            }
            if pose.penAlpha > 0 {
                let r = Motion.Intro.penRadius
                context.fill(Path(ellipseIn: CGRect(x: p.x - r, y: p.y - r, width: 2 * r, height: 2 * r)), with: .color(Color.dAccent.opacity(Double(pose.penAlpha))))
            }
        }
        .accessibilityHidden(true)
        .allowsHitTesting(false)
    }
}

/// The hero of the lockup: the mint tile, the mark (outline, then solid), and, once handed over, Debbie's face. It is
/// drawn once and follows whichever layout owns the hero slot (`matchedGeometryEffect`).
/// - Normally the tile's corners round into a circle as the mark shrinks away (`exit`) and Debbie arrives on `present`
///   a breath later, so the two are never both half-shown.
/// - Under Reduce Motion nothing changes shape: the tile fades out and Debbie, on her own circle, fades in.
public struct IntroLockupHero: View {
    let pose: IntroPose
    let face: Bool
    @Environment(\.motion) private var motion
    public init(pose: IntroPose, face: Bool) { self.pose = pose; self.face = face }

    public var body: some View {
        let side = Size.avatarHero
        let box = MarkGeometry.markBox(inTile: CGRect(x: 0, y: 0, width: side, height: side))
        let stemOffset = box.minX + MarkGeometry.stemX * box.width / MarkGeometry.box - side / 2
        let still = motion.reduce
        ZStack {
            RoundedRectangle(cornerRadius: face && !still ? side / 2 : Radius.brandTile, style: .continuous)
                .fill(face && !still ? Color.dMintTint : Color.dMint)
                .scaleEffect(pose.tileScale)
                .offset(x: pose.tileShift * stemOffset)
                .opacity(Double(pose.tileAlpha) * (face && still ? 0 : 1))
                .animation(motion.present, value: face)
            MarkFillShape()
                .fill(Color.dOnMint, style: FillStyle(eoFill: true))
                .scaleEffect(face && !still ? Motion.Intro.markLeaveScale : 1)
                .opacity(Double(pose.fillAlpha) * (face ? 0 : 1))
                .animation(motion.animation(Motion.exit), value: face)
            MarkOutlineShape(progress: pose.outline)
                .stroke(Color.dAccent, style: StrokeStyle(lineWidth: pose.strokeWidth, lineCap: .round, lineJoin: .round))
                .opacity(Double(pose.strokeAlpha) * (pose.outline > 0 ? 1 : 0) * (face ? 0 : 1))
                .animation(motion.animation(Motion.exit), value: face)
            if face {
                DebbieAvatar(size: side)
                    .transition(Motion.swap)
            }
        }
        .frame(width: side, height: side)
        .opacity(Double(pose.lockupAlpha))
        .animation(motion.present.delay(Motion.Intro.faceDelay), value: face)
        .accessibilityHidden(true)
        .allowsHitTesting(false)
    }
}

/// The wordmark of the lockup, likewise drawn once.
public struct IntroWordmark: View {
    let pose: IntroPose
    public init(pose: IntroPose) { self.pose = pose }
    public var body: some View {
        DArt("Brand-wordmark")
            .frame(width: Size.brandWordmarkWidth, height: Size.brandWordmark)
            .foregroundStyle(Color.dText)
            .offset(y: pose.wordmarkRise)
            .opacity(Double(pose.wordmarkAlpha * pose.lockupAlpha))
            .accessibilityHidden(true)
            .allowsHitTesting(false)
    }
}
