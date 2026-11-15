import SwiftUI
import UIKit

// Debbie's own components (CRAFT.md §5). Each replaces a system control's default look.

// MARK: Buttons

public enum DButtonVariant: Sendable { case primary, secondary, quiet, destructive, urgent }
public enum DButtonSize: Sendable { case compact, regular, large, prominent, resident
    var minHeight: CGFloat { switch self { case .compact: Size.minTarget; case .regular: Size.regular; case .large: Size.large; case .prominent: Size.prominent; case .resident: Size.resident } }
    var fullWidth: Bool { self == .large || self == .prominent || self == .resident }
}

/// Replaces bordered / borderedProminent / borderless / glass button styles (CRAFT.md §5).
public struct DebbieButtonStyle: ButtonStyle {
    let variant: DButtonVariant
    let size: DButtonSize
    let loading: Bool
    @Environment(\.isEnabled) private var isEnabled
    @Environment(\.motion) private var motion
    @Environment(\.accessibilityShowBorders) private var showBorders
    @Environment(\.colorSchemeContrast) private var contrast

    public init(_ variant: DButtonVariant = .primary, size: DButtonSize = .large, loading: Bool = false) {
        self.variant = variant; self.size = size; self.loading = loading
    }

    public func makeBody(configuration: Configuration) -> some View {
        let pressed = configuration.isPressed
        HStack(spacing: Space.s8) {
            if loading { DebbieSpinner().accessibilityHidden(true) }
            configuration.label
        }
        .font(size == .resident ? DType.residentLabel : DType.button)
        .multilineTextAlignment(.center)
        .foregroundStyle(foreground)
        .padding(.horizontal, Space.s20)
        .padding(.vertical, Space.s12)
        .frame(maxWidth: size.fullWidth ? .infinity : nil, minHeight: size.minHeight)
        .background(background(pressed: pressed), in: Capsule())
        .overlay {
            if needsBorder { Capsule().strokeBorder(Color.dBorder, lineWidth: 1.5) }
        }
        .contentShape(Capsule())
        .scaleEffect(pressed && !motion.reduce ? 0.97 : 1)
        .animation(motion.press, value: pressed)
    }

    private var needsBorder: Bool {
        switch variant {
        case .quiet, .secondary: showBorders || contrast == .increased || variant == .secondary
        default: contrast == .increased
        }
    }

    private var foreground: Color {
        guard isEnabled else { return .dLabelDisabled }
        switch variant {
        case .primary: return .dOnMint
        case .urgent: return .dOnUrgent
        case .destructive: return .dUrgentText
        case .secondary, .quiet: return .dAccent
        }
    }

    private func background(pressed: Bool) -> Color {
        guard isEnabled else { return .dFillDisabled }
        switch variant {
        case .primary: return pressed ? .dMintPressed : .dMint
        case .urgent: return pressed ? .dUrgentPressed : .dUrgentFill
        case .secondary, .destructive: return pressed ? .dSurfacePressed : .dSurface
        case .quiet: return pressed ? .dSurfacePressed : .clear
        }
    }
}

public extension ButtonStyle where Self == DebbieButtonStyle {
    static func debbie(_ variant: DButtonVariant = .primary, size: DButtonSize = .large, loading: Bool = false) -> DebbieButtonStyle {
        DebbieButtonStyle(variant, size: size, loading: loading)
    }
}

/// Indeterminate spinner (replaces ProgressView's circular style; CRAFT.md §5).
public struct DebbieSpinner: View {
    @State private var on = false
    @Environment(\.motion) private var motion
    public init() {}
    public var body: some View {
        Circle().trim(from: 0, to: 0.7)
            .stroke(style: StrokeStyle(lineWidth: 2.5, lineCap: .round))
            .frame(width: 18, height: 18)
            .rotationEffect(.degrees(on ? 360 : 0))
            .animation(Motion.spin, value: on)
            .onAppear { on = true }
    }
}

// MARK: Navigation chrome (replaces the system navigation bar; lead decision X44)

