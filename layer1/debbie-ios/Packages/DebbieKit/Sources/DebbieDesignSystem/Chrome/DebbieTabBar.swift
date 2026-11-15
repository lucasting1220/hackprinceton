import SwiftUI

/// One tab in the bottom bar (CRAFT.md §5 DebbieTabBar).
public struct DebbieTab: Identifiable, Hashable, Sendable {
    public let id: String
    public let title: String
    public let icon: String
    public let filledIcon: String
    public let effect: DIconEffect
    /// The centre tab shows Debbie's face instead of an icon (owner direction 16:16; D-030).
    public let avatar: Bool
    /// Voice Control names: the visible title first, then synonyms (note 16 R6).
    public let inputLabels: [String]
    public init(id: String, title: String, icon: String, filledIcon: String, effect: DIconEffect, avatar: Bool = false, inputLabels: [String] = []) {
        self.id = id; self.title = title; self.icon = icon; self.filledIcon = filledIcon; self.effect = effect
        self.avatar = avatar; self.inputLabels = inputLabels
    }
}

/// The floating bottom tab bar (replaces TabView's bar; CRAFT.md §2.5 D1–D3, §3.3 T17, §5; research note 16 R2–R10).
/// It's Liquid Glass, so it lives in Chrome/.
/// - Selected: filled glyph, `accent.text` glyph and label, a `mint.tint` highlight, and the selected trait. The highlight
///   moves on `Motion.tabSelect` (0.30 s, no bounce) and retargets mid-flight. Under Reduce Motion it fades in place.
/// - A tap plays the icon's own effect. There's no haptic: Apple's tab bars play none (§4.2, note 16 R10).
/// - VoiceOver: a tab bar container, so each item reads its label, "tab", "n of 5" and "selected".
/// - Labels never hide and clamp at xLarge. The Large Content Viewer shows them at accessibility sizes.
/// - `badges`: unanswered urgent alerts on a tab (note 16 R5), a red oval with the count.
public struct DebbieTabBar: View {
    let tabs: [DebbieTab]
    @Binding var selection: String
    let badges: [String: Int]
    let onReselect: (String) -> Void
    @Namespace private var highlight
    @State private var plays: [String: Int] = [:]
    @Environment(\.motion) private var motion
    @Environment(\.colorSchemeContrast) private var contrast

    /// `onReselect`: tapping the current tab returns it to its root, as system tab bars do (note 16 R5).
    public init(tabs: [DebbieTab], selection: Binding<String>, badges: [String: Int] = [:], onReselect: @escaping (String) -> Void = { _ in }) {
        self.tabs = tabs
        self._selection = selection
        self.badges = badges
        self.onReselect = onReselect
    }

    public var body: some View {
        HStack(spacing: 0) {
            ForEach(tabs) { tab in item(tab) }
        }
        .padding(Space.s4)
        // The glass is a background layer: wrapping the buttons in it hid them from the accessibility tree.
        .background { Capsule().fill(.clear).glassEffect(.regular.interactive(), in: Capsule()) }
        .overlay {
            if contrast == .increased { Capsule().strokeBorder(Color.dBorder, lineWidth: 1.5) }
        }
        .padding(.horizontal, Space.s20)
        .padding(.bottom, Space.s4)
        .accessibilityElement(children: .contain)
        .accessibilityAddTraits(.isTabBar)
    }

    private func item(_ tab: DebbieTab) -> some View {
        let selected = tab.id == selection
        let badge = badges[tab.id] ?? 0
        return Button {
            plays[tab.id, default: 0] += 1
            guard !selected else { onReselect(tab.id); return }
            withAnimation(motion.tabSelect) { selection = tab.id }
        } label: {
            VStack(spacing: 0) {
                glyph(tab, selected: selected)
                    .frame(minHeight: Size.tabIcon)
                    .overlay(alignment: .topTrailing) {
                        if badge > 0 {
                            Text(badge > 9 ? "9+" : "\(badge)")
                                .font(DType.tabLabel.monospacedDigit()).foregroundStyle(Color.dOnUrgent)
                                .padding(.horizontal, Space.s4)
                                .frame(minWidth: Space.s16 + Space.s4)
                                .background(Color.dUrgentFill, in: Capsule())
                                .offset(x: Space.s12, y: -Space.s4)
                                .accessibilityHidden(true)
                        }
                    }
                Text(tab.title).font(DType.tabLabel).lineLimit(1).minimumScaleFactor(0.8)
            }
            .dynamicTypeSize(...DynamicTypeSize.xLarge)
            .foregroundStyle(selected ? Color.dAccent : Color.dText2)
            .frame(maxWidth: .infinity, minHeight: Size.tabItem)
            .background { selectionHighlight(selected) }
            .contentShape(.interaction, Capsule())
        }
        .buttonStyle(DebbieTabItemStyle())
        .accessibilityLabel(tab.title)
        .accessibilityValue(badge > 0 ? "\(badge) urgent \(badge == 1 ? "alert" : "alerts")" : "")
        .accessibilityAddTraits(selected ? .isSelected : [])
        .accessibilityInputLabels([tab.title] + tab.inputLabels)
        .accessibilityShowsLargeContentViewer {
            if !tab.avatar { DIcon(tab.icon) }
            Text(tab.title)
        }
        .accessibilityIdentifier("tab.\(tab.id)")
    }

    @ViewBuilder private func glyph(_ tab: DebbieTab, selected: Bool) -> some View {
        if tab.avatar {
            DebbieAvatar(size: Size.tabAvatar)
                .overlay { Circle().strokeBorder(selected ? Color.dAccent : Color.dBorder.opacity(0.35), lineWidth: selected ? 2 : 1) }
        } else {
            DAnimatedIcon(tab.icon, filled: tab.filledIcon, effect: tab.effect, trigger: plays[tab.id, default: 0], active: selected)
                .font(DType.tabIcon)
        }
    }

    @ViewBuilder private func selectionHighlight(_ selected: Bool) -> some View {
        if selected {
            if motion.reduce {
                Capsule().fill(Color.dMintTint).transition(Motion.swap)
            } else {
                Capsule().fill(Color.dMintTint).matchedGeometryEffect(id: "highlight", in: highlight)
            }
        }
    }
}

/// A tab item gives slightly under the finger, as a system bar item does (0.97; note 16 R8).
struct DebbieTabItemStyle: ButtonStyle {
    @Environment(\.motion) private var motion
    func makeBody(configuration: Configuration) -> some View {
        configuration.label
            .scaleEffect(configuration.isPressed && !motion.reduce ? 0.97 : 1)
            .animation(motion.press, value: configuration.isPressed)
    }
}
