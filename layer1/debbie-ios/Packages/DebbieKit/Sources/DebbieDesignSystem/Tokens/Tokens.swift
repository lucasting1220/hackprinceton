import SwiftUI
import UIKit

// Design tokens (CRAFT.md §2). The only place visual values are written down.

/// Semantic colours (generated values in Colors.generated.swift; CRAFT.md §2.1).
public extension Color {
    static let dCanvas = Color(uiColor: DebbiePalette.bgCanvas)
    static let dSurface = Color(uiColor: DebbiePalette.bgSurface)
    static let dSunken = Color(uiColor: DebbiePalette.bgSunken)
    static let dText = Color(uiColor: DebbiePalette.textPrimary)
    static let dText2 = Color(uiColor: DebbiePalette.textSecondary)
    static let dText3 = Color(uiColor: DebbiePalette.textTertiary)
    static let dMint = Color(uiColor: DebbiePalette.mintFill)
    static let dMintPressed = Color(uiColor: DebbiePalette.mintFillPressed)
    static let dMintTint = Color(uiColor: DebbiePalette.mintTint)
    static let dOnMint = Color(uiColor: DebbiePalette.textOnMint)
    static let dAccent = Color(uiColor: DebbiePalette.accentText)
    static let dOK = Color(uiColor: DebbiePalette.okIcon)
    static let dCautionFill = Color(uiColor: DebbiePalette.cautionFill)
    static let dCautionTint = Color(uiColor: DebbiePalette.cautionTint)
    static let dCautionText = Color(uiColor: DebbiePalette.cautionText)
    static let dOnCaution = Color(uiColor: DebbiePalette.textOnCaution)
    static let dUrgentFill = Color(uiColor: DebbiePalette.urgentFill)
    static let dUrgentPressed = Color(uiColor: DebbiePalette.urgentFillPressed)
    static let dOnUrgent = Color(uiColor: DebbiePalette.textOnUrgent)
    static let dUrgentBorder = Color(uiColor: DebbiePalette.urgentBorder)
    static let dUrgentTint = Color(uiColor: DebbiePalette.urgentTint)
    static let dUrgentText = Color(uiColor: DebbiePalette.urgentText)
    static let dLiveFill = Color(uiColor: DebbiePalette.liveFill)
    static let dOnLive = Color(uiColor: DebbiePalette.textOnLive)
    static let dLiveScrim = Color(uiColor: DebbiePalette.liveScrim)
    static let dSeparator = Color(uiColor: DebbiePalette.separator)
    static let dBorder = Color(uiColor: DebbiePalette.borderControl)
    static let dSurfacePressed = Color(uiColor: DebbiePalette.surfacePressed)
    static let dFillDisabled = Color(uiColor: DebbiePalette.fillDisabled)
    static let dLabelDisabled = Color(uiColor: DebbiePalette.labelDisabled)
    static let dFocus = Color(uiColor: DebbiePalette.focusRing)
}

/// Type roles (CRAFT.md §2.2). Every `Text` uses one of these.
public enum DType {
    public static let hero = Font.system(.largeTitle, design: .rounded).weight(.bold)
    public static let title = Font.system(.title2, design: .rounded).weight(.bold)
    public static let headline = Font.system(.headline)
    public static let body = Font.system(.body)
    public static let bodyStrong = Font.system(.body).weight(.semibold)
    public static let button = Font.system(.body).weight(.semibold)
    public static let secondary = Font.system(.subheadline)
    public static let footnote = Font.system(.footnote)
    public static let metric = Font.system(.largeTitle, design: .rounded).weight(.semibold).monospacedDigit()
    public static let residentBody = Font.system(.title3)
    public static let residentLabel = Font.system(.title3).weight(.semibold)
    /// Tab bar: icons size with text up to xxxLarge; labels hide at accessibility sizes, and the Large Content Viewer
    /// shows them instead (HIG Tab bars; research note 16).
    public static let tabIcon = Font.system(.title3).weight(.medium)
    public static let tabLabel = Font.system(.footnote).weight(.semibold)
    /// The corner glass button's glyph (22–24 pt at the default size; note 16 R11).
    public static let cornerIcon = Font.system(.title3).weight(.medium)
}

/// Spacing scale (CRAFT.md §2.3).
public nonisolated enum Space {
    public static let s4: CGFloat = 4, s8: CGFloat = 8, s12: CGFloat = 12, s16: CGFloat = 16
    public static let s20: CGFloat = 20, s24: CGFloat = 24, s32: CGFloat = 32, s48: CGFloat = 48
}

/// Corner radii (CRAFT.md §2.4).
public nonisolated enum Radius {
    public static let r12: CGFloat = 12, r20: CGFloat = 20, r28: CGFloat = 28
    /// The brand tile behind the mark at the hero size: the app icon's corner ratio (22.4 %) on 148 pt.
    public static let brandTile: CGFloat = 33
}

/// Target size tiers (CRAFT.md §2.3, lead decision X21).
public nonisolated enum Size {
    public static let minTarget: CGFloat = 44, regular: CGFloat = 48, large: CGFloat = 56, prominent: CGFloat = 64, resident: CGFloat = 96
    // Fixed artwork and camera frames (CRAFT.md §2 logo rules B1–B6; the scanner keeps a usable target at any text size).
    public static let brandMark: CGFloat = 64, brandGlyph: CGFloat = 36, brandWordmark: CGFloat = 32, welcomeArt: CGFloat = 150
    /// The wordmark's width at `brandWordmark` height (its art is 332 × 90).
    public static let brandWordmarkWidth: CGFloat = 118
    public static let scannerMax: CGFloat = 360, scannerMin: CGFloat = 200, scannerSheet: CGFloat = 280
    // Tab bar: each item is at least 52 pt tall (above the 44 pt minimum); the icon sits in a 28 pt box.
    public static let tabItem: CGFloat = 52, tabIcon: CGFloat = 28, tabAvatar: CGFloat = 30
    // Debbie's face: the chat header, the onboarding guide and the welcome hero.
    public static let avatarSmall: CGFloat = 44, avatarGuide: CGFloat = 64, avatarHero: CGFloat = 148
    // Feature art on a tab (the Live tab's camera): large but bounded at every text size.
    public static let featureIcon: CGFloat = 72
}

/// The design system's resource bundle (custom symbols and art).
public enum DebbieAssets {
    public static let bundle = Bundle.module
}

/// A custom symbol from Symbols.xcassets (never an SF Symbol; CRAFT.md §2.6).
public struct DIcon: View {
    let name: String
    let label: String?
    public init(_ name: String, label: String? = nil) { self.name = name; self.label = label }
    public var body: some View {
        if let label {
            Image("dx.\(name)", bundle: .module, label: Text(label))
        } else {
            Image(decorative: "dx.\(name)", bundle: .module)
        }
    }
}

/// Brand art and illustrations (Art.xcassets; CRAFT.md §2.7–§2.8).
public struct DArt: View {
    let name: String
    public init(_ name: String) { self.name = name }
    public var body: some View {
        Image(decorative: name, bundle: .module).resizable().scaledToFit()
    }
}
