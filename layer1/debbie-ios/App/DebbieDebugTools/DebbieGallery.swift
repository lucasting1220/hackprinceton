#if DEBUG
import DebbieCareScreens
import DebbieCore
import DebbieDesignSystem
import SwiftUI

// The Debug-only component gallery for the designer kit (DesignerKit/08-components/components.md).
// - Every Debbie component on the white canvas, one captioned section each. A section is an accessibility container
//   named `gallery.<name>`, so GalleryUITests can scroll to it and capture it alone: renders/<name>.png, and
//   renders/increase-contrast/<name>.png on a run with Increase Contrast on.
// - DebbieApp shows it instead of RootView when the DEBBIE_GALLERY environment variable is set. The whole file is
//   Debug-only, and tools/ci/release-forbidden.txt fails a Release binary that mentions it.
// - Sample data only, at fixed times of day so renders don't change between runs. Nothing here plays a haptic.
// - Built only from design-system tokens and public components (tools/ci/lint.sh). Not shown, because they aren't public:
//   the chat's urgent row, the resident's heart card and the live-view panels. Not shown, because they don't exist in
//   code: CRAFT.md's DebbieStepIndicator, DebbieProgressStyle(.bar) and DebbieToggleCardStyle.

struct DebbieGallery: View {
    /// The live bar counts down from 4:12 when the gallery opens.
    @State private var liveEnds = Date.now.addingTimeInterval(4 * 60 + 12)

    /// The same Debug-only switch the screen gate uses for its Reduce Motion pass (RootView).
    private var forcedReduceMotion: Bool { ProcessInfo.processInfo.environment["DEBBIE_REDUCE_MOTION"] == "on" }

    var body: some View {
        ScrollView {
            // A plain stack, not a lazy one: every section exists from the start, so the UI test can find it.
            VStack(alignment: .leading, spacing: 0) {
                GalleryHeader()
                ButtonSections()
                FormSections()
                StatusSections()
                AlertSections()
                ChromeSections(liveEnds: liveEnds)
                ChatSections()
                PersonaSections()
                StateSections()
                IconSections()
                // Room to scroll the last section up to the top of the screen.
                Color.clear.frame(height: Size.scannerMax)
            }
        }
        .background(Color.dCanvas.ignoresSafeArea())
        .modifier(MotionPolicyReader(forced: forcedReduceMotion))
    }
}

// MARK: - Layout helpers

/// One captioned gallery section: a full-width accessibility container named `gallery.<name>`.
private struct GallerySection<Content: View>: View {
    let name: String
    let title: String
    let note: String
    let content: Content

    init(_ name: String, _ title: String, note: String, @ViewBuilder content: () -> Content) {
        self.name = name; self.title = title; self.note = note; self.content = content()
    }

    var body: some View {
        VStack(alignment: .leading, spacing: Space.s12) {
            VStack(alignment: .leading, spacing: Space.s4) {
                Text(title).font(DType.secondary.weight(.semibold)).foregroundStyle(Color.dText)
                    .fixedSize(horizontal: false, vertical: true)
                Text(note).font(DType.footnote).foregroundStyle(Color.dText2)
                    .fixedSize(horizontal: false, vertical: true)
            }
            content
        }
        .padding(.horizontal, Space.s20)
        .padding(.vertical, Space.s16)
        .frame(maxWidth: .infinity, alignment: .leading)
        .background(Color.dCanvas)
        .accessibilityElement(children: .contain)
        .accessibilityIdentifier("gallery.\(name)")
    }
}

/// A small grey label for a size or state.
private struct Caption: View {
    let text: String
    init(_ text: String) { self.text = text }
    var body: some View {
        Text(text).font(DType.footnote).foregroundStyle(Color.dText2).fixedSize(horizontal: false, vertical: true)
    }
}

/// A sample with its label above it.
private struct Labelled<Content: View>: View {
    let label: String
    let content: Content
    init(_ label: String, @ViewBuilder content: () -> Content) { self.label = label; self.content = content() }
    var body: some View {
        VStack(alignment: .leading, spacing: Space.s4) {
            Caption(label)
            content
        }
    }
}

/// A slice of a screen at the app's real width (edge to edge), for screen-level patterns. Its scroll views are held
/// still, so swiping over it scrolls the gallery. The hairline frame is the gallery's, not the app's.
private struct ScreenSlice<Content: View>: View {
    let height: CGFloat
    let content: Content
    init(height: CGFloat, @ViewBuilder content: () -> Content) { self.height = height; self.content = content() }
    var body: some View {
        content
            .frame(maxWidth: .infinity)
            .frame(height: height)
            .background(Color.dCanvas)
            .clipped()
            .scrollDisabled(true)
            .overlay { Rectangle().strokeBorder(Color.dSeparator, lineWidth: 1) }
            .padding(.horizontal, -Space.s20)
    }
}

/// The top of the gallery. Its top edge marks where the safe area starts, which the UI test measures.
private struct GalleryHeader: View {
    @Environment(\.colorSchemeContrast) private var contrast
    @Environment(\.dynamicTypeSize) private var typeSize
    @Environment(\.motion) private var motion

    var body: some View {
        VStack(alignment: .leading, spacing: Space.s4) {
            Text("Debbie components").font(DType.title).foregroundStyle(Color.dText).accessibilityAddTraits(.isHeader)
            Text("Debug-only gallery for DesignerKit/08-components. Sample data only. Text size \(String(describing: typeSize)) · Increase Contrast \(contrast == .increased ? "on" : "off") · Reduce Motion \(motion.reduce ? "on" : "off").")
                .font(DType.footnote).foregroundStyle(Color.dText2).fixedSize(horizontal: false, vertical: true)
        }
        .padding(.horizontal, Space.s20)
        .padding(.vertical, Space.s16)
        .frame(maxWidth: .infinity, alignment: .leading)
        .accessibilityElement(children: .contain)
        .accessibilityIdentifier("galleryHeader")
    }
}