public struct DebbieTopBar<Trailing: View>: View {
    let title: String
    let onBack: (() -> Void)?
    let trailing: Trailing
    public init(_ title: String, onBack: (() -> Void)? = nil, @ViewBuilder trailing: () -> Trailing) {
        self.title = title; self.onBack = onBack; self.trailing = trailing()
    }
    @Environment(\.dynamicTypeSize) private var typeSize

    public var body: some View {
        if typeSize.isAccessibilitySize {
            // CRAFT.md §7: at accessibility sizes text wraps instead of truncating, so the title takes its own row.
            VStack(alignment: .leading, spacing: Space.s4) {
                if onBack != nil || Trailing.self != EmptyView.self {
                    HStack(spacing: Space.s8) { backButton; Spacer(minLength: Space.s8); trailing }
                        .frame(minHeight: Size.minTarget)
                }
                titleText.fixedSize(horizontal: false, vertical: true)
            }
            .padding(.horizontal, Space.s16)
            .padding(.vertical, Space.s4)
        } else {
            HStack(spacing: Space.s8) {
                backButton
                titleText
                Spacer(minLength: Space.s8)
                trailing
            }
            .padding(.horizontal, Space.s16)
            .frame(minHeight: Size.minTarget)
            .padding(.vertical, Space.s4)
        }
    }

    @ViewBuilder private var backButton: some View {
        if let onBack {
            Button(action: onBack) { DIcon("back", label: "Back").font(DType.headline) }
                .buttonStyle(DebbieIconButtonStyle())
        }
    }

    private var titleText: some View {
        Text(title).font(DType.headline).foregroundStyle(Color.dText).accessibilityAddTraits(.isHeader)
    }
}

public extension DebbieTopBar where Trailing == EmptyView {
    init(_ title: String, onBack: (() -> Void)? = nil) { self.init(title, onBack: onBack) { EmptyView() } }
}

/// A tab's page: a large title with corner buttons above scrolling content (CRAFT.md §5 DebbieTabScreen).
/// - The header stays put as a safe-area bar, so content scrolls under it with the system's scroll-edge effect.
/// - At accessibility sizes the header scrolls with the content instead, so it never fills the screen.
public struct DebbieTabScreen<Trailing: View, Content: View>: View {
    let title: String?
    let subtitle: String?
    let trailing: Trailing
    let content: Content
    @Environment(\.dynamicTypeSize) private var typeSize

    /// `title` nil: the screen's first content is its title (Home's status headline), and the top row names the place.
    public init(_ title: String?, subtitle: String? = nil, @ViewBuilder trailing: () -> Trailing, @ViewBuilder content: () -> Content) {
        self.title = title; self.subtitle = subtitle; self.trailing = trailing(); self.content = content()
    }

    public var body: some View {
        Group {
            if typeSize.isAccessibilitySize {
                ScrollView {
                    VStack(alignment: .leading, spacing: Space.s16) {
                        header
                        content
                    }
                    .padding(.horizontal, Space.s20)
                    .padding(.bottom, Space.s24)
                }
            } else {
                ScrollView {
                    VStack(alignment: .leading, spacing: Space.s16) { content }
                        .padding(.horizontal, Space.s20)
                        .padding(.top, Space.s8)
                        .padding(.bottom, Space.s24)
                }
                .safeAreaBar(edge: .top) { header.padding(.horizontal, Space.s20) }
            }
        }
        .scrollBounceBehavior(.basedOnSize)
        .background(Color.dCanvas.ignoresSafeArea())
    }

