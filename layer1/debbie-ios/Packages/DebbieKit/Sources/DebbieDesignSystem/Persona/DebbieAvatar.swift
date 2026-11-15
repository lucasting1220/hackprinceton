import SwiftUI
import UIKit

/// Debbie's face (owner direction 16:16; D-030; CRAFT.md §3.6, §5).
/// - Layers: nine vector layers, exported by Design/scripts/export-avatar.sh from Design/avatar/src/debbie.svg and stacked on
///   one 200×200 canvas. The head turns around the neck at (100, 150).
/// - Idle: she breathes (≤ 1 % scale over 4.8 s), tilts her head (±2° over 7.3 s) and blinks once (≈ 240 ms, every 2.4–6.4 s).
///   It is subtle on purpose; a face that moves too much reads as nervous.
/// - Reduce Motion: she stays still with her eyes open.
/// - Missing art: while the layers don't exist yet, she falls back to the mint "D" mark.
public struct DebbieAvatar: View {
    let size: CGFloat
    let lively: Bool
    @Environment(\.motion) private var motion
    @Environment(\.scenePhase) private var scenePhase

    /// Idle runs only at the guide and hero sizes (≥ 64 pt). The tab and header avatars hold still: their travel would be
    /// under a point, and it's peripheral motion beside text (note 17 R24).
    public init(size: CGFloat, lively: Bool? = nil) {
        self.size = size
        self.lively = lively ?? (size >= Size.avatarGuide)
    }

    public var body: some View {
        Group {
            if Self.hasLayers {
                if motion.reduce || !lively {
                    face(IdlePose.rest)
                } else {
                    TimelineView(.animation(minimumInterval: 1.0 / 30.0, paused: scenePhase != .active)) { context in
                        face(IdlePose(at: context.date))
                    }
                }
            } else {
                fallback
            }
        }
        .frame(width: size, height: size)
        .background(Color.dMintTint, in: Circle())
        .clipShape(Circle())
        .accessibilityElement(children: .ignore)
        .accessibilityLabel("Debbie")
        .accessibilityAddTraits(.isImage)
    }

    private func face(_ pose: IdlePose) -> some View {
        ZStack {
            layer("body").scaleEffect(pose.breath, anchor: .bottom)
            ZStack {
                layer("hair-back")
                layer("head")
                layer("cheeks")
                eyes(pose.eyes)
                layer("brows")
                layer("mouth")
                layer("hair-front")
            }
            .rotationEffect(.degrees(pose.tilt), anchor: UnitPoint(x: 0.5, y: 0.75))
            .offset(y: pose.lift * size)
        }
    }

    private func layer(_ name: String) -> some View {
        Image("Debbie-\(name)", bundle: .module).resizable().scaledToFit()
    }

    /// The eyes close through a 40 % squash, which reads as a real blink rather than a switch (note 17 R23).
    /// They squash toward the closed lids' line (y 94.3 on the 200-unit canvas), so the dark shape doesn't hop
    /// between the squash and closed frames (the export script measures the jump).
    @ViewBuilder private func eyes(_ state: IdlePose.Eyes) -> some View {
        if state == .closed {
            layer("eyes-closed")
        } else {
            layer("eyes-open").scaleEffect(x: 1, y: state == .squash ? 0.4 : 1, anchor: UnitPoint(x: 0.5, y: 0.471))
        }
    }

    private var fallback: some View {
        DArt("Brand-mark").foregroundStyle(Color.dOnMint)
            .padding(size * 0.24)
            .background(Color.dMint)
    }

    /// True once the avatar's layers are in the asset catalog.
    static let hasLayers: Bool = UIImage(named: "Debbie-head", in: .module, with: nil) != nil
}

/// Debbie's idle pose at a moment in time (CRAFT.md §3.6). It is a pure function of time, so every avatar on screen
/// breathes and blinks in step, and nothing needs a timer.
struct IdlePose: Equatable {
    enum Eyes: Equatable { case open, squash, closed }
    var breath: CGFloat = 1
    var tilt: Double = 0
    var lift: CGFloat = 0
    var eyes: Eyes = .open
    static let rest = IdlePose()