// MARK: - Sample data

/// Obviously sample data. Times are fixed times of day (7:02 PM and so on), so renders stay the same between runs.
private enum Sample {
    static func today(_ hour: Int, _ minute: Int) -> Date {
        Calendar.current.date(bySettingHour: hour, minute: minute, second: 0, of: .now) ?? .now
    }

    static var noticed: Date { today(19, 2) }
    static var answered: Date { today(19, 4) }

    static var urgent: HubAlert {
        HubAlert(alertID: "sample-fall", kind: .fall, severity: .urgent, detectedAt: noticed, title: "Possible fall (sample)",
                 body: "Sample data: no answer in the living room.", receivedAt: noticed)
    }
    static var acknowledged: HubAlert {
        var alert = urgent
        alert.acknowledgedAt = answered
        return alert
    }
    static var falseAlarm: HubAlert {
        var alert = urgent
        alert.acknowledgedAt = answered
        alert.falseAlarm = true
        return alert
    }
    static var attention: HubAlert {
        HubAlert(alertID: "sample-still", kind: .noMovement, severity: .attention, detectedAt: noticed,
                 title: "No movement noticed (sample)", body: "Sample data: no movement in the kitchen for 2 hours.", receivedAt: noticed)
    }
    static var info: HubAlert {
        HubAlert(alertID: "sample-update", kind: .other, severity: .info, detectedAt: noticed,
                 title: "Kitchen laptop is reporting again (sample)", body: "Sample data.", receivedAt: noticed)
    }
    /// Noticed 6:48 PM, arrived 7:02 PM: 14 minutes late, as in the demo home.
    static var late: HubAlert {
        HubAlert(alertID: "sample-late", kind: .noMovement, severity: .attention, detectedAt: today(18, 48),
                 title: "No movement noticed (sample)", body: "Sample data: it reached the phone 14 minutes late.", receivedAt: noticed)
    }

    static func status(_ headline: HomeStatus.Headline) -> HomeStatus {
        let contact = today(19, 12)
        switch headline {
        case .monitoringOn:
            return HomeStatus(connection: .connected(lastContact: contact), monitoring: .on(updated: .now), languageModel: .available)
        case .monitoringLimited:
            return HomeStatus(connection: .connected(lastContact: contact),
                              monitoring: .limited(reason: "Kitchen laptop not reporting", since: today(19, 5)), languageModel: .unavailable)
        case .monitoringUnknown:
            return HomeStatus(connection: .connected(lastContact: contact), monitoring: .unknown(lastUpdate: noticed), languageModel: .unknown)
        case .cantConnect:
            return HomeStatus(connection: .cantConnect, monitoring: .unknown(lastUpdate: nil), languageModel: .unknown)
        case .cantReachHome:
            return HomeStatus(connection: .cantReachHome(lastContact: noticed), monitoring: .unknown(lastUpdate: noticed), languageModel: .unknown)
        case .removed:
            return HomeStatus(connection: .removed, monitoring: .unknown(lastUpdate: nil), languageModel: .unknown)
        }
    }

    static var reading: CareStatus {
        CareStatus(heartRateBPM: 72, heartRateAt: Date.now.addingTimeInterval(-5 * 60), trend: .steady, noHeartData: false)
    }
    static let noReading = CareStatus(heartRateBPM: nil, heartRateAt: nil, trend: nil, noHeartData: true)

    /// The caregiver's five tabs, as the app defines them (CaregiverTab in Views.swift isn't public).
    static let tabs: [DebbieTab] = [
        DebbieTab(id: "home", title: "Home", icon: "home", filledIcon: "home.fill", effect: .hop),
        DebbieTab(id: "live", title: "Live", icon: "camera", filledIcon: "camera.fill", effect: .lensPop, inputLabels: ["Live View"]),
        DebbieTab(id: "debbie", title: "Debbie", icon: "", filledIcon: "", effect: .pop, avatar: true, inputLabels: ["Ask Debbie", "Chat"]),
        DebbieTab(id: "history", title: "History", icon: "history", filledIcon: "history.fill", effect: .rewind, inputLabels: ["Alerts"]),
        DebbieTab(id: "devices", title: "Devices", icon: "laptop", filledIcon: "laptop.fill", effect: .lidOpen, inputLabels: ["Laptops"]),
    ]

    /// Every custom symbol in Symbols.xcassets (Design/symbols/src/*.svg): 23 outlines and 5 filled twins.
    static let outlineIcons = [
        "home", "camera", "history", "laptop", "heart", "gear", "settings", "back", "close", "send", "stop", "sync",
        "call", "ack", "add-laptop", "qr-scan", "live", "alert-fall", "home-offline",
        "status-healthy", "status-attention", "status-urgent", "status-unknown",
    ]
    static let filledPairs = ["home", "home.fill", "camera", "camera.fill", "history", "history.fill",
                              "laptop", "laptop.fill", "heart", "heart.fill"]

    static func rows(_ items: [String], of columns: Int) -> [[String]] {
        stride(from: 0, to: items.count, by: columns).map { Array(items[$0..<min($0 + columns, items.count)]) }
    }
}

// MARK: - Buttons

