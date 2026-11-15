import SwiftUI

/// A round glass button for a screen's top corner, such as Settings (CRAFT.md §5; research note 16 R11).
/// - It's Liquid Glass, like a system bar button, so it lives in Chrome/.
/// - The glyph is `text.primary` and plays its own effect on tap (the gear turns one tooth).
/// - It has no haptic, is never disabled, and clamps at xLarge, with the Large Content Viewer beyond.
public struct DebbieCornerButton: View {
    let icon: String
    let label: String
    let effect: DIconEffect
    let action: () -> Void
    @State private var plays = 0

    public init(icon: String, label: String, effect: DIconEffect, action: @escaping () -> Void) {
        self.icon = icon; self.label = label; self.effect = effect; self.action = action
    }

    public var body: some View {
        Button {
            plays += 1
            action()
        } label: {
            DAnimatedIcon(icon, effect: effect, trigger: plays, label: label).font(DType.cornerIcon)
        }
        .buttonStyle(DebbieCornerButtonStyle())
        .dynamicTypeSize(...DynamicTypeSize.xLarge)
        .accessibilityShowsLargeContentViewer { DIcon(icon); Text(label) }
    }
}

/// A 44 pt glass circle. It gives slightly when pressed and is outlined under Increase Contrast or Show Borders.
public struct DebbieCornerButtonStyle: ButtonStyle {
    @Environment(\.motion) private var motion
    @Environment(\.accessibilityShowBorders) private var showBorders
    @Environment(\.colorSchemeContrast) private var contrast
    public init() {}
    public func makeBody(configuration: Configuration) -> some View {
        configuration.label
            .foregroundStyle(Color.dText)
            .frame(width: Size.minTarget, height: Size.minTarget)
            .background { Circle().fill(.clear).glassEffect(.regular.interactive(), in: Circle()) }
            .overlay {
                if showBorders || contrast == .increased { Circle().strokeBorder(Color.dBorder, lineWidth: 1.5) }
            }
            .contentShape(Circle())
            .scaleEffect(configuration.isPressed && !motion.reduce ? 0.97 : 1)
            .animation(motion.press, value: configuration.isPressed)
    }
}
