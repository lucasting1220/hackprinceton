import DebbieCore
import DebbieDesignSystem
import SwiftUI

// Layer 4's care screens (brief §5.3): alerts, status (with heart rate and "no heart data"), history.
// They depend only on DebbieCore and DebbieDesignSystem (CRAFT.md §8 E2), through this model protocol.

/// What the care screens read and do. Layer 1's app provides it.
@MainActor
public protocol CareModel: AnyObject, Observable {
    var status: HomeStatus { get }
    var alerts: [HubAlert] { get }
    var monitoring: MonitoringSnapshot? { get }
    var care: CareStatus? { get }
    var lastRefresh: Date? { get }
    func acknowledge(_ alert: HubAlert, falseAlarm: Bool) async
}

// MARK: Copy (CRAFT.md §6 V5)

public enum CareCopy {
    public static func headline(_ h: HomeStatus.Headline) -> (String, DStatusTone) {
        switch h {
        case .removed: ("This iPhone was removed from the home", .urgent)
        case .cantReachHome: ("Can't reach home", .attention)
        case .cantConnect: ("Can't connect to Debbie", .attention)
        case .monitoringUnknown: ("Monitoring status unknown", .unknown)
        case .monitoringLimited: ("Monitoring is limited", .attention)
        case .monitoringOn: ("Monitoring is on", .healthy)
        }
    }

    public static func ago(_ date: Date?, now: Date = .now) -> String {
        guard let date else { return "No update yet" }
        let minutes = Int(now.timeIntervalSince(date) / 60)
        if minutes < 1 { return "Updated just now" }
        if minutes < 60 { return "Updated \(minutes) min ago" }
        return "Updated at \(date.formatted(date: .omitted, time: .shortened))"
    }

    public static func tier(_ s: Severity) -> (String, DStatusTone) {
        switch s { case .urgent: ("Urgent", .urgent); case .attention: ("Needs attention", .attention); case .info: ("Update", .info) }
    }

    public static func title(_ a: HubAlert) -> String {
        switch a.kind {
        case .fall: "Possible fall"
        case .callForHelp: "Possible call for help"
        case .noMovement: "No movement noticed"
        case .sound: "Possible sound of concern"
        case .heartRateHigh: "Heart rate higher than usual"
        case .heartRateLow: "Heart rate lower than usual"
        case .checkIn, .other: a.title
        }
    }

    public static func icon(_ a: HubAlert) -> String {
        switch a.kind { case .fall: "alert-fall"; case .heartRateHigh, .heartRateLow: "heart"; default: a.severity == .urgent ? "status-urgent" : "status-attention" }
    }
}

// MARK: Status header (three independent rows + headline; lead decision X54)

public struct StatusHeaderView: View {
    let status: HomeStatus
    let lastRefresh: Date?
    public init(status: HomeStatus, lastRefresh: Date?) { self.status = status; self.lastRefresh = lastRefresh }

    public var body: some View {
        let (headline, tone) = CareCopy.headline(status.headline)
        DCard(tint: tone == .healthy ? .dMintTint : (tone == .unknown ? .dSurface : .dCautionTint)) {
            VStack(alignment: .leading, spacing: Space.s12) {
                HStack(alignment: .firstTextBaseline, spacing: Space.s12) {
                    DIcon(tone == .healthy ? "status-healthy" : (tone == .unknown ? "status-unknown" : "status-attention"))
                        .font(DType.title).foregroundStyle(Color.dText)
                    // No Dynamic Type cap (brief: the largest accessibility sizes; Xcode's audit flags caps). It wraps instead.
                    Text(headline).font(DType.hero).foregroundStyle(Color.dText)
                        .fixedSize(horizontal: false, vertical: true)
                        .accessibilityAddTraits(.isHeader)
                }
                DStatusRow(label: "Connection", value: connectionText, detail: connectionDetail, tone: connectionTone, style: .state)
                DStatusRow(label: "Monitoring", value: monitoringText, detail: monitoringDetail, tone: monitoringTone, style: .state)
                DStatusRow(label: "Extra detail", value: languageText, detail: nil, tone: status.languageModel == .available ? .healthy : .unknown, style: .state)
            }
        }
        .accessibilityIdentifier("statusHeader")
    }