private struct ButtonSections: View {
    var body: some View {
        VStack(alignment: .leading, spacing: 0) {
            GallerySection("buttons", "Buttons · every variant as the app uses it",
                           note: "DebbieButtonStyle. Capsule; 20 pt side padding; label in DType.button (17 pt semibold).") {
                VStack(alignment: .leading, spacing: Space.s12) {
                    Labelled("primary · large 56 (one per screen)") { Button("Continue") {}.buttonStyle(.debbie(.primary, size: .large)) }
                    Labelled("secondary · large 56") { Button("Open Live View") {}.buttonStyle(.debbie(.secondary, size: .large)) }
                    Labelled("quiet · regular 48") { Button("Cancel") {}.buttonStyle(.debbie(.quiet, size: .regular)) }
                    Labelled("destructive · large 56") { Button("Unpair This iPhone") {}.buttonStyle(.debbie(.destructive, size: .large)) }
                    Labelled("urgent · prominent 64 (live view's Stop)") { Button("Stop") {}.buttonStyle(.debbie(.urgent, size: .prominent)) }
                }
            }
            ButtonLadder(name: "buttons-primary", variant: .primary, title: "Buttons · primary (mint)")
            ButtonLadder(name: "buttons-secondary", variant: .secondary, title: "Buttons · secondary")
            ButtonLadder(name: "buttons-quiet", variant: .quiet, title: "Buttons · quiet (no fill)")
            ButtonLadder(name: "buttons-destructive", variant: .destructive, title: "Buttons · destructive")
            ButtonLadder(name: "buttons-urgent", variant: .urgent, title: "Buttons · urgent (red)")
            ButtonLabelSection()
            ResidentSyncSection()
        }
    }
}

/// One variant at every size, then loading and disabled. The titles name the size in points.
private struct ButtonLadder: View {
    let name: String
    let variant: DButtonVariant
    let title: String
    var body: some View {
        GallerySection(name, title, note: "Top to bottom: compact 44 and regular 48 (hug the label), large 56, prominent 64 and resident 96 (full width), loading, disabled.") {
            VStack(alignment: .leading, spacing: Space.s12) {
                HStack(spacing: Space.s12) {
                    Button("Compact 44") {}.buttonStyle(.debbie(variant, size: .compact))
                    Button("Regular 48") {}.buttonStyle(.debbie(variant, size: .regular))
                }
                Button("Large 56") {}.buttonStyle(.debbie(variant, size: .large))
                Button("Prominent 64") {}.buttonStyle(.debbie(variant, size: .prominent))
                Button("Resident 96") {}.buttonStyle(.debbie(variant, size: .resident))
                Button("Sending…") {}.buttonStyle(.debbie(variant, size: .large, loading: true))
                Button("Disabled") {}.buttonStyle(.debbie(variant, size: .large)).disabled(true)
            }
        }
    }
}

/// Buttons whose own icon plays once per tap (DButtonLabel). Tap one in the gallery to see it.
private struct ButtonLabelSection: View {
    @State private var plays = [0, 0, 0, 0]
    var body: some View {
        GallerySection("button-labels", "Buttons with an animated icon",
                       note: "DButtonLabel: the icon sits 8 pt before the words and plays its effect once per tap.") {
            VStack(alignment: .leading, spacing: Space.s12) {
                Labelled("I'm On It · primary prominent 64 (the leading alert card)") {
                    Button { plays[0] += 1 } label: { DButtonLabel("I'm On It", icon: "ack", plays: plays[0]) }
                        .buttonStyle(.debbie(.primary, size: .prominent))
                }
                Labelled("Start Live View · primary large 56 (Live tab)") {
                    Button { plays[1] += 1 } label: { DButtonLabel("Start Live View", icon: "camera", effect: .lensPop, plays: plays[1]) }
                        .buttonStyle(.debbie(.primary, size: .large))
                }
                Labelled("Add a Laptop · secondary large 56 (Devices tab)") {
                    Button { plays[2] += 1 } label: { DButtonLabel("Add a Laptop", icon: "add-laptop", plays: plays[2]) }
                        .buttonStyle(.debbie(.secondary, size: .large))
                }
                Labelled("Stop · urgent prominent 64 (live view)") {
                    Button { plays[3] += 1 } label: { DButtonLabel("Stop", icon: "stop", plays: plays[3]) }
                        .buttonStyle(.debbie(.urgent, size: .prominent))
                }
            }
        }
    }
}

/// The resident's one big button, composed exactly as ResidentView composes it (that view isn't public).
private struct ResidentSyncSection: View {
    @State private var spins = 0
    var body: some View {
        GallerySection("resident-sync", "Sync Now · the resident's button",
                       note: "Primary at resident size (96 pt), label in DType.residentLabel (20 pt semibold). The sync icon turns once per tap; while it sends, the spinner replaces it and the colour stays.") {
            VStack(alignment: .leading, spacing: Space.s12) {
                Labelled("ready") {
                    Button { spins += 1 } label: {
                        HStack(spacing: Space.s12) {
                            DAnimatedIcon("sync", effect: .spin, trigger: spins)
                            Text("Sync Now")
                        }
                    }
                    .buttonStyle(.debbie(.primary, size: .resident))
                }
                Labelled("sending") {
                    Button {} label: { Text("Sending…") }.buttonStyle(.debbie(.primary, size: .resident, loading: true))
                }
            }
        }
    }
}

// MARK: - Form controls and cards

private struct FormSections: View {
    @State private var on = true
    @State private var off = false
    @State private var role = 0
    @State private var emptyName = ""
    @State private var name = "Sam's iPhone"
    @State private var invalidName = ""

