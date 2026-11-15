import DebbieCareScreens
import DebbieCore
import DebbieDesignSystem
import Foundation
import SwiftUI

// MARK: On-device answers

/// Answers without a network or a key, from the same facts, in fixed plain sentences (note 17 R13).
/// Used in UI tests, offline, when a build has no Gemini key, and when the reply guard replaces an answer.
/// - An unanswered urgent alert always comes first.
/// - Then it answers what was asked: the heart rate, the alerts, whether everything is working, or an overview.
/// - A worried question gets the emergency advice before any facts.
public struct OfflineAssistant: AssistantService {
    public init() {}
    public var isGenerative: Bool { false }

    public func reply(instructions: String, homeData: String, conversation: [ChatTurn]) -> AsyncThrowingStream<String, Error> {
        let question = conversation.last { $0.role == .caregiver }?.text ?? ""
        let text = Self.summary(from: homeData, question: question)
        return AsyncThrowingStream { continuation in
            continuation.yield(text)
            continuation.finish()
        }
    }

    enum Topic: Equatable { case overview, heart, alerts, working, worried }

    /// Whole words only, so "painting" isn't pain and "Can you help me understand?" isn't an emergency. Worry is
    /// checked first and leans wide: a false alarm costs one sentence, a missed one costs the advice.
    static func topic(of question: String) -> Topic {
        let q = question.lowercased().replacingOccurrences(of: "\u{2019}", with: "'")
        let worried = #/\b(?:heart attack|stroke|emergency|scared|afraid|worried|panic\w*|hurt\w*|pain|breath\w*|unconscious|fell|fallen|collapsed?|bleeding|unresponsive|not (?:answering|responding|picking up|waking up|moving)|(?:isn't|is not|hasn't|won't|can't|cannot|doesn't|didn't) (?:answer\w*|respond\w*|pick(?:ed|ing)? up|wake up|get up|move|breathe))\b/#
        if q.contains(worried) { return .worried }
        if q.contains(#/\b(?:heart|pulse|bpm)\b/#) { return .heart }
        if q.contains(#/\b(?:alerts?|falls?|happen\w*|news)\b/#) { return .alerts }
        if q.contains(#/\b(?:work\w*|monitor\w*|cameras?|laptops?|sensors?|online|connect\w*)\b/#) { return .working }
        return .overview
    }

    /// A short answer from a `<home_data>` block, in plain sentences, never more than the data says.
    public static func summary(from homeData: String, question: String = "") -> String {
        let facts = HomeFacts(homeData)
        var parts: [String] = []
        let topic = topic(of: question)
        if topic == .worried {
            parts.append("I can't tell what's happening medically from the home's data. If you're worried right now, call emergency services.")
        }
        let urgent = facts.alerts.first { $0.severity == "urgent" && $0.unanswered }
        if let urgent {
            parts.append("An urgent alert hasn't been answered: \(urgent.what) \(HomeFacts.moment(urgent.time, urgent.age)). Open it on the Home tab, or call your loved one.")
        }
        // A home that can't be reached qualifies every other fact, so it's said whatever was asked.
        if let problem = facts.connectionProblem { parts.append(problem) }
        switch topic {
        case .heart:
            parts.append(facts.heart)
        case .alerts:
            // "No alerts" is never said without the monitoring state beside it (CRAFT P2).
            if let monitoring = facts.monitoring { parts.append(monitoring) }
            parts.append(facts.latestAlert(besides: urgent))
        case .working:
            if facts.connectionProblem == nil, let connection = facts.connection { parts.append(connection) }
            parts += [facts.monitoring, facts.sensors].compactMap { $0 }
        case .overview, .worried:
            parts += [facts.monitoring, facts.heart].compactMap { $0 }
            if urgent == nil { parts.append(facts.latestAlert(besides: nil)) }
        }
        let text = parts.filter { !$0.isEmpty }.joined(separator: " ")
        return text.isEmpty ? "There's no update from home yet." : text
    }
}

/// The facts in a `<home_data>` block, read back as plain sentences (the block's format is `homeDataForDebbie`'s).
nonisolated struct HomeFacts {
    nonisolated struct Alert: Equatable {
        let severity: String
        /// The title with a lowercase first letter, to sit inside a sentence ("possible fall").
        let what: String
        let time: String
        /// "11 min ago", from the block; old events say how old they are.
        let age: String?
        let unanswered: Bool
        /// "acknowledged 4:33 PM" or "marked a false alarm 4:33 PM".
        let answer: String?
    }

    let lines: [String]
    let alerts: [Alert]

    init(_ homeData: String) {
        let lines = homeData.components(separatedBy: "\n")
        self.lines = lines
        alerts = lines.filter { $0.hasPrefix("- ") }.map { line in
            let f = String(line.dropFirst(2)).components(separatedBy: " | ")
            let noticed = f.count > 2 ? Self.stamp(f[2]) : nil
            return Alert(severity: f.first ?? "", what: f.count > 1 ? Self.lowerFirst(f[1]) : "an alert",
                         time: noticed?.time ?? "an unknown time", age: noticed?.age,
                         unanswered: f.contains("not acknowledged"),
                         answer: f.first { $0.hasPrefix("acknowledged ") || $0.hasPrefix("marked a false alarm") })
        }
    }

    func value(_ key: String) -> String? {
        lines.first { $0.hasPrefix(key + ":") }.map { String($0.dropFirst(key.count + 1)).trimmingCharacters(in: .whitespaces) }
    }

    /// "noticed 4:31 PM (11 min ago)" gives ("4:31 PM", "11 min ago"). Nil when there's no time.
    static func stamp(_ text: String) -> (time: String, age: String?)? {
        guard let m = text.firstMatch(of: #/(\d{1,2}[:.]\d{2}(?:\s?[AaPp]\.?[Mm]\.?)?)(?:\s*\(([^)]*)\))?/#) else { return nil }
        return (String(m.1), m.2.map(String.init))
    }

    /// "just now", "12 min ago", or "at 4:30 PM" when there's no age.
    static func when(_ text: String) -> String? {
        guard let s = stamp(text) else { return nil }
        if let age = s.age, !age.isEmpty { return age }
        return "at \(s.time)"
    }

    /// "at 4:31 PM", or "at 4:31 PM, 2 days ago" once it's 12 hours or more, so an old event never reads as today's.
    static func moment(_ time: String, _ age: String?) -> String {
        guard let age, let hours = age.firstMatch(of: #/(\d+) h/#).flatMap({ Int($0.1) }), hours >= 12 else { return "at \(time)" }
        let days = hours / 24
        return "at \(time), " + (days >= 1 ? "\(days) day\(days == 1 ? "" : "s") ago" : "\(hours) hours ago")
    }

    static func lowerFirst(_ s: String) -> String { s.prefix(1).lowercased() + s.dropFirst() }
    static func upperFirst(_ s: String) -> String { s.prefix(1).uppercased() + s.dropFirst() }

    var heart: String {
        guard let v = value("heart_rate"), v != "no readings" else { return "No heart-rate readings have arrived yet." }
        // "72 beats a minute, steady, measured 4:30 PM (12 min ago)"
        let parts = v.components(separatedBy: ", measured ")
        guard parts.count > 1, let when = Self.when(parts[1]) else { return "The latest heart rate is \(parts[0])." }
        return "The latest heart rate is \(parts[0]), measured \(when)."
    }

    var monitoring: String? {
        guard let v = value("monitoring") else { return nil }
        if v.hasPrefix("on") {
            return Self.when(v).map { "Monitoring is on, confirmed \($0)." } ?? "Monitoring is on."
        }
        if v.hasPrefix("limited") {
            // "limited since 4:12 PM (30 min ago): the camera is covered"
            let reason = v.range(of: "): ").map { String(v[$0.upperBound...]) } ?? v.range(of: ": ").map { String(v[$0.upperBound...]) }
            let since = Self.stamp(v).map { " since \($0.time)" } ?? ""
            return "Monitoring is limited\(since)" + (reason.map { ": \(Self.lowerFirst($0))." } ?? ".")
        }
        if let s = Self.stamp(v) { return "I can't confirm monitoring right now. It was last confirmed \(Self.moment(s.time, s.age))." }
        return "I can't confirm monitoring right now."
    }

    var connection: String? {
        guard let v = value("connection") else { return nil }
        if v.hasPrefix("home last in touch") {
            return Self.when(v).map { "The home is connected, last in touch \($0)." } ?? "The home is connected."
        }
        if v.hasPrefix("can't reach the home") {
            return Self.stamp(v).map { "I can't reach the home right now. It was last in touch \(Self.moment($0.time, $0.age))." } ?? "I can't reach the home right now."
        }
        return Self.upperFirst(v) + "."
    }

    /// The connection is worth a sentence of its own only when something's wrong.
    var connectionProblem: String? {
        guard let v = value("connection"), !v.hasPrefix("home last in touch") else { return nil }
        return connection
    }

    var sensors: String? {
        guard let v = value("sensors") else { return nil }
        var reporting = 0, silent: [String] = [], state: [String: String] = [:]
        for item in v.components(separatedBy: "; ") {
            if item.hasSuffix(" not reporting") {
                silent.append(String(item.dropLast(" not reporting".count)))
            } else if item.hasSuffix(" reporting") {
                reporting += 1
            } else if let key = ["camera", "microphone", "fall detection", "sound detection"].first(where: { item.hasPrefix($0 + " ") }) {
                state[key] = String(item.dropFirst(key.count + 1))
            }
        }
        let words = ["up": "working", "down": "not working", "declined": "turned off at home",
                     "running": "running", "stopped": "stopped", "unplaced": "not set up"]
        func pair(_ a: String, _ b: String, both: String) -> String? {
            let sa = state[a].flatMap { $0 == "none" ? nil : (words[$0] ?? $0) }
            let sb = state[b].flatMap { $0 == "none" ? nil : (words[$0] ?? $0) }
            switch (sa, sb) {
            case let (x?, y?) where x == y: return "\(both) are \(x)."
            case let (x?, y?): return "\(Self.upperFirst(a)) is \(x), and \(b) is \(y)."
            case let (x?, nil): return "\(Self.upperFirst(a)) is \(x)."
            case let (nil, y?): return "\(Self.upperFirst(b)) is \(y)."
            default: return nil
            }
        }
        var out: [String] = []
        let total = reporting + silent.count
        if !silent.isEmpty {
            out.append("\(silent.joined(separator: " and ")) \(silent.count == 1 ? "isn't" : "aren't") reporting.")
        } else if total > 0 {
            out.append(total == 1 ? "The laptop is reporting." : (total == 2 ? "Both laptops are reporting." : "All \(total) laptops are reporting."))
        }
        out += [pair("camera", "microphone", both: "The camera and microphone"),
                pair("fall detection", "sound detection", both: "Fall and sound detection")].compactMap { $0 }
        return out.isEmpty ? nil : out.joined(separator: " ")
    }

    /// The newest alert other than `shown`, in one sentence.
    func latestAlert(besides shown: Alert?) -> String {
        guard let newest = alerts.first(where: { $0 != shown }) else {
            return shown == nil ? "No alerts have arrived in the last 24 hours." : ""
        }
        let head = "Latest alert: \(newest.what) \(Self.moment(newest.time, newest.age))"
        if newest.unanswered { return head + ", not answered yet." }
        if let answer = newest.answer {
            if answer.hasPrefix("marked a false alarm") { return head + ", marked a false alarm." }
            return head + (Self.stamp(answer).map { ", answered at \($0.time)." } ?? ", answered.")
        }
        return head + "."
    }
}

// MARK: Screen

/// The Debbie tab (owner direction 16:16; note 17 R12–R20): ask how your loved one is doing and get a short, plain answer.
/// The screen has one job, the conversation:
/// - Anything urgent sits above it, drawn by the app rather than the AI.
/// - The suggestions sit above the field.
/// - The bar steps aside while you type.
struct DebbieChatScreen: View {
    let model: AppModel
    let corner: CornerControls
    @Binding var composing: Bool
    let openAlert: (String) -> Void
    @State private var draft = ""
    @FocusState private var focused: Bool
    @Environment(\.motion) private var motion
    @Environment(\.dynamicTypeSize) private var typeSize
    private let bottomID = "bottom"
    /// At accessibility text sizes the title and the urgent row scroll with the conversation, so they never squeeze it out.
    private var stacked: Bool { typeSize.isAccessibilitySize }

    private var chat: DebbieChatModel { model.chat }
    private var urgent: [HubAlert] { model.alerts.filter { $0.severity == .urgent && $0.acknowledgedAt == nil } }

    /// Two short questions fit one row on every iPhone at the default text size, so none hides and the
    /// conversation keeps its room on the smallest screen. At larger sizes they wrap (`DFlow`).
    static let suggestions = ["How are they today?", "Any alerts?"]

    var body: some View {
        VStack(spacing: 0) {
            if !stacked {
                header.padding(.horizontal, Space.s20).padding(.vertical, Space.s8)
                if let alert = urgent.first { urgentRow(alert).padding(.horizontal, Space.s20).padding(.bottom, Space.s8) }
            }
            ScrollViewReader { proxy in
                ScrollView {
                    // A plain stack: a conversation is short, and every message stays in the accessibility tree.
                    VStack(alignment: .leading, spacing: Space.s12) {
                        if stacked {
                            header
                            if let alert = urgent.first { urgentRow(alert) }
                        }
                        Text(disclosure).font(DType.footnote).foregroundStyle(Color.dText2)
                            .fixedSize(horizontal: false, vertical: true)
                            .padding(.bottom, Space.s4)
                        ForEach(chat.messages) { message in
                            VStack(alignment: .leading, spacing: Space.s4) {
                                DChatBubble(text: message.text, fromDebbie: message.fromDebbie)
                                if message.onDevice && message.done {
                                    Text("Written on this iPhone from your home's data").font(DType.footnote).foregroundStyle(Color.dText2)
                                }
                            }
                            .id(message.id)
                            .transition(motion.reduce ? Motion.swap : Motion.arrive)
                        }
                        if chat.writing {
                            DTypingIndicator(words: chat.slow ? "Summarizing the latest from home…" : nil).transition(Motion.swap)
                        }
                        if let problem = chat.problem {
                            VStack(alignment: .leading, spacing: Space.s8) {
                                Text(problem.message).font(DType.body).foregroundStyle(Color.dText)
                                    .fixedSize(horizontal: false, vertical: true)
                                if problem.retryHelps {
                                    Button("Try Again") { chat.retry() }.buttonStyle(.debbie(.secondary, size: .regular))
                                        .accessibilityIdentifier("debbieRetry")
                                }
                            }
                            .transition(Motion.swap)
                        }
                        // At accessibility sizes the suggestions scroll with the conversation instead of pinning to the
                        // bottom, where with the field they'd fill the smallest screen.
                        if stacked && chat.showsSuggestions {
                            DFlow(spacing: Space.s8) {
                                ForEach(Self.suggestions, id: \.self) { s in DSuggestionChip(s) { chat.send(s) } }
                            }
                            .transition(Motion.swap)
                        }
                        Color.clear.frame(height: Space.s4).id(bottomID)
                    }
                    .padding(.horizontal, Space.s20)
                    .padding(.vertical, Space.s12)
                    .animation(motion.arriveAnimation, value: chat.messages.count)
                    .animation(motion.state, value: chat.writing)
                }
                .scrollDismissesKeyboard(.interactively)
                // At accessibility sizes one answer can be taller than the screen: open at the top, with the urgent row
                // and the start of her answer in view, and bring each new message in by its first line.
                .defaultScrollAnchor(stacked ? .top : .bottom)
                .defaultScrollAnchor(stacked ? .top : .bottom, for: .sizeChanges)
                .onChange(of: chat.messages.count) {
                    if stacked {
                        guard chat.messages.count > 1, let last = chat.messages.last else { return }
                        withAnimation(motion.scroll) { proxy.scrollTo(last.id, anchor: .top) }
                    } else {
                        withAnimation(motion.scroll) { proxy.scrollTo(bottomID, anchor: .bottom) }
                    }
                }
                .onChange(of: chat.writing) {
                    guard !stacked else { return }
                    withAnimation(motion.scroll) { proxy.scrollTo(bottomID, anchor: .bottom) }
                }
            }
        }
        .background(Color.dCanvas.ignoresSafeArea())
        .safeAreaInset(edge: .bottom) { bottom }
        .task { chat.greetIfNeeded() }
        .onChange(of: focused) { _, now in composing = now }
        .onDisappear { composing = false }
    }

    @ViewBuilder private var header: some View {
        let title = VStack(alignment: .leading, spacing: 0) {
            Text("Debbie").font(DType.title).foregroundStyle(Color.dText).accessibilityAddTraits(.isHeader)
                .fixedSize(horizontal: false, vertical: true)
            Text(chat.isGenerative ? "Care companion · AI" : "Care companion")
                .font(DType.secondary).foregroundStyle(Color.dText2)
                .fixedSize(horizontal: false, vertical: true)
        }
        if stacked {
            VStack(alignment: .leading, spacing: Space.s8) {
                HStack { DebbieAvatar(size: Size.avatarSmall); Spacer(minLength: Space.s8); corner }
                title
            }
        } else {
            HStack(spacing: Space.s12) {
                DebbieAvatar(size: Size.avatarSmall)
                title
                Spacer(minLength: Space.s8)
                corner
            }
        }
    }

    /// The app's own urgent row, so urgency never depends on the AI (note 17 R12). It's the first element after the title.
    private func urgentRow(_ alert: HubAlert) -> some View {
        // The title on its own line, then when: a narrow screen never starts a line with a stray "·".
        let words = HStack(alignment: .firstTextBaseline, spacing: Space.s12) {
            DIcon(CareCopy.icon(alert)).font(DType.headline).foregroundStyle(Color.dUrgentText)
            VStack(alignment: .leading, spacing: 0) {
                Text(CareCopy.title(alert)).font(DType.bodyStrong).foregroundStyle(Color.dText)
                    .fixedSize(horizontal: false, vertical: true)
                Text("\(alert.detectedAt.formatted(date: .omitted, time: .shortened)) · Not answered")
                    .font(DType.secondary).foregroundStyle(Color.dText2)
                    .fixedSize(horizontal: false, vertical: true)
            }
        }
        let open = Button("Open") { openAlert(alert.alertID) }
            .buttonStyle(.debbie(.secondary, size: .compact))
            .accessibilityIdentifier("debbieOpenUrgent")
        return Group {
            if stacked {
                VStack(alignment: .leading, spacing: Space.s12) { words; open }
            } else {
                HStack(alignment: .center, spacing: Space.s12) { words; Spacer(minLength: Space.s8); open }
            }
        }
        .frame(maxWidth: .infinity, alignment: .leading)
        .padding(Space.s12)
        .background(Color.dUrgentTint, in: RoundedRectangle(cornerRadius: Radius.r12, style: .continuous))
        .accessibilityElement(children: .combine)
        .accessibilityLabel("Urgent: \(CareCopy.title(alert)), noticed \(alert.detectedAt.formatted(date: .omitted, time: .shortened)), not answered")
    }

    private var disclosure: String {
        chat.isGenerative
            ? "Debbie writes her answers with AI (Google Gemini) from your home's data. She can be wrong. In an emergency, call emergency services."
            : "Debbie answers from your home's data. In an emergency, call emergency services."
    }

    private var bottom: some View {
        VStack(spacing: Space.s8) {
            if chat.showsSuggestions && !focused && !stacked {
                DFlow(spacing: Space.s8) {
                    ForEach(Self.suggestions, id: \.self) { s in DSuggestionChip(s) { chat.send(s) } }
                }
                .frame(maxWidth: .infinity, alignment: .leading)
                .padding(.horizontal, Space.s20)
                .transition(Motion.swap)
            }
            DChatComposer(text: $draft, placeholder: stacked ? "Ask Debbie" : "Ask about your loved one or the home", busy: chat.busy, focus: $focused,
                          onSend: { chat.send(draft); draft = "" }, onStop: { chat.stop() })
                .padding(.horizontal, Space.s20)
        }
        .padding(.vertical, Space.s8)
        .background(Color.dCanvas)
        .animation(motion.state, value: focused)
        .animation(motion.state, value: chat.showsSuggestions)
    }
}