    private var connectionText: String {
        switch status.connection {
        case .connected: "Connected to home"
        case .cantReachHome: "Can't reach home"
        case .cantConnect: "Can't connect to Debbie"
        case .removed: "Removed from the home"
        }
    }
    private var connectionDetail: String? {
        switch status.connection {
        case .connected(let d): "Home last in touch \(d.formatted(date: .omitted, time: .shortened))"
        case .cantReachHome(let d): d.map { "Home last connected at \($0.formatted(date: .omitted, time: .shortened)). Alerts will come through when it reconnects." }
        case .cantConnect: "Trying again every 30 seconds."
        case .removed: "Pair again to get alerts."
        }
    }
    private var connectionTone: DStatusTone {
        switch status.connection { case .connected: .healthy; case .removed: .urgent; default: .attention }
    }
    private var monitoringText: String {
        switch status.monitoring { case .on: "Fall and sound detection running"; case .limited: "Monitoring is limited"; case .unknown: "Monitoring status unknown" }
    }
    private var monitoringDetail: String? {
        switch status.monitoring {
        case .on(let d): CareCopy.ago(d)
        case .limited(let reason, let since): "\(reason) since \(since.formatted(date: .omitted, time: .shortened))"
        case .unknown(let d): d.map { "No update from home since \($0.formatted(date: .omitted, time: .shortened))" } ?? "No update from home yet"
        }
    }
    private var monitoringTone: DStatusTone {
        switch status.monitoring { case .on: .healthy; case .limited: .attention; case .unknown: .unknown }
    }
    private var languageText: String {
        switch status.languageModel { case .available: "Extra detail is on"; case .unavailable: "Extra detail is off. Alerts still arrive as usual."; case .unknown: "Extra detail: not known yet" }
    }
}

// MARK: Alert card and detail

public struct AlertCardView: View {
    let alert: HubAlert
    let emphasised: Bool
    let onAcknowledge: () -> Void
    @State private var plays = 0
    public init(alert: HubAlert, emphasised: Bool, onAcknowledge: @escaping () -> Void) {
        self.alert = alert; self.emphasised = emphasised; self.onAcknowledge = onAcknowledge
    }
    public var body: some View {
        let (tierWord, tone) = CareCopy.tier(alert.severity)
        let urgentFill = emphasised && alert.severity == .urgent && alert.acknowledgedAt == nil
        DCard(tint: urgentFill ? .dUrgentFill : .dSurface) {
            VStack(alignment: .leading, spacing: Space.s8) {
                HStack(spacing: Space.s8) {
                    DIcon(CareCopy.icon(alert)).font(DType.headline)
                    Text(tierWord).font(DType.secondary.weight(.semibold))
                }
                .foregroundStyle(urgentFill ? Color.dOnUrgent : tone == .urgent ? Color.dUrgentText : Color.dText2)
                Text(CareCopy.title(alert)).font(DType.headline).foregroundStyle(urgentFill ? Color.dOnUrgent : Color.dText)
                Text(timeLine).font(DType.secondary).foregroundStyle(urgentFill ? Color.dOnUrgent : Color.dText2)
                if let ack = alert.acknowledgedAt {
                    Text(alert.falseAlarm ? "Marked as a false alarm at \(ack.formatted(date: .omitted, time: .shortened))." : "You said you're on it at \(ack.formatted(date: .omitted, time: .shortened)).")
                        .font(DType.secondary).foregroundStyle(urgentFill ? Color.dOnUrgent : Color.dText2)
                } else if alert.severity != .info {
                    // One primary per screen (CRAFT C4), and urgent first: only the leading card gets the mint button.
                    // On an urgent card it's the secondary style, so it reads on red. Later cards stay quieter.
                    Button { plays += 1; onAcknowledge() } label: { DButtonLabel("I'm On It", icon: "ack", plays: plays) }
                        .buttonStyle(.debbie(emphasised && !urgentFill ? .primary : .secondary, size: emphasised ? .prominent : .large))
                        .accessibilityInputLabels(["I'm on it", "Acknowledge"])
                }
            }
        }
        .accessibilityElement(children: .contain)
    }
    private var timeLine: String {
        var s = "Noticed \(alert.detectedAt.formatted(date: .omitted, time: .shortened))"
        if alert.isLate, let r = alert.receivedAt {
            s += " · Arrived \(r.formatted(date: .omitted, time: .shortened)), \(Int(r.timeIntervalSince(alert.detectedAt) / 60)) min after it was noticed"
        }
        return s
    }
}