    var body: some View {
        VStack(alignment: .leading, spacing: 0) {
            GallerySection("switch", "Switch row",
                           note: "DebbieSwitchStyle: 52 × 32 pt track, 24 pt knob. On: mint track, deep-green knob. Off: sunken track, grey knob. Shown in a card, as in Settings.") {
                DCard {
                    VStack(alignment: .leading, spacing: Space.s8) {
                        Toggle("Resident mode on this iPhone", isOn: $on).toggleStyle(DebbieSwitchStyle())
                        Toggle("Resident mode on this iPhone", isOn: $off).toggleStyle(DebbieSwitchStyle())
                    }
                }
            }
            GallerySection("choice-cards", "Choice cards",
                           note: "DChoiceCard (onboarding's role step). Selected: mint tint with a 2.5 pt accent outline. Not selected: card colour with a 1 pt outline. Tap to switch.") {
                VStack(alignment: .leading, spacing: Space.s16) {
                    DChoiceCard(title: "A family member", detail: "Get alerts and check on home.", icon: "status-healthy", selected: role == 0) { role = 0 }
                    DChoiceCard(title: "The person at home", detail: "Send heart rate from your Watch.", icon: "heart", selected: role == 1) { role = 1 }
                }
            }
            GallerySection("text-field", "Text field",
                           note: "DTextField: a label above a 48 pt well. Outline 1 pt; 2 pt accent when focused; 2 pt red with a message below on error.") {
                VStack(alignment: .leading, spacing: Space.s16) {
                    Labelled("empty (placeholder)") {
                        DTextField("Name shown on the home laptop", placeholder: "Sam's iPhone", text: $emptyName)
                    }
                    Labelled("filled") {
                        DTextField("Name shown on the home laptop", placeholder: "Sam's iPhone", text: $name)
                    }
                    Labelled("error") {
                        DTextField("Name shown on the home laptop", placeholder: "Sam's iPhone", text: $invalidName, error: "Enter a name.")
                    }
                }
            }
            GallerySection("cards", "Cards",
                           note: "DCard: 16 pt padding, 20 pt corners, no shadow. The four tints the app uses.") {
                VStack(alignment: .leading, spacing: Space.s12) {
                    DCard { cardLine("bg.surface · the default card", color: .dText) }
                    DCard(tint: .dMintTint) { cardLine("mint.tint · calm status, the Live tab's card", color: .dText) }
                    DCard(tint: .dCautionTint) { cardLine("caution.tint · status that needs attention", color: .dText) }
                    DCard(tint: .dUrgentFill) { cardLine("urgent.fill · only the newest unanswered urgent alert", color: .dOnUrgent) }
                }
            }
        }
    }

    private func cardLine(_ text: String, color: Color) -> some View {
        Text(text).font(DType.body).foregroundStyle(color).fixedSize(horizontal: false, vertical: true)
    }
}

// MARK: - Status

private struct StatusSections: View {
    var body: some View {
        VStack(alignment: .leading, spacing: 0) {
            GallerySection("status-rows-state", "Status rows · state style",
                           note: "DStatusRow(.state), as in the status header. Top to bottom: healthy, attention, urgent, unknown, info. Glyph shape and words carry the meaning; colour only adds to it.") {
                DCard {
                    VStack(alignment: .leading, spacing: Space.s12) {
                        DStatusRow(label: "Connection", value: "Connected to home", detail: "Home last in touch 7:12 PM", tone: .healthy, style: .state)
                        DStatusRow(label: "Monitoring", value: "Monitoring is limited", detail: "Kitchen laptop not reporting since 7:05 PM", tone: .attention, style: .state)
                        DStatusRow(label: "Connection", value: "Removed from the home", detail: "Pair again to get alerts.", tone: .urgent, style: .state)
                        DStatusRow(label: "Monitoring", value: "Monitoring status unknown", detail: "No update from home since 7:02 PM", tone: .unknown, style: .state)
                        DStatusRow(label: "Camera", value: "Turned off by the resident", detail: nil, tone: .info, style: .state)
                    }
                }
            }
            GallerySection("status-rows-inline", "Status rows · inline style",
                           note: "DStatusRow(.inline), as on the Devices tab: name and age on the left, state on the right. A row that doesn't fit on one line stacks (the urgent row here).") {
                DCard {
                    VStack(alignment: .leading, spacing: Space.s8) {
                        DStatusRow(label: "Kitchen laptop", value: "Reporting", detail: "Updated just now", tone: .healthy, style: .inline)
                        DStatusRow(label: "Living room laptop", value: "Not reporting", detail: "Updated 3 min ago", tone: .attention, style: .inline)
                        DStatusRow(label: "This iPhone", value: "Removed from the home", detail: nil, tone: .urgent, style: .inline)
                        DStatusRow(label: "Sound detection", value: "Not known", detail: nil, tone: .unknown, style: .inline)
                        DStatusRow(label: "Camera", value: "Turned off", detail: nil, tone: .info, style: .inline)
                    }
                }
            }
            GallerySection("status-rows-labelled", "Status rows · labelled style",
                           note: "DStatusRow(.labelled): label, value and detail on separate lines. Defined but not used on any build 3 screen. Healthy, attention, urgent, unknown, info.") {
                DCard {
                    VStack(alignment: .leading, spacing: Space.s12) {
                        DStatusRow(label: "Connection", value: "Connected to home", detail: "Home last in touch 7:12 PM", tone: .healthy)
                        DStatusRow(label: "Monitoring", value: "Monitoring is limited", detail: "Kitchen laptop not reporting", tone: .attention)
                        DStatusRow(label: "Connection", value: "Removed from the home", detail: "Pair again to get alerts.", tone: .urgent)
                        DStatusRow(label: "Monitoring", value: "Monitoring status unknown", detail: nil, tone: .unknown)
                        DStatusRow(label: "Camera", value: "Turned off by the resident", detail: nil, tone: .info)
                    }
                }
            }
            StatusHeaderSection(name: "status-header-on", headline: .monitoringOn,
                                note: "Healthy: mint tint. The headline is the Home tab's title.")
            StatusHeaderSection(name: "status-header-limited", headline: .monitoringLimited,
                                note: "Needs attention: caution tint. The worst row decides the headline.")
            StatusHeaderSection(name: "status-header-unknown", headline: .monitoringUnknown,
                                note: "Unknown: the plain card colour. Never an all-clear without a fresh update.")
            StatusHeaderSection(name: "status-header-cant-connect", headline: .cantConnect,
                                note: "Can't connect: caution tint.")
            StatusHeaderSection(name: "status-header-cant-reach", headline: .cantReachHome,
                                note: "Can't reach home: caution tint, with when home was last in touch.")
            StatusHeaderSection(name: "status-header-removed", headline: .removed,
                                note: "Removed from the home: caution tint; the connection row turns red.")
        }
    }
}