    @ViewBuilder private var header: some View {
        if title == nil {
            // At accessibility sizes the corner buttons take their own row, so the place's name gets the full width and
            // never breaks inside a word ("De-mo Ho-me" beside the badge and gear on SE at AX5).
            if typeSize.isAccessibilitySize {
                VStack(alignment: .leading, spacing: Space.s8) {
                    HStack { Spacer(minLength: 0); trailing }
                    if let subtitle {
                        Text(subtitle).font(DType.headline).foregroundStyle(Color.dText)
                            .fixedSize(horizontal: false, vertical: true)
                    }
                }
                .padding(.vertical, Space.s8)
            } else {
                HStack(alignment: .center, spacing: Space.s12) {
                    if let subtitle {
                        Text(subtitle).font(DType.headline).foregroundStyle(Color.dText)
                            .fixedSize(horizontal: false, vertical: true)
                    }
                    Spacer(minLength: Space.s8)
                    trailing
                }
                .padding(.top, Space.s8)
                .padding(.bottom, Space.s8)
            }
        } else if typeSize.isAccessibilitySize {
            stacked.padding(.top, Space.s8)
        } else {
            // The title sits beside the corner buttons when it fits on one line. Otherwise the buttons take their
            // own row above it, as in a system large-title bar, rather than wrapping the title.
            ViewThatFits(in: .horizontal) {
                HStack(alignment: .center, spacing: Space.s12) {
                    titleBlock(singleLine: true)
                    Spacer(minLength: Space.s8)
                    trailing
                }
                stacked
            }
            .padding(.top, Space.s8)
            .padding(.bottom, Space.s8)
        }
    }

    private var stacked: some View {
        VStack(alignment: .leading, spacing: Space.s4) {
            HStack(spacing: Space.s8) { Spacer(minLength: 0); trailing }
            titleBlock(singleLine: false)
        }
    }

    private func titleBlock(singleLine: Bool) -> some View {
        VStack(alignment: .leading, spacing: 0) {
            Text(title ?? "").font(DType.hero).foregroundStyle(Color.dText)
                .lineLimit(singleLine ? 1 : nil)
                .fixedSize(horizontal: singleLine, vertical: true)
                .accessibilityAddTraits(.isHeader)
            if let subtitle {
                Text(subtitle).font(DType.secondary).foregroundStyle(Color.dText2)
                    .fixedSize(horizontal: false, vertical: true)
            }
        }
    }
}

/// A button label with its own animated icon in front of the words (CRAFT.md §3.5, §5 DButtonLabel).
/// The icon plays when `plays` changes. The spoken name stays the visible title.
public struct DButtonLabel: View {
    let title: String
    let icon: String
    let effect: DIconEffect
    let plays: Int
    public init(_ title: String, icon: String, effect: DIconEffect = .pop, plays: Int) {
        self.title = title; self.icon = icon; self.effect = effect; self.plays = plays
    }
    public var body: some View {
        HStack(spacing: Space.s8) {
            DAnimatedIcon(icon, effect: effect, trigger: plays)
            Text(title)
        }
    }
}

/// Icon-only button with a 44×44 hit region (CRAFT.md §5 DebbieIconButton).
public struct DebbieIconButtonStyle: ButtonStyle {
    @Environment(\.motion) private var motion
    @Environment(\.accessibilityShowBorders) private var showBorders
    public init() {}
    public func makeBody(configuration: Configuration) -> some View {
        configuration.label
            .foregroundStyle(Color.dAccent)
            .frame(minWidth: Size.minTarget, minHeight: Size.minTarget)
            .background(configuration.isPressed ? Color.dSurfacePressed : .clear, in: Circle())
            .overlay { if showBorders { Circle().strokeBorder(Color.dBorder, lineWidth: 1.5) } }
            .contentShape(Circle())
            .animation(motion.press, value: configuration.isPressed)
    }
}

/// Sheet header with a Close button (replaces system sheet chrome; CRAFT.md §5).
public struct DebbieSheetHeader: View {
    let title: String
    let onClose: () -> Void
    public init(_ title: String, onClose: @escaping () -> Void) { self.title = title; self.onClose = onClose }
    public var body: some View {
        // Close sits on the leading edge, as on iOS 26 sheets (note 16 R12); the title follows it.
        HStack(spacing: Space.s8) {
            Button(action: onClose) { DIcon("close", label: "Close").font(DType.headline) }.buttonStyle(DebbieIconButtonStyle())
            Text(title).font(DType.title).foregroundStyle(Color.dText).accessibilityAddTraits(.isHeader)
                .fixedSize(horizontal: false, vertical: true)
            Spacer(minLength: 0)
        }
        .padding(.horizontal, Space.s20)
        .padding(.top, Space.s16)
    }
}

// MARK: Containers