public struct AlertDetailView<Model: CareModel>: View {
    @Bindable var model: Model
    let alertID: String
    let onBack: () -> Void
    let onLiveView: () -> Void
    @State private var confirmFalseAlarm = false
    public init(model: Model, alertID: String, onBack: @escaping () -> Void, onLiveView: @escaping () -> Void) {
        self.model = model; self.alertID = alertID; self.onBack = onBack; self.onLiveView = onLiveView
    }
    public var body: some View {
        let alert = model.alerts.first { $0.alertID == alertID }
        VStack(spacing: 0) {
            DebbieTopBar("Alert", onBack: onBack)
            ScrollView {
                if let alert {
                    VStack(alignment: .leading, spacing: Space.s16) {
                        AlertCardView(alert: alert, emphasised: true) { Task { await model.acknowledge(alert, falseAlarm: false) } }
                        Text(alert.body).font(DType.body).foregroundStyle(Color.dText)
                        Button("Open Live View", action: onLiveView).buttonStyle(.debbie(.secondary, size: .large))
                        if alert.acknowledgedAt == nil {
                            Button("Mark as False Alarm") { confirmFalseAlarm = true }
                                .buttonStyle(.debbie(.quiet, size: .regular))
                        }
                    }
                    .padding(Space.s20)
                }
            }
        }
        .background(Color.dCanvas.ignoresSafeArea())
        .sheet(isPresented: $confirmFalseAlarm) {
            DConfirmSheet(title: "Mark as a False Alarm?", message: "This tells the home hub that nothing was wrong.",
                          actionTitle: "Mark False Alarm", destructive: false,
                          onConfirm: { confirmFalseAlarm = false; if let alert { Task { await model.acknowledge(alert, falseAlarm: true) } } },
                          onCancel: { confirmFalseAlarm = false })
        }
    }
}

// MARK: Status detail and history

/// The latest heart rate the hub reported (a care screen; brief §5.3). The heart beats when a new reading arrives.
public struct HeartRateCard: View {
    let care: CareStatus?
    public init(care: CareStatus?) { self.care = care }
    public var body: some View {
        DCard {
            VStack(alignment: .leading, spacing: Space.s8) {
                HStack(spacing: Space.s8) {
                    DAnimatedIcon("heart", filled: "heart.fill", effect: .beat, trigger: care?.heartRateBPM ?? 0, active: hasReading)
                        .font(DType.headline).foregroundStyle(Color.dAccent)
                    Text("Heart rate").font(DType.headline).foregroundStyle(Color.dText)
                }
                if let c = care, let bpm = c.heartRateBPM, !c.noHeartData {
                    Text("\(bpm)").font(DType.metric).foregroundStyle(Color.dText).contentTransition(Motion.numeric)
                    Text("beats a minute · \(Self.trend(c.trend)) · \(CareCopy.ago(c.heartRateAt))").font(DType.secondary).foregroundStyle(Color.dText2)
                } else {
                    Text("No heart data").font(DType.bodyStrong).foregroundStyle(Color.dText)
                    Text("Readings appear after the Watch syncs with the resident's iPhone.").font(DType.secondary).foregroundStyle(Color.dText2)
                }
            }
        }
        .accessibilityElement(children: .combine)
        .accessibilityIdentifier("heartRateCard")
    }
    private var hasReading: Bool { care?.heartRateBPM != nil && care?.noHeartData == false }
    static func trend(_ t: CareStatus.Trend?) -> String {
        switch t { case .rising: "rising"; case .falling: "falling"; case .steady: "steady"; case nil: "trend unknown" }
    }
}

