import SwiftUI

// Debbie's chat components (owner direction 16:16; CRAFT.md §5; research note 17).
// Each replaces a system look. The composer replaces TextField chrome; the bubbles and chips have no system equivalent.

/// One message in the conversation. Debbie's sit on the left on the card colour; yours sit on the right on mint tint.
/// Mint fill is kept for Send, the screen's one primary (CRAFT C4; note 17 R16). Speakers differ by side and words.
public struct DChatBubble: View {
    let text: String
    let fromDebbie: Bool
    @Environment(\.colorSchemeContrast) private var contrast
    public init(text: String, fromDebbie: Bool) { self.text = text; self.fromDebbie = fromDebbie }

    public var body: some View {
        HStack(alignment: .bottom, spacing: Space.s8) {
            if !fromDebbie { Spacer(minLength: Space.s48) }
            Text(text)
                .font(DType.body)
                .foregroundStyle(Color.dText)
                .fixedSize(horizontal: false, vertical: true)
                .textSelection(.enabled)
                .padding(.horizontal, Space.s16)
                .padding(.vertical, Space.s12)
                .background(fromDebbie ? Color.dSurface : Color.dMintTint,
                            in: RoundedRectangle(cornerRadius: Radius.r20, style: .continuous))
                .overlay {
                    if contrast == .increased { RoundedRectangle(cornerRadius: Radius.r20, style: .continuous).strokeBorder(Color.dBorder, lineWidth: 1.5) }
                }
                .accessibilityLabel("\(fromDebbie ? "Debbie" : "You"): \(text)")
            if fromDebbie { Spacer(minLength: Space.s48) }
        }
        .frame(maxWidth: .infinity, alignment: fromDebbie ? .leading : .trailing)
    }
}

/// "Debbie is writing": three dots that pulse in turn. It's a `working` effect (M8), so it repeats only while she
/// writes, and under Reduce Motion it holds still with the words.
public struct DTypingIndicator: View {
    let words: String?
    @Environment(\.motion) private var motion
    /// `words`: shown beside the dots, e.g. "Summarizing the latest from home…" after 3 s (note 17 R6).
    public init(words: String? = nil) { self.words = words }

    public var body: some View {
        HStack(spacing: Space.s8) {
            if motion.reduce {
                dots(lit: nil)
            } else {
                PhaseAnimator([0, 1, 2]) { lit in dots(lit: lit) } animation: { _ in Motion.iconSettle }
            }
            if let text = words ?? (motion.reduce ? "Debbie is writing…" : nil) {
                Text(text).font(DType.secondary).foregroundStyle(Color.dText2).fixedSize(horizontal: false, vertical: true)
            }
        }
        .padding(.horizontal, Space.s16)
        .padding(.vertical, Space.s12)
        .background(Color.dSurface, in: RoundedRectangle(cornerRadius: Radius.r20, style: .continuous))
        .accessibilityElement(children: .ignore)
        .accessibilityLabel(words ?? "Debbie is writing")
        .accessibilityAddTraits(.updatesFrequently)
    }

    private func dots(lit: Int?) -> some View {
        HStack(spacing: Space.s4) {
            ForEach(0..<3, id: \.self) { i in
                Circle()
                    .fill(Color.dText2)
                    .frame(width: Space.s8, height: Space.s8)
                    .opacity(lit == nil || lit == i ? 1 : 0.35)
                    .scaleEffect(lit == i ? 1.25 : 1)
            }
        }
    }
}

/// A suggested question. It sends as soon as it's tapped.
public struct DSuggestionChip: View {
    let title: String
    let action: () -> Void
    public init(_ title: String, action: @escaping () -> Void) { self.title = title; self.action = action }

    public var body: some View {
        Button(action: action) {
            Text(title)
                .font(DType.secondary.weight(.semibold))
                .foregroundStyle(Color.dAccent)
                .multilineTextAlignment(.leading)
                .fixedSize(horizontal: false, vertical: true)
                .padding(.horizontal, Space.s16)
                .padding(.vertical, Space.s8)
                .frame(minHeight: Size.minTarget)
                .overlay(Capsule().strokeBorder(Color.dBorder, lineWidth: 1))
        }
        .buttonStyle(DebbieChipStyle())
    }
}

/// Lays chips out left to right and wraps them onto new lines, so none sits off screen and each can grow to several
/// lines at the largest text sizes (replaces a sideways scroll whose last chip was hidden on the smallest iPhone).
public struct DFlow: Layout {
    let spacing: CGFloat
    public init(spacing: CGFloat) { self.spacing = spacing }

    /// One row-breaking pass, shared by measuring and placing, so a chip can never wrap below the height the layout
    /// reported (two passes adding the same widths in a different order can disagree by a rounding error).
    private func rows(_ subviews: Subviews, width: CGFloat) -> [[(view: LayoutSubview, size: CGSize)]] {
        var rows: [[(view: LayoutSubview, size: CGSize)]] = [[]]
        var x: CGFloat = 0
        for view in subviews {
            let size = view.sizeThatFits(ProposedViewSize(width: width, height: nil))
            if x > 0, x + size.width > width + 0.5 { rows.append([]); x = 0 }
            rows[rows.count - 1].append((view, size))
            x += size.width + spacing
        }
        return rows
    }