public struct DCard<Content: View>: View {
    let tint: Color
    let content: Content
    @Environment(\.colorSchemeContrast) private var contrast
    public init(tint: Color = .dSurface, @ViewBuilder content: () -> Content) { self.tint = tint; self.content = content() }
    public var body: some View {
        content
            .padding(Space.s16)
            .frame(maxWidth: .infinity, alignment: .leading)
            .background(tint, in: RoundedRectangle(cornerRadius: Radius.r20, style: .continuous))
            .overlay {
                if contrast == .increased { RoundedRectangle(cornerRadius: Radius.r20, style: .continuous).strokeBorder(Color.dBorder, lineWidth: 1.5) }
            }
    }
}

// MARK: Status

public enum DStatusTone: Sendable { case healthy, attention, urgent, unknown, info
    var icon: String { switch self { case .healthy: "status-healthy"; case .attention: "status-attention"; case .urgent: "status-urgent"; case .unknown: "status-unknown"; case .info: "sync" } }
    var color: Color { switch self { case .healthy: .dOK; case .attention: .dCautionText; case .urgent: .dUrgentText; case .unknown, .info: .dText2 } }
}

/// How a status row lays out (CRAFT.md §5 DStatusRow).
public enum DStatusRowStyle: Sendable {
    /// Label, value and detail on three lines (the original layout).
    case labelled
    /// The value says it all ("Connected to home"), with its age below. The label is spoken but not shown.
    case state
    /// One line, like a Settings row: "Kitchen laptop ……… Reporting". It stacks when it doesn't fit.
    case inline
}

/// One status row: glyph + words + age; never colour alone (CRAFT.md C7).
public struct DStatusRow: View {
    let label: String
    let value: String
    let detail: String?
    let tone: DStatusTone
    let style: DStatusRowStyle
    public init(label: String, value: String, detail: String?, tone: DStatusTone, style: DStatusRowStyle = .labelled) {
        self.label = label; self.value = value; self.detail = detail; self.tone = tone; self.style = style
    }
    public var body: some View {
        Group {
            switch style {
            case .labelled: labelled
            case .state:
                HStack(alignment: .firstTextBaseline, spacing: Space.s12) {
                    glyph
                    VStack(alignment: .leading, spacing: 0) {
                        Text(value).font(DType.bodyStrong).foregroundStyle(Color.dText)
                        if let detail { Text(detail).font(DType.secondary).foregroundStyle(Color.dText2) }
                    }
                    Spacer(minLength: 0)
                }
            case .inline:
                ViewThatFits(in: .horizontal) {
                    HStack(alignment: .firstTextBaseline, spacing: Space.s12) {
                        glyph
                        VStack(alignment: .leading, spacing: 0) {
                            Text(label).font(DType.body).foregroundStyle(Color.dText).lineLimit(1)
                            if let detail { Text(detail).font(DType.secondary).foregroundStyle(Color.dText2).lineLimit(1) }
                        }
                        Spacer(minLength: Space.s8)
                        Text(value).font(DType.secondary.weight(.semibold)).foregroundStyle(valueColor).lineLimit(1)
                    }
                    labelled
                }
            }
        }
        .frame(minHeight: Size.minTarget)
        .accessibilityElement(children: .ignore)
        .accessibilityLabel([label, value, detail].compactMap { $0 }.joined(separator: ", "))
    }

    private var glyph: some View { DIcon(tone.icon).font(DType.headline).foregroundStyle(tone.color) }

    /// A problem is spoken in its own text colour; a healthy value stays quiet.
    private var valueColor: Color {
        switch tone { case .attention: .dCautionText; case .urgent: .dUrgentText; default: .dText2 }
    }

    private var labelled: some View {
        HStack(alignment: .firstTextBaseline, spacing: Space.s12) {
            glyph
            VStack(alignment: .leading, spacing: Space.s4) {
                Text(label).font(DType.secondary).foregroundStyle(Color.dText2)
                Text(value).font(DType.bodyStrong).foregroundStyle(Color.dText)
                if let detail { Text(detail).font(DType.secondary).foregroundStyle(Color.dText2) }
            }
            Spacer(minLength: 0)
        }
    }
}