    init(breath: CGFloat = 1, tilt: Double = 0, lift: CGFloat = 0, eyes: Eyes = .open) {
        self.breath = breath; self.tilt = tilt; self.lift = lift; self.eyes = eyes
    }

    init(at date: Date) {
        let t = date.timeIntervalSinceReferenceDate
        let breathPhase = sin(2 * .pi * t / 4.8)
        breath = 1 + 0.008 * CGFloat(breathPhase)
        lift = -0.002 * CGFloat(breathPhase)
        tilt = 2.0 * sin(2 * .pi * t / 7.3)
        eyes = Self.eyes(at: t)
    }

    /// One blink in every 4.4 s window, about 240 ms long: squash for 40 ms, closed for ≈ 133 ms, squash for ≈ 67 ms as
    /// they reopen, so the eyes close faster than they open (note 17 R23).
    /// - Starts sit in the first 2.0 s of each window, so two blinks are always at least 2.4 s apart.
    /// - One blink at a time: no double blinks (owner, 17:24: they looked fast and uncanny).
    static func eyes(at t: TimeInterval) -> Eyes {
        let window = 4.4
        let index = (t / window).rounded(.down)
        let start = index * window + hash(index) * 2.0
        // The squash lasts 40 ms, a little longer than one 30 fps frame, so it is always drawn.
        func phase(from s: Double) -> Eyes? {
            let d = t - s
            if d < 0 || d >= 0.24 { return nil }
            if d < 0.04 { return .squash }
            if d < 0.173 { return .closed }
            return .squash
        }
        return phase(from: start) ?? .open
    }

    private static func hash(_ x: Double) -> Double {
        let v = sin(x * 12.9898) * 43_758.5453
        return v - v.rounded(.down)
    }
}

/// Debbie saying one line of onboarding (owner direction 16:16). Her face sits beside a speech bubble.
/// At accessibility sizes the bubble moves below her, so neither shrinks.
public struct DebbieGuide: View {
    let line: String
    let detail: String?
    @Environment(\.dynamicTypeSize) private var typeSize

    public init(_ line: String, detail: String? = nil) { self.line = line; self.detail = detail }

    public var body: some View {
        let layout = typeSize.isAccessibilitySize
            ? AnyLayout(VStackLayout(alignment: .leading, spacing: Space.s12))
            : AnyLayout(HStackLayout(alignment: .top, spacing: Space.s12))
        layout {
            DebbieAvatar(size: Size.avatarGuide)
            VStack(alignment: .leading, spacing: Space.s4) {
                Text(line).font(DType.title).foregroundStyle(Color.dText)
                    .fixedSize(horizontal: false, vertical: true)
                    .accessibilityAddTraits(.isHeader)
                if let detail {
                    Text(detail).font(DType.body).foregroundStyle(Color.dText2).fixedSize(horizontal: false, vertical: true)
                }
            }
            .padding(Space.s16)
            .frame(maxWidth: .infinity, alignment: .leading)
            .background(Color.dSurface, in: RoundedRectangle(cornerRadius: Radius.r20, style: .continuous))
        }
    }
}

/// Debbie with a small badge for what she is asking about: a permission, or a moment such as pairing.
public struct DebbieWithBadge: View {
    let icon: String
    @ScaledMetric(relativeTo: .title) private var badge: CGFloat = 36
    public init(icon: String) { self.icon = icon }
    public var body: some View {
        DebbieAvatar(size: Size.avatarHero * 0.75)
            .overlay(alignment: .bottomTrailing) {
                DIcon(icon).font(DType.headline).foregroundStyle(Color.dOnMint)
                    .frame(width: badge, height: badge)
                    .background(Color.dMint, in: Circle())
                    .overlay(Circle().strokeBorder(Color.dCanvas, lineWidth: 3))
                    .accessibilityHidden(true)
            }
    }
}