private struct StatusHeaderSection: View {
    let name: String
    let headline: HomeStatus.Headline
    let note: String
    var body: some View {
        GallerySection(name, "Status header · \(CareCopy.headline(headline).0)", note: "StatusHeaderView. \(note)") {
            StatusHeaderView(status: Sample.status(headline), lastRefresh: .now)
        }
    }
}

// MARK: - Alerts and heart rate

private struct AlertSections: View {
    var body: some View {
        VStack(alignment: .leading, spacing: 0) {
            GallerySection("alert-card-urgent", "Alert card · urgent, not answered",
                           note: "AlertCardView, leading the Home tab. The only solid red surface in the app. White words; I'm On It is secondary at prominent size so it reads on red.") {
                AlertCardView(alert: Sample.urgent, emphasised: true) {}
            }
            GallerySection("alert-card-acknowledged", "Alert card · answered",
                           note: "After I'm On It, or marked a false alarm: back to the plain card; urgency stays only in the red tier word and glyph.") {
                VStack(alignment: .leading, spacing: Space.s12) {
                    Labelled("I'm On It pressed") { AlertCardView(alert: Sample.acknowledged, emphasised: false) {} }
                    Labelled("marked as a false alarm") { AlertCardView(alert: Sample.falseAlarm, emphasised: false) {} }
                }
            }
            GallerySection("alert-card-attention", "Alert card · needs attention",
                           note: "The card that leads the list gets the mint I'm On It at 64 pt; later cards get the secondary style at 56 pt.") {
                VStack(alignment: .leading, spacing: Space.s12) {
                    Labelled("leading card") { AlertCardView(alert: Sample.attention, emphasised: true) {} }
                    Labelled("later card") { AlertCardView(alert: Sample.attention, emphasised: false) {} }
                }
            }
            GallerySection("alert-card-info", "Alert card · update",
                           note: "Info alerts have no button. The tier word is \"Update\".") {
                AlertCardView(alert: Sample.info, emphasised: false) {}
            }
            GallerySection("alert-card-late", "Alert card · arrived late",
                           note: "When an alert reaches the phone a minute or more after it was noticed, the card gives both times.") {
                AlertCardView(alert: Sample.late, emphasised: false) {}
            }
            GallerySection("heart-rate-card", "Heart rate card",
                           note: "HeartRateCard on the Home tab. The heart fills and beats when a new reading arrives; the number rolls to its new value.") {
                VStack(alignment: .leading, spacing: Space.s12) {
                    Labelled("reading") { HeartRateCard(care: Sample.reading) }
                    Labelled("no data") { HeartRateCard(care: Sample.noReading) }
                }
            }
            GallerySection("reading", "Resident reading",
                           note: "DReading: 64 pt SF Pro Rounded bold, tabular digits, scaling with the text size. The resident's screen centres it on a mint-tint card.") {
                DReading("72").frame(maxWidth: .infinity)
            }
        }
    }
}

// MARK: - Chrome and screen-level patterns