// MARK: Live view

/// The camera-is-live bar: opaque, word + glyph + place + countdown (CRAFT.md §5 LiveBar, X16).
public struct DebbieLiveBar: View {
    let place: String
    let endsAt: Date?
    public init(place: String, endsAt: Date?) { self.place = place; self.endsAt = endsAt }
    @Environment(\.dynamicTypeSize) private var typeSize

    public var body: some View {
        let stacked = typeSize.isAccessibilitySize
        let layout = stacked ? AnyLayout(VStackLayout(alignment: .leading, spacing: Space.s4)) : AnyLayout(HStackLayout(spacing: Space.s12))
        layout {
            HStack(spacing: Space.s8) {
                DIcon("live").font(DType.headline).foregroundStyle(Color.dOnLive)
                Text("LIVE").font(DType.headline).foregroundStyle(Color.dOnLive).fixedSize()
            }
            Text(place).font(DType.body).foregroundStyle(Color.dOnLive).lineLimit(stacked ? nil : 1)
            if !stacked { Spacer(minLength: Space.s8) }
            if let endsAt {
                Text(timerInterval: Date.now...max(endsAt, .now), countsDown: true)
                    .font(DType.bodyStrong.monospacedDigit()).foregroundStyle(Color.dOnLive).fixedSize()
            }
        }
        .frame(maxWidth: .infinity, alignment: .leading)
        .padding(.horizontal, Space.s16)
        .padding(.vertical, stacked ? Space.s8 : 0)
        .frame(minHeight: Size.minTarget + Space.s8)
        .background(Color.dLiveFill, in: RoundedRectangle(cornerRadius: Radius.r12, style: .continuous))
        .overlay(RoundedRectangle(cornerRadius: Radius.r12, style: .continuous).strokeBorder(Color.white, lineWidth: 1.5))
        .accessibilityElement(children: .combine)
        .accessibilityLabel("Live view on. \(place).")
        .accessibilityAddTraits(.updatesFrequently)
    }
}

// MARK: Empty, error, priming

public struct DEmptyState: View {
    let art: String?
    let title: String
    let message: String
    public init(art: String? = nil, title: String, message: String) { self.art = art; self.title = title; self.message = message }
    public var body: some View {
        VStack(spacing: Space.s12) {
            if let art { DArt(art).frame(maxHeight: 140).accessibilityHidden(true) }
            Text(title).font(DType.title).foregroundStyle(Color.dText).multilineTextAlignment(.center)
            Text(message).font(DType.body).foregroundStyle(Color.dText2).multilineTextAlignment(.center)
        }
        .padding(Space.s24)
        .frame(maxWidth: .infinity)
    }
}

/// Permission priming: explain, then exactly one button (CRAFT.md §5 PrimingScreen).
public struct DPriming: View {
    let icon: String
    let title: String
    let message: String
    let persona: Bool
    let action: () -> Void
    /// `persona`: Debbie asks, with the topic as a badge on her portrait (onboarding, owner direction 16:16).
    public init(icon: String, title: String, message: String, persona: Bool = false, action: @escaping () -> Void) {
        self.icon = icon; self.title = title; self.message = message; self.persona = persona; self.action = action
    }
    public var body: some View {
        ScrollView {
            VStack(spacing: Space.s24) {
                if persona { DebbieWithBadge(icon: icon) } else { DIcon(icon).font(DType.hero).foregroundStyle(Color.dAccent) }
                Text(title).font(DType.title).foregroundStyle(Color.dText).multilineTextAlignment(.center).accessibilityAddTraits(.isHeader)
                    .fixedSize(horizontal: false, vertical: true)
                Text(message).font(DType.body).foregroundStyle(Color.dText2).multilineTextAlignment(.center)
                    .fixedSize(horizontal: false, vertical: true)
            }
            .padding(Space.s20)
            .frame(maxWidth: .infinity)
        }
        .defaultScrollAnchor(.center, for: .alignment)
        .scrollBounceBehavior(.basedOnSize)
        .debbiePinnedAction { Button("Continue", action: action).buttonStyle(.debbie(.primary, size: .large)) }
    }
}