    public func sizeThatFits(proposal: ProposedViewSize, subviews: Subviews, cache: inout ()) -> CGSize {
        let width = proposal.width ?? .infinity
        let rows = rows(subviews, width: width)
        let widest = rows.map { row in row.reduce(0) { $0 + $1.size.width } + spacing * CGFloat(max(0, row.count - 1)) }.max() ?? 0
        let height = rows.reduce(0) { $0 + ($1.map(\.size.height).max() ?? 0) } + spacing * CGFloat(max(0, rows.count - 1))
        return CGSize(width: min(widest, width), height: height)
    }

    public func placeSubviews(in bounds: CGRect, proposal: ProposedViewSize, subviews: Subviews, cache: inout ()) {
        var y = bounds.minY
        for row in rows(subviews, width: proposal.width ?? bounds.width) {
            var x = bounds.minX
            for item in row {
                item.view.place(at: CGPoint(x: x, y: y), proposal: ProposedViewSize(width: min(item.size.width, bounds.width), height: item.size.height))
                x += item.size.width + spacing
            }
            y += (row.map(\.size.height).max() ?? 0) + spacing
        }
    }
}

struct DebbieChipStyle: ButtonStyle {
    @Environment(\.motion) private var motion
    @Environment(\.accessibilityShowBorders) private var showBorders
    @Environment(\.colorSchemeContrast) private var contrast
    func makeBody(configuration: Configuration) -> some View {
        configuration.label
            .overlay {
                if showBorders || contrast == .increased { Capsule().strokeBorder(Color.dAccent, lineWidth: 1.5) }
            }
            .contentShape(Capsule())
            .scaleEffect(configuration.isPressed && !motion.reduce ? 0.95 : 1)
            .animation(motion.press, value: configuration.isPressed)
    }
}

/// The message field and the send button (replaces TextField chrome and a system send button).
/// The arrow pops as a message leaves.
public struct DChatComposer: View {
    @Binding var text: String
    let placeholder: String
    let busy: Bool
    let focus: FocusState<Bool>.Binding
    let onSend: () -> Void
    let onStop: () -> Void
    @State private var sends = 0
    @Environment(\.motion) private var motion

    /// Send appears only when there's text, as in Messages. While Debbie writes it becomes Stop, in the same place
    /// (note 17 R14, R17).
    public init(text: Binding<String>, placeholder: String, busy: Bool, focus: FocusState<Bool>.Binding,
                onSend: @escaping () -> Void, onStop: @escaping () -> Void) {
        self._text = text; self.placeholder = placeholder; self.busy = busy; self.focus = focus; self.onSend = onSend; self.onStop = onStop
    }

    private var canSend: Bool { !busy && !text.trimmingCharacters(in: .whitespacesAndNewlines).isEmpty }

    public var body: some View {
        HStack(alignment: .bottom, spacing: Space.s8) {
            // The field grows to four lines, so a long question or a large text size is never clipped. Return sends,
            // as the Send key's label says, rather than starting a new line.
            TextField(text: $text, prompt: Text(placeholder).foregroundStyle(Color.dText2), axis: .vertical) { Text(placeholder) }
                .lineLimit(1...4)
                .font(DType.body)
                .foregroundStyle(Color.dText)
                .focused(focus)
                .submitLabel(.send)
                .onSubmit(send)
                .onChange(of: text) { old, now in
                    guard now.contains("\n") else { return }
                    // A typed Return adds exactly one character; pasted text with line breaks just gets spaces.
                    let typedReturn = now.count == old.count + 1 && !old.contains("\n")
                    text = now.replacingOccurrences(of: "\n", with: " ").trimmingCharacters(in: .whitespaces)
                    if typedReturn { send() }
                }
                .padding(.horizontal, Space.s16)
                .padding(.vertical, Space.s8)
                .frame(minHeight: Size.regular)
                .background(Color.dSurface, in: RoundedRectangle(cornerRadius: Size.regular / 2, style: .continuous))
                .overlay(RoundedRectangle(cornerRadius: Size.regular / 2, style: .continuous)
                    .strokeBorder(focus.wrappedValue ? Color.dFocus : Color.dBorder, lineWidth: focus.wrappedValue ? 2 : 1))
                .accessibilityLabel("Message to Debbie")
                .accessibilityIdentifier("debbieMessage")
            if busy {
                Button(action: onStop) { DIcon("stop", label: "Stop").font(DType.headline) }
                    .buttonStyle(DebbieSendButtonStyle(enabled: true))
                    .accessibilityIdentifier("stopDebbie")
                    .transition(Motion.swap)
            } else if canSend {
                Button(action: send) {
                    DAnimatedIcon("send", effect: .pop, trigger: sends, label: "Send").font(DType.headline)
                }
                .buttonStyle(DebbieSendButtonStyle(enabled: true))
                .accessibilityIdentifier("sendToDebbie")
                .transition(Motion.swap)
            }
        }
        .animation(motion.state, value: busy)
        .animation(motion.state, value: canSend)
    }

    private func send() {
        guard canSend else { return }
        sends += 1
        onSend()
    }
}

/// A round mint send button, at least 48 pt.
struct DebbieSendButtonStyle: ButtonStyle {
    let enabled: Bool
    @Environment(\.motion) private var motion
    func makeBody(configuration: Configuration) -> some View {
        configuration.label
            .foregroundStyle(enabled ? Color.dOnMint : Color.dLabelDisabled)
            .frame(minWidth: Size.regular, minHeight: Size.regular)
            .background(enabled ? (configuration.isPressed ? Color.dMintPressed : Color.dMint) : Color.dFillDisabled, in: Circle())
            .contentShape(Circle())
            .scaleEffect(configuration.isPressed && !motion.reduce ? 0.92 : 1)
            .animation(motion.press, value: configuration.isPressed)
    }
}