private struct ChromeSections: View {
    let liveEnds: Date
    var body: some View {
        VStack(alignment: .leading, spacing: 0) {
            GallerySection("tab-bar", "Tab bar",
                           note: "DebbieTabBar: a floating Liquid Glass capsule 20 pt from the screen edges. The selected tab gets a mint-tint highlight, a filled icon and accent words. Tap a tab to see the highlight move.") {
                VStack(alignment: .leading, spacing: Space.s16) {
                    Labelled("Home selected, 1 unanswered urgent alert") {
                        GalleryTabBar(selected: "home", badges: ["home": 1]).padding(.horizontal, -Space.s20)
                    }
                    Labelled("Debbie selected") {
                        GalleryTabBar(selected: "debbie", badges: [:]).padding(.horizontal, -Space.s20)
                    }
                }
            }
            GallerySection("tab-bar-over-content", "Tab bar over a page",
                           note: "The bar floats over the page; the glass shows what scrolls beneath it.") {
                ScreenSlice(height: Size.scannerSheet) {
                    ZStack(alignment: .bottom) {
                        VStack(alignment: .leading, spacing: Space.s16) {
                            AlertCardView(alert: Sample.attention, emphasised: false) {}
                            HeartRateCard(care: Sample.reading)
                        }
                        .padding(.horizontal, Space.s20)
                        .padding(.top, Space.s16)
                        .frame(maxHeight: .infinity, alignment: .top)
                        GalleryTabBar(selected: "home", badges: ["home": 1])
                    }
                }
            }
            GallerySection("corner-button", "Corner button and demo badge",
                           note: "DebbieCornerButton: a 44 pt Liquid Glass circle; the gear turns one tooth when tapped. DDemoBadge sits beside it in the demo home.") {
                HStack(alignment: .center, spacing: Space.s32) {
                    Labelled("gear") { DebbieCornerButton(icon: "gear", label: "Settings", effect: .turn) {} }
                    Labelled("demo badge + gear (top-right corner)") { CornerSample() }
                }
            }
            GallerySection("top-bar", "Top bar with Back",
                           note: "DebbieTopBar: Back (a 44 pt icon button) and a 17 pt semibold title, 16 pt from the screen edge.") {
                VStack(alignment: .leading, spacing: Space.s12) {
                    Labelled("pushed screen (Alert)") { DebbieTopBar("Alert", onBack: {}).padding(.horizontal, -Space.s20) }
                    Labelled("setup step with the demo badge") {
                        DebbieTopBar("Set Up", onBack: {}) { DDemoBadge() }.padding(.horizontal, -Space.s20)
                    }
                }
            }
            GallerySection("sheet-header", "Sheet header",
                           note: "DebbieSheetHeader: Close on the leading edge, then the title in 22 pt rounded bold. Tops every sheet (Settings, Add a Laptop).") {
                VStack(alignment: .leading, spacing: Space.s12) {
                    DebbieSheetHeader("Settings", onClose: {}).padding(.horizontal, -Space.s20)
                    DebbieSheetHeader("Add a Laptop", onClose: {}).padding(.horizontal, -Space.s20)
                }
            }
            GallerySection("confirm-sheet", "Confirmation sheet",
                           note: "DConfirmSheet, shown flat. In the app it rises as a system sheet at half height, with a drag indicator.") {
                DConfirmSheet(title: "Mark as a False Alarm?", message: "This tells the home hub that nothing was wrong.",
                              actionTitle: "Mark False Alarm", destructive: false, onConfirm: {}, onCancel: {})
                    .padding(.horizontal, -Space.s20)
            }
            GallerySection("confirm-sheet-destructive", "Confirmation sheet · destructive",
                           note: "A destructive confirmation uses the urgent (red) button.") {
                DConfirmSheet(title: "Unpair This iPhone?", message: "Debbie will delete this phone's keys. You'll need to pair again.",
                              actionTitle: "Unpair", destructive: true, onConfirm: {}, onCancel: {})
                    .padding(.horizontal, -Space.s20)
            }
            GallerySection("tab-screen-header", "Tab page header",
                           note: "DebbieTabScreen with a title: 34 pt rounded bold title, corner controls on the right, content 20 pt from the edges.") {
                ScreenSlice(height: Size.scannerSheet) {
                    DebbieTabScreen("History") { CornerSample() } content: {
                        AlertCardView(alert: Sample.acknowledged, emphasised: false) {}
                    }
                }
            }
            GallerySection("tab-screen-home", "Home page header",
                           note: "DebbieTabScreen without a title: the top row names the home, and the status header below is the page's title.") {
                ScreenSlice(height: Size.scannerMax) {
                    DebbieTabScreen(nil, subtitle: "Demo Home") { CornerSample() } content: {
                        StatusHeaderView(status: Sample.status(.monitoringOn), lastRefresh: .now)
                    }
                }
            }
            GallerySection("pinned-action", "Pinned primary action",
                           note: "debbiePinnedAction: the screen's one primary button stays above the home indicator on a white strip while the content scrolls.") {
                ScreenSlice(height: Size.scannerSheet) {
                    ScrollView {
                        DebbieGuide("Name this iPhone", detail: "The home laptop shows this name.").padding(Space.s20)
                    }
                    .debbiePinnedAction { Button("Continue") {}.buttonStyle(.debbie(.primary, size: .large)) }
                }
            }
            GallerySection("live-bar", "Live bar",
                           note: "DebbieLiveBar on the live-view screen's scrim: opaque indigo, a white outline, the word LIVE and a countdown.") {
                DebbieLiveBar(place: "Home camera", endsAt: liveEnds)
                    .padding(.horizontal, Space.s20)
                    .padding(.vertical, Space.s16)
                    .frame(maxWidth: .infinity)
                    .background(Color.dLiveScrim)
                    .padding(.horizontal, -Space.s20)
                    .environment(\.colorScheme, .dark)
            }
        }
    }
}

/// The top-right corner of every main screen in the demo (CornerControls in Views.swift isn't public).
private struct CornerSample: View {
    var body: some View {
        HStack(spacing: Space.s8) {
            DDemoBadge()
            DebbieCornerButton(icon: "gear", label: "Settings", effect: .turn) {}
        }
    }
}

/// A working tab bar with its own selection.
private struct GalleryTabBar: View {
    @State private var selection: String
    let badges: [String: Int]
    init(selected: String, badges: [String: Int]) {
        _selection = State(initialValue: selected)
        self.badges = badges
    }
    var body: some View {
        DebbieTabBar(tabs: Sample.tabs, selection: $selection, badges: badges)
    }
}

// MARK: - Chat

private struct ChatSections: View {
    @State private var emptyDraft = ""
    @State private var draft = "How did she sleep?"
    @State private var busyDraft = ""
    @FocusState private var emptyFocus: Bool
    @FocusState private var draftFocus: Bool
    @FocusState private var busyFocus: Bool
    private let prompt = "Ask about your loved one or the home"