public extension View {
    /// A screen's primary action, pinned above the home indicator so it stays reachable at every text size
    /// while the content scrolls (CRAFT.md §1 one job per screen; §7 Dynamic Type).
    func debbiePinnedAction<A: View>(@ViewBuilder _ action: () -> A) -> some View {
        safeAreaInset(edge: .bottom) {
            VStack(spacing: Space.s8) { action() }
                .padding(.horizontal, Space.s20)
                .padding(.vertical, Space.s12)
                .background(Color.dCanvas)
        }
    }
}

/// The 4-digit pairing code, spoken digit by digit (CRAFT.md §5 DebbieCodeDisplay).
public struct DCodeDisplay: View {
    let code: String
    public init(_ code: String) { self.code = code }
    public var body: some View {
        HStack(spacing: Space.s12) {
            ForEach(Array(code.enumerated()), id: \.offset) { _, ch in
                Text(String(ch)).font(DType.metric).foregroundStyle(Color.dText)
                    .frame(minWidth: Size.large, minHeight: Size.prominent)
                    .background(Color.dSunken, in: RoundedRectangle(cornerRadius: Radius.r12, style: .continuous))
            }
        }
        .accessibilityElement(children: .ignore)
        .accessibilityLabel("Pairing code \(code.map(String.init).joined(separator: " "))")
    }
}

/// A large selectable card (replaces segmented controls; CRAFT.md §5 DebbieChoiceCard).
public struct DChoiceCard: View {
    let title: String
    let detail: String
    let icon: String
    let selected: Bool
    let action: () -> Void
    @Environment(\.motion) private var motion
    public init(title: String, detail: String, icon: String, selected: Bool, action: @escaping () -> Void) {
        self.title = title; self.detail = detail; self.icon = icon; self.selected = selected; self.action = action
    }
    public var body: some View {
        Button(action: action) {
            HStack(alignment: .firstTextBaseline, spacing: Space.s12) {
                DIcon(icon).font(DType.headline).foregroundStyle(Color.dAccent)
                VStack(alignment: .leading, spacing: Space.s4) {
                    Text(title).font(DType.headline).foregroundStyle(Color.dText)
                    Text(detail).font(DType.secondary).foregroundStyle(Color.dText2)
                }
                Spacer(minLength: 0)
            }
            .padding(Space.s16)
            .frame(maxWidth: .infinity, minHeight: Size.large, alignment: .leading)
            .background(selected ? Color.dMintTint : Color.dSurface, in: RoundedRectangle(cornerRadius: Radius.r20, style: .continuous))
            .overlay(RoundedRectangle(cornerRadius: Radius.r20, style: .continuous).strokeBorder(selected ? Color.dAccent : Color.dBorder, lineWidth: selected ? 2.5 : 1))
            .animation(motion.state, value: selected)
        }
        .buttonStyle(.plain)
        .accessibilityAddTraits(selected ? .isSelected : [])
    }
}

/// Row switch style (replaces `.switch`; CRAFT.md §5 DebbieSwitchStyle).
public struct DebbieSwitchStyle: ToggleStyle {
    @Environment(\.motion) private var motion
    public init() {}
    public func makeBody(configuration: Configuration) -> some View {
        Button { configuration.isOn.toggle() } label: {
            HStack(spacing: Space.s12) {
                configuration.label.font(DType.body).foregroundStyle(Color.dText)
                Spacer(minLength: Space.s8)
                ZStack(alignment: configuration.isOn ? .trailing : .leading) {
                    Capsule().fill(configuration.isOn ? Color.dMint : Color.dSunken).frame(width: 52, height: 32)
                        .overlay(Capsule().strokeBorder(Color.dBorder, lineWidth: 1))
                    Circle().fill(configuration.isOn ? Color.dOnMint : Color.dText2).frame(width: 24, height: 24).padding(4)
                }
                .animation(motion.state, value: configuration.isOn)
                .accessibilityHidden(true)
            }
            .frame(minHeight: Size.regular)
            .contentShape(Rectangle())
        }
        .buttonStyle(.plain)
        .accessibilityRepresentation { Toggle(isOn: configuration.$isOn) { configuration.label } }
    }
}

