// Debbie's sample on-device answers for DesignerKit/12-copy-and-demo/voice-and-copy.md.
//
// Not runnable on its own: tools/design/kit/screens.sh pipes this file to `swift -` with the app's own
// `OfflineAssistant` and `HomeFacts` (Packages/DebbieKit/Sources/DebbieFeatures/DebbieChat.swift) pasted in at the
// marker line below, so every answer is the app's real wording, never a copy typed by hand.
//
// The home's data is built the way `AppModel.homeDataForDebbie` builds it (DebbieChatModel.swift), from the demo
// home's sample data and timings (App/DemoHome/DemoHomeService.swift):
// - the demo clock starts at Try the Demo; Home's first update (at about 20 s) creates both alerts: the possible fall
//   noticed 20 s before, and "No movement noticed" noticed 14 min before, arriving late;
// - Home updates every 10 s; each update says monitoring was confirmed 5 s before, the heart rate (72, steady) was
//   measured 5 min before, and from 60 s to 90 s after Try the Demo the kitchen laptop isn't reporting (since 40 s
//   before each update).
// Output: Markdown on stdout. A mismatch with the 12-debbie screenshot is reported on stderr.

import Foundation

// Stand-ins for the two DebbieCore types the pasted code names (DebbieCore/Assistant.swift).
public struct ChatTurn: Sendable {
    public enum Role: Sendable { case caregiver, debbie }
    public let role: Role
    public let text: String
}

public protocol AssistantService: Sendable {
    var isGenerative: Bool { get }
    func reply(instructions: String, homeData: String, conversation: [ChatTurn]) -> AsyncThrowingStream<String, Error>
}

// @@OFFLINE_ASSISTANT@@

// MARK: The demo's clock (example: Try the Demo at 7:02 PM on 14 Nov 2026)

var calendar = Calendar(identifier: .gregorian)
calendar.timeZone = TimeZone(identifier: "America/New_York")!
let tryTheDemo = calendar.date(from: DateComponents(year: 2026, month: 11, day: 14, hour: 19, minute: 2, second: 0))!
func at(_ seconds: Double) -> Date { tryTheDemo.addingTimeInterval(seconds) }
let clockStyle = Date.FormatStyle(date: .omitted, time: .shortened, locale: Locale(identifier: "en_US"),
                                  calendar: calendar, timeZone: calendar.timeZone)

struct DemoAlert {
    let severity: String
    let title: String
    let detected: Date
    let received: Date
    var acknowledged: Date?
    let body: String
    var open: Bool { acknowledged == nil && severity != "info" }
    var isLate: Bool { received.timeIntervalSince(detected) >= 60 }
}

/// The two alerts the demo's first update creates (DemoHomeService.refresh), with CareCopy's titles.
let homeOpens: Double = 20
let fall = DemoAlert(severity: "urgent", title: "Possible fall", detected: at(homeOpens - 20), received: at(homeOpens),
                     body: "Sample data: Debbie asked \"Are you okay?\" in the living room and heard no answer.")
let noMovement = DemoAlert(severity: "attention", title: "No movement noticed", detected: at(homeOpens - 14 * 60),
                           received: at(homeOpens), body: "Sample data: no movement in the kitchen for 2 hours.")

/// The `<home_data>` block, line for line as `homeDataForDebbie` writes it, for a question asked at `asked` seconds,
/// after Home's last update at `update` seconds.
func homeData(asked: Double, update: Double, alerts: [DemoAlert]) -> String {
    let now = at(asked)
    func clock(_ d: Date) -> String { d.formatted(clockStyle) }
    func age(_ d: Date) -> String {
        let minutes = max(0, Int(now.timeIntervalSince(d) / 60))
        let span = minutes < 1 ? "just now" : (minutes < 60 ? "\(minutes) min ago" : "\(minutes / 60) h \(minutes % 60) min ago")
        return " (\(span))"
    }
    let degraded = (60..<90).contains(update)
    let contact = at(update - 5), heart = at(update - 300)
    var lines = ["<home_data now=\"\(now.formatted(.dateTime.weekday(.wide).day().month(.wide).year().hour().minute()))\" demo=\"yes\">"]
    lines.append("connection: home last in touch \(clock(contact))\(age(contact))")
    if degraded {
        let since = at(update - 40)
        lines.append("monitoring: limited since \(clock(since))\(age(since)): Kitchen laptop not reporting")
    } else {
        lines.append("monitoring: on, confirmed \(clock(contact))\(age(contact))")
    }
    lines.append("sensors: Kitchen laptop \(degraded ? "not reporting" : "reporting"); Living room laptop reporting; "
                 + "camera up; microphone up; fall detection running; sound detection running")
    lines.append("heart_rate: 72 beats a minute, steady, measured \(clock(heart))\(age(heart))")
    let unanswered = alerts.filter(\.open)
    let others = alerts.filter { !$0.open && now.timeIntervalSince($0.detected) < 86_400 }
        .sorted { $0.detected > $1.detected }.prefix(max(0, 10 - unanswered.count))
    let recent = (unanswered + others).sorted { $0.detected > $1.detected }
    if recent.isEmpty {
        lines.append("alerts: none in the last 24 h")
    } else {
        lines.append("alerts, newest first:")
        for a in recent {
            var s = "- \(a.severity) | \(a.title) | noticed \(clock(a.detected))\(age(a.detected))"
            if a.isLate { s += " | arrived late \(clock(a.received))" }
            if let ack = a.acknowledged { s += " | acknowledged \(clock(ack))" } else if a.severity != "info" { s += " | not acknowledged" }
            if !a.body.isEmpty { s += " | \(a.body)" }
            lines.append(s)
        }
    }
    lines.append("</home_data>")
    return lines.joined(separator: "\n")
}