    var body: some View {
        VStack(alignment: .leading, spacing: 0) {
            GallerySection("chat-bubbles", "Chat bubbles",
                           note: "DChatBubble. Yours: right, on mint tint. Debbie's: left, on the card colour. Both 17 pt text, 20 pt corners, at least 48 pt clear on the far side.") {
                VStack(alignment: .leading, spacing: Space.s12) {
                    Text("Debbie answers from your home's data. In an emergency, call emergency services.")
                        .font(DType.footnote).foregroundStyle(Color.dText2).fixedSize(horizontal: false, vertical: true)
                    DChatBubble(text: "How are they today?", fromDebbie: false)
                    VStack(alignment: .leading, spacing: Space.s4) {
                        DChatBubble(text: "Monitoring is on, confirmed just now. The latest heart rate is 72 beats a minute, steady, measured 5 min ago.", fromDebbie: true)
                        Caption("Written on this iPhone from your home's data")
                    }
                }
            }
            GallerySection("typing-indicator", "Typing indicator",
                           note: "DTypingIndicator: three 8 pt dots light up in turn while Debbie writes. After 3 s the words appear. Under Reduce Motion the dots hold still.") {
                VStack(alignment: .leading, spacing: Space.s12) {
                    Labelled("dots (the first 3 s)") { DTypingIndicator() }
                    Labelled("with words (after 3 s)") { DTypingIndicator(words: "Summarizing the latest from home…") }
                }
            }
            GallerySection("suggestion-chips", "Suggestion chips",
                           note: "DSuggestionChip in DFlow: outlined capsules, at least 44 pt tall, 8 pt apart. They wrap onto new lines instead of scrolling sideways.") {
                VStack(alignment: .leading, spacing: Space.s12) {
                    Labelled("as in the app: two chips, one row") {
                        DFlow(spacing: Space.s8) {
                            DSuggestionChip("How are they today?") {}
                            DSuggestionChip("Any alerts?") {}
                        }
                    }
                    Labelled("wrapping: a third chip starts a new row") {
                        DFlow(spacing: Space.s8) {
                            DSuggestionChip("How are they today?") {}
                            DSuggestionChip("Any alerts?") {}
                            DSuggestionChip("Is everything working?") {}
                        }
                    }
                }
            }
            GallerySection("composer", "Composer",
                           note: "DChatComposer: a 48 pt pill field that grows to four lines. Send (a 48 pt mint circle) appears only with text; while Debbie writes it becomes Stop.") {
                VStack(alignment: .leading, spacing: Space.s12) {
                    Labelled("empty") {
                        DChatComposer(text: $emptyDraft, placeholder: prompt, busy: false, focus: $emptyFocus, onSend: {}, onStop: {})
                    }
                    Labelled("with text: Send") {
                        DChatComposer(text: $draft, placeholder: prompt, busy: false, focus: $draftFocus, onSend: {}, onStop: {})
                    }
                    Labelled("Debbie writing: Stop") {
                        DChatComposer(text: $busyDraft, placeholder: prompt, busy: true, focus: $busyFocus, onSend: {}, onStop: {})
                    }
                }
            }
        }
    }
}

// MARK: - Debbie

private struct PersonaSections: View {
    var body: some View {
        VStack(alignment: .leading, spacing: 0) {
            GallerySection("avatar-sizes", "Debbie at every size",
                           note: "DebbieAvatar: tab 30, chat header 44, guide 64, welcome hero 148 pt. A mint-tint circle behind her. She idles at 64 pt and up; smaller faces hold still.") {
                HStack(alignment: .bottom, spacing: Space.s12) {
                    AvatarSample(size: Size.tabAvatar, label: "30")
                    AvatarSample(size: Size.avatarSmall, label: "44")
                    AvatarSample(size: Size.avatarGuide, label: "64")
                    AvatarSample(size: Size.avatarHero, label: "148")
                }
            }
            GallerySection("debbie-guide", "Debbie's guide line",
                           note: "DebbieGuide (onboarding): her 64 pt face beside a speech bubble on the card colour, line in 22 pt rounded bold.") {
                DebbieGuide("Who uses this iPhone?", detail: "I'll set things up to suit.")
            }
            GallerySection("debbie-with-badge", "Debbie with a badge",
                           note: "DebbieWithBadge: her face at 111 pt with a 36 pt mint badge for the topic. Used on the priming and paired screens.") {
                Grid(alignment: .leading, horizontalSpacing: Space.s24, verticalSpacing: Space.s16) {
                    GridRow {
                        BadgeSample(icon: "laptop", label: "find the laptop")
                        BadgeSample(icon: "qr-scan", label: "scan the code")
                    }
                    GridRow {
                        BadgeSample(icon: "status-urgent", label: "alerts")
                        BadgeSample(icon: "heart", label: "heart rate")
                    }
                    GridRow {
                        BadgeSample(icon: "status-healthy", label: "paired")
                    }
                }
            }
        }
    }
}

private struct AvatarSample: View {
    let size: CGFloat
    let label: String
    var body: some View {
        VStack(spacing: Space.s4) {
            DebbieAvatar(size: size)
            Caption(label)
        }
    }
}

private struct BadgeSample: View {
    let icon: String
    let label: String
    var body: some View {
        VStack(alignment: .leading, spacing: Space.s4) {
            DebbieWithBadge(icon: icon)
            Caption(label)
        }
    }
}

// MARK: - Empty, priming, pairing code, progress