/// A text field with a persistent label (replaces default TextField chrome; CRAFT.md §5).
public struct DTextField: View {
    let label: String
    let placeholder: String
    @Binding var text: String
    let error: String?
    @FocusState private var focused: Bool
    public init(_ label: String, placeholder: String, text: Binding<String>, error: String? = nil) {
        self.label = label; self.placeholder = placeholder; self._text = text; self.error = error
    }
    public var body: some View {
        VStack(alignment: .leading, spacing: Space.s8) {
            Text(label).font(DType.bodyStrong).foregroundStyle(Color.dText)
            TextField(placeholder, text: $text)
                .font(DType.body).foregroundStyle(Color.dText)
                .focused($focused)
                .autocorrectionDisabled()
                .submitLabel(.done)
                .padding(.horizontal, Space.s16)
                .frame(minHeight: Size.regular)
                .background(Color.dSunken, in: RoundedRectangle(cornerRadius: Radius.r12, style: .continuous))
                .overlay(RoundedRectangle(cornerRadius: Radius.r12, style: .continuous)
                    .strokeBorder(error != nil ? Color.dUrgentText : (focused ? Color.dFocus : Color.dBorder), lineWidth: focused || error != nil ? 2 : 1))
                .accessibilityLabel(label)
            if let error {
                HStack(spacing: Space.s4) { DIcon("status-attention").foregroundStyle(Color.dUrgentText); Text(error) }
                    .font(DType.secondary).foregroundStyle(Color.dUrgentText)
            }
        }
    }
}

/// "Demo — sample data" (DEMO_HOME.md).
/// A large numeric reading (the resident's heart rate) that still scales with Dynamic Type (CRAFT.md §7).
public struct DReading: View {
    let value: String
    @ScaledMetric(relativeTo: .largeTitle) private var size: CGFloat = 64
    public init(_ value: String) { self.value = value }
    public var body: some View {
        Text(value).font(.system(size: size, weight: .bold, design: .rounded).monospacedDigit())
            .foregroundStyle(Color.dText).contentTransition(Motion.numeric)
    }
}

public struct DDemoBadge: View {
    public init() {}
    public var body: some View {
        // One short word so it never wraps in a top bar; the spoken label carries the full meaning (DEMO_HOME.md).
        Text("Demo").font(DType.secondary.weight(.semibold)).foregroundStyle(Color.dText)
            .lineLimit(1).fixedSize()
            .padding(.horizontal, Space.s12).frame(minHeight: Size.minTarget - Space.s12)
            .background(Color.dMintTint, in: Capsule())
            .overlay(Capsule().strokeBorder(Color.dAccent, lineWidth: 1))
            .accessibilityLabel("Demo mode. Sample data.")
    }
}

/// Confirmation as a Debbie sheet, not a system action sheet (D-012).
public struct DConfirmSheet: View {
    let title: String
    let message: String
    let actionTitle: String
    let destructive: Bool
    let onConfirm: () -> Void
    let onCancel: () -> Void
    public init(title: String, message: String, actionTitle: String, destructive: Bool, onConfirm: @escaping () -> Void, onCancel: @escaping () -> Void) {
        self.title = title; self.message = message; self.actionTitle = actionTitle; self.destructive = destructive
        self.onConfirm = onConfirm; self.onCancel = onCancel
    }
    public var body: some View {
        VStack(alignment: .leading, spacing: Space.s16) {
            DebbieSheetHeader(title, onClose: onCancel).padding(.horizontal, -Space.s20)
            Text(message).font(DType.body).foregroundStyle(Color.dText2)
            Button(actionTitle, action: onConfirm).buttonStyle(.debbie(destructive ? .urgent : .primary, size: .large))
            Button("Cancel", action: onCancel).buttonStyle(.debbie(.quiet, size: .regular)).frame(maxWidth: .infinity)
        }
        .padding(Space.s20)
        .presentationDetents([.medium])
        .presentationDragIndicator(.visible)
    }
}