// MARK: Three moments, six questions

var fallAnswered = fall
fallAnswered.acknowledged = at(50)
let moments: [(key: String, data: String)] = [
    ("A", homeData(asked: 45, update: 40, alerts: [fall, noMovement])),
    ("B", homeData(asked: 125, update: 120, alerts: [fallAnswered, noMovement])),
    ("C", homeData(asked: 75, update: 70, alerts: [fallAnswered, noMovement])),
]

/// iOS writes times with a narrow no-break space ("7:02 PM"); the kit's tables use a plain space.
func plain(_ s: String) -> String { s.replacingOccurrences(of: "\u{202F}", with: " ") }

let questions: [(heading: String, note: String, asked: [String])] = [
    ("Her opening update, and “How are they today?”",
     "Topic: overview. The opening update is asked for her the first time the Debbie tab opens (“How is my loved one doing right now?”, not shown). “How are they today?” is the first suggestion chip and gets the same answer.",
     ["How is my loved one doing right now?", "How are they today?"]),
    ("“Any alerts?”", "Topic: alerts. The second suggestion chip.", ["Any alerts?"]),
    ("“How's the heart rate?”", "Topic: heart rate. Typed (TestFlight's What to Test suggests it). Any question with “heart”, “pulse” or “bpm” gets this.", ["How's the heart rate?"]),
    ("“Is everything working at home?”", "Topic: working. Typed (What to Test suggests it). Words like “working”, “monitoring”, “camera”, “laptop”, “sensor”, “online”, “connected” get this.", ["Is everything working at home?"]),
    ("“She isn't answering her phone. Is she okay?”", "Topic: worried. Typed. Worried words (“isn't answering”, “not responding”, “fell”, “hurt”, “pain”, “scared”, “emergency”, “heart attack”…) put the emergency advice first.", ["She isn't answering her phone. Is she okay?"]),
]

var out: [String] = []
out.append("_Generated by `tools/design/kit/screens.sh`, which runs the app's own on-device wording (`OfflineAssistant` in `Packages/DebbieKit/Sources/DebbieFeatures/DebbieChat.swift`) on the demo home's data (`App/DemoHome/DemoHomeService.swift`). Example clock: Try the Demo at 7:02 PM. In the app every time and age follows the phone's clock. Under each answer the app adds the footnote “Written on this iPhone from your home's data”._")
out.append("")
out.append("| Moment | When, after Try the Demo | What the home's data says |")
out.append("|---|---|---|")
out.append("| **A.** Home has just opened | from Home's first update (about 20 s), before I'm On It and before the limited window | Both alerts unanswered. Monitoring on. Heart rate 72, steady, measured 5 min before |")
out.append("| **B.** After **I'm On It** on the possible fall | any time outside the limited window | The fall answered at 7:02 PM. “No movement noticed” still unanswered. Monitoring on |")
out.append("| **C.** After I'm On It, while the kitchen laptop isn't reporting | the demo's limited window, about 60 to 100 s | As B, but monitoring is limited: the kitchen laptop isn't reporting |")
for q in questions {
    out.append("")
    out.append("#### \(q.heading)")
    out.append("_\(q.note)_")
    out.append("")
    for m in moments {
        let answers = q.asked.map { plain(OfflineAssistant.summary(from: m.data, question: $0)) }
        out.append("- **\(m.key).** \(answers[0])")
        if Set(answers).count > 1 { out.append("  - For “\(q.asked[1])”: \(answers[1])") }
    }
}
print(out.joined(separator: "\n"))

// The 12-debbie screenshots (Design/reviews/screens/raw/SE-light-default, 19:04) show moment A's opening update.
let screenshot = "An urgent alert hasn't been answered: possible fall at 7:02 PM. Open it on the Home tab, or call your loved one. Monitoring is on, confirmed just now. The latest heart rate is 72 beats a minute, steady, measured 5 min ago."
if plain(OfflineAssistant.summary(from: moments[0].data, question: questions[0].asked[0])) != screenshot {
    FileHandle.standardError.write("warning: Debbie's on-device wording no longer matches the 12-debbie screenshots; re-take them (tools/screens/tour.sh) and re-run this script.\n".data(using: .utf8)!)
}