/// What is set up at home: the laptops and what each part of monitoring is doing (the Devices tab's content).
public struct DevicesContent<Model: CareModel>: View {
    let model: Model
    let onAddLaptop: () -> Void
    @State private var plays = 0
    public init(model: Model, onAddLaptop: @escaping () -> Void) { self.model = model; self.onAddLaptop = onAddLaptop }
    public var body: some View {
        VStack(alignment: .leading, spacing: Space.s16) {
            if let m = model.monitoring {
                DCard {
                    VStack(alignment: .leading, spacing: Space.s8) {
                        HStack(spacing: Space.s8) {
                            DIcon("laptop").font(DType.headline).foregroundStyle(Color.dAccent)
                            Text("Laptops").font(DType.headline).foregroundStyle(Color.dText)
                        }
                        ForEach(m.laptops) { l in
                            DStatusRow(label: l.displayName, value: l.reporting ? "Reporting" : "Not reporting",
                                       detail: CareCopy.ago(l.lastStatusAt), tone: l.reporting ? .healthy : .attention, style: .inline)
                        }
                    }
                }
                DCard {
                    VStack(alignment: .leading, spacing: Space.s8) {
                        Text("Monitoring").font(DType.headline).foregroundStyle(Color.dText)
                        DStatusRow(label: "Fall detection", value: m.fallDetection == .running ? "Running" : "Not running", detail: nil, tone: m.fallDetection == .running ? .healthy : .attention, style: .inline)
                        DStatusRow(label: "Sound detection", value: m.soundDetection == .running ? "Running" : "Not running", detail: nil, tone: m.soundDetection == .running ? .healthy : .attention, style: .inline)
                        DStatusRow(label: "Camera", value: sensor(m.camera), detail: nil, tone: m.camera == .up ? .healthy : (m.camera == .declined ? .info : .attention), style: .inline)
                        DStatusRow(label: "Microphone", value: sensor(m.mic), detail: nil, tone: m.mic == .up ? .healthy : (m.mic == .declined ? .info : .attention), style: .inline)
                    }
                }
            } else {
                DEmptyState(title: "Nothing reported yet", message: "Laptops and sensors appear here once the home sends its first update.")
            }
            Button { plays += 1; onAddLaptop() } label: { DButtonLabel("Add a Laptop", icon: "add-laptop", plays: plays) }
                .buttonStyle(.debbie(.secondary, size: .large)).accessibilityIdentifier("addLaptop")
        }
    }
    private func sensor(_ s: MonitoringSnapshot.SensorState) -> String {
        switch s { case .up: "Working"; case .down: "Not working"; case .declined: "Turned off by the resident"; case .none: "None" }
    }
}

/// Every alert, newest first (the History tab's content).
public struct HistoryContent<Model: CareModel>: View {
    let model: Model
    public init(model: Model) { self.model = model }
    public var body: some View {
        VStack(spacing: Space.s12) {
            if model.alerts.isEmpty {
                DEmptyState(art: "no-alerts", title: "No alerts yet", message: "Past alerts will show here.")
            }
            ForEach(model.alerts) { a in
                AlertCardView(alert: a, emphasised: false) { Task { await model.acknowledge(a, falseAlarm: false) } }
            }
        }
    }
}

/// The status detail as a pushed screen (kept for Layer 4; the app shows the same parts in its tabs).
public struct HomeStatusDetailView<Model: CareModel>: View {
    let model: Model
    let onBack: () -> Void
    let onAddLaptop: () -> Void
    public init(model: Model, onBack: @escaping () -> Void, onAddLaptop: @escaping () -> Void) {
        self.model = model; self.onBack = onBack; self.onAddLaptop = onAddLaptop
    }
    public var body: some View {
        VStack(spacing: 0) {
            DebbieTopBar("Home Status", onBack: onBack)
            ScrollView {
                VStack(alignment: .leading, spacing: Space.s16) {
                    StatusHeaderView(status: model.status, lastRefresh: model.lastRefresh)
                    HeartRateCard(care: model.care)
                    DevicesContent(model: model, onAddLaptop: onAddLaptop)
                }
                .padding(Space.s20)
            }
        }
        .background(Color.dCanvas.ignoresSafeArea())
    }
}

/// History as a pushed screen (kept for Layer 4; the app shows it as a tab).
public struct HistoryView<Model: CareModel>: View {
    let model: Model
    let onBack: () -> Void
    public init(model: Model, onBack: @escaping () -> Void) { self.model = model; self.onBack = onBack }
    public var body: some View {
        VStack(spacing: 0) {
            DebbieTopBar("History", onBack: onBack)
            ScrollView { HistoryContent(model: model).padding(Space.s20) }
        }
        .background(Color.dCanvas.ignoresSafeArea())
    }
}