private struct StateSections: View {
    var body: some View {
        VStack(alignment: .leading, spacing: 0) {
            GallerySection("empty-state", "Empty state",
                           note: "DEmptyState: optional art up to 140 pt tall, a 22 pt title and a sentence, centred. Top: with art (Home, no alerts). Bottom: words only (Devices, nothing yet).") {
                VStack(spacing: 0) {
                    DEmptyState(art: "no-alerts", title: "No alerts", message: "Monitoring is on. Updated just now.")
                    DEmptyState(title: "Nothing reported yet", message: "Laptops and sensors appear here once the home sends its first update.")
                }
            }
            GallerySection("priming", "Permission priming",
                           note: "DPriming with Debbie asking: her face with a badge, a title, one sentence and one pinned Continue. Shown before each system prompt.") {
                ScreenSlice(height: Size.scannerMax + Size.featureIcon) {
                    DPriming(icon: "laptop", title: "Let's find your home laptop",
                             message: "I look for the home laptop on this Wi-Fi. iPhone will ask to allow this next.", persona: true) {}
                }
            }
            GallerySection("code-display", "Pairing code",
                           note: "DCodeDisplay: four digits, each 34 pt rounded semibold in a 56 × 64 pt sunken well, 12 pt apart. Below it, the waiting line as the Check the Code step shows it.") {
                VStack(spacing: Space.s24) {
                    DCodeDisplay("4719")
                    HStack(spacing: Space.s8) {
                        DebbieSpinner().foregroundStyle(Color.dAccent)
                        Text("Waiting for the laptop to confirm…").font(DType.secondary).fixedSize(horizontal: false, vertical: true)
                    }
                    .foregroundStyle(Color.dText2)
                }
                .frame(maxWidth: .infinity)
            }
            GallerySection("spinner", "Progress spinner",
                           note: "DebbieSpinner: an 18 pt ring, 70 % drawn, turning once a second. It takes the colour of the words beside it. There is no progress bar in build 3.") {
                VStack(alignment: .leading, spacing: Space.s16) {
                    Labelled("beside words (accent)") {
                        HStack(spacing: Space.s8) {
                            DebbieSpinner().foregroundStyle(Color.dAccent)
                            Text("Waiting for the laptop to confirm…").font(DType.secondary).foregroundStyle(Color.dText2)
                        }
                    }
                    Labelled("in a loading button") {
                        Button("Sending…") {}.buttonStyle(.debbie(.primary, size: .large, loading: true))
                    }
                    Labelled("on the live-view scrim") {
                        VStack(spacing: Space.s12) {
                            DebbieSpinner().foregroundStyle(Color.dOnLive)
                            Text("Connecting to the camera…").font(DType.title).foregroundStyle(Color.dOnLive)
                        }
                        .padding(Space.s24)
                        .frame(maxWidth: .infinity)
                        .background(Color.dLiveScrim, in: RoundedRectangle(cornerRadius: Radius.r20, style: .continuous))
                        .environment(\.colorScheme, .dark)
                    }
                }
            }
        }
    }
}

// MARK: - Icons

private struct IconSections: View {
    var body: some View {
        VStack(alignment: .leading, spacing: 0) {
            GallerySection("icons", "Icons · outline",
                           note: "Every custom symbol (no SF Symbols), at DType.title size in text.primary. Icons size with the text beside them.") {
                IconGrid(names: Sample.outlineIcons)
            }
            GallerySection("icons-filled", "Icons · outline and filled",
                           note: "Five icons have a filled twin, used only for a selected tab or an active state (a heart with a reading).") {
                IconGrid(names: Sample.filledPairs)
            }
            IconAnimationsSection()
            GallerySection("debbie-idle", "Debbie idling",
                           note: "Hero size, 148 pt. She breathes (under 1 % over 4.8 s), tilts her head 2° each way over 7.3 s and blinks about every 4.4 s.") {
                DebbieAvatar(size: Size.avatarHero).frame(maxWidth: .infinity)
            }
        }
    }
}

private struct IconGrid: View {
    let names: [String]
    var body: some View {
        Grid(alignment: .top, horizontalSpacing: Space.s8, verticalSpacing: Space.s16) {
            ForEach(Sample.rows(names, of: 4), id: \.self) { row in
                GridRow {
                    ForEach(row, id: \.self) { name in
                        VStack(spacing: Space.s4) {
                            DIcon(name).font(DType.title).foregroundStyle(Color.dText).frame(minHeight: Size.tabIcon)
                            Caption(name).multilineTextAlignment(.center)
                        }
                        .frame(maxWidth: .infinity)
                        .accessibilityElement(children: .combine)
                    }
                }
            }
        }
    }
}

/// Every icon effect on its own icon, played every 2 s, for the screen recording (09-motion).
/// The repeating trigger is a gallery device only: in the app every effect plays once per tap or event (CRAFT M8).
private struct IconAnimationsSection: View {
    private struct Effect: Identifiable {
        let id: String
        let icon: String
        let effect: DIconEffect
    }
    private let effects = [
        Effect(id: "hop", icon: "home", effect: .hop), Effect(id: "lensPop", icon: "camera", effect: .lensPop),
        Effect(id: "rewind", icon: "history", effect: .rewind), Effect(id: "lidOpen", icon: "laptop", effect: .lidOpen),
        Effect(id: "turn", icon: "gear", effect: .turn), Effect(id: "beat", icon: "heart", effect: .beat),
        Effect(id: "spin", icon: "sync", effect: .spin), Effect(id: "pop", icon: "ack", effect: .pop),
    ]
    @State private var tick = 0

    var body: some View {
        GallerySection("icon-animations", "Icon animations",
                       note: "DAnimatedIcon: each effect on its own icon, replayed every 2 s here. In the app each plays once per tap.") {
            Grid(alignment: .top, horizontalSpacing: Space.s8, verticalSpacing: Space.s24) {
                GridRow { ForEach(effects.prefix(4)) { cell($0) } }
                GridRow { ForEach(effects.suffix(4)) { cell($0) } }
            }
        }
        .task {
            while !Task.isCancelled {
                try? await Task.sleep(for: .seconds(2))
                tick += 1
            }
        }
    }

    private func cell(_ e: Effect) -> some View {
        VStack(spacing: Space.s8) {
            DAnimatedIcon(e.icon, effect: e.effect, trigger: tick, label: e.icon)
                .font(DType.hero).imageScale(.large).foregroundStyle(Color.dAccent)
                .frame(minWidth: Size.prominent, minHeight: Size.prominent)
            VStack(spacing: 0) {
                Text(e.id).font(DType.footnote.weight(.semibold)).foregroundStyle(Color.dText)
                Caption(e.icon)
            }
        }
        .frame(maxWidth: .infinity)
    }
}
#endif
