import CryptoKit
import DebbieCore
import Foundation

/// What the Notification Service Extension shows. A pure function so it is unit-tested without a device
/// (research note 11a R14; CRAFT.md §8 E11). Tiers and copy: CONTRACTS.md §8, lead decisions X33/X34.
public struct RenderedNotification: Equatable, Sendable {
    public enum Level: String, Sendable { case passive, active, timeSensitive }
    public var title: String
    public var subtitle: String
    public var body: String
    public var level: Level
    public var threadID: String
    public var category: String
    public var silent: Bool
    public var alertID: String?
}

public enum NotificationRenderer {
    public static let fallback = RenderedNotification(
        title: "Alert from Home", subtitle: "", body: "Open Debbie to see what happened.",
        level: .timeSensitive, threadID: "alerts", category: "debbie.urgent", silent: false, alertID: nil)

    /// - Parameters:
    ///   - payload: the push's `debbie` dictionary.
    ///   - homeKey/homeID: from the shared Keychain (nil when locked before first unlock or unpaired).
    ///   - alreadyShown: true when the same `alert_id` is still delivered, or is in the app's seen set (X33).
    public static func render(payload: [String: Any], homeKey: SymmetricKey?, homeID: String?,
                              alreadyShown: (String) -> Bool, now: Date, timeZone: TimeZone, locale: Locale) -> RenderedNotification {
        let type = (payload["type"] as? String) ?? ""
        if type == "hub_offline" || type == "back_online" {
            let t = (payload["last_contact"] as? Double).map { Date(timeIntervalSince1970: $0) }
            let time = t.map { clock($0, timeZone: timeZone, locale: locale) }
            if type == "hub_offline" {
                return RenderedNotification(title: "Can't Reach Home", subtitle: time.map { "Since \($0)" } ?? "",
                                            body: time.map { "Debbie hasn't heard from home since \($0)." } ?? "Debbie can't reach home right now.",
                                            level: .active, threadID: "home-status", category: "debbie.attention", silent: false, alertID: nil)
            }
            return RenderedNotification(title: "Home Is Back Online", subtitle: clock(now, timeZone: timeZone, locale: locale),
                                        body: "Debbie is hearing from home again.", level: .passive, threadID: "home-status",
                                        category: "debbie.info", silent: true, alertID: nil)
        }
        guard let key = homeKey, let homeID,
              let w = payload["w"], JSONSerialization.isValidJSONObject(w),
              let data = try? JSONSerialization.data(withJSONObject: w),
              let wrapper = try? JSONDecoder.debbie.decode(Wrapper.self, from: data), wrapper.type == "alert",
              let plain = try? ContractCrypto.open(wrapper.envelope, key: key, homeID: homeID, type: "alert"),
              let alert = try? JSONDecoder.debbie.decode(HubAlert.self, from: plain) else {
            return fallback
        }
        let place = "\(clock(alert.detectedAt, timeZone: timeZone, locale: locale))"
        var r = RenderedNotification(title: title(for: alert), subtitle: place, body: alert.body,
                                     level: level(for: alert.severity), threadID: alert.severity == .urgent ? "alerts" : "home-status",
                                     category: "debbie.\(alert.severity.rawValue)", silent: false, alertID: alert.alertID)
        if alert.update && alreadyShown(alert.alertID) { r.level = .passive; r.silent = true }
        return r
    }

    /// App-owned titles for known kinds (title case, CRAFT.md §6 V2/V4); the hub's title otherwise.
    public static func title(for alert: HubAlert) -> String {
        switch alert.kind {
        case .fall: "Possible Fall"
        case .callForHelp: "Possible Call for Help"
        case .noMovement: "No Movement Noticed"
        case .sound: "Possible Sound of Concern"
        case .heartRateHigh: "Heart Rate Higher Than Usual"
        case .heartRateLow: "Heart Rate Lower Than Usual"
        case .checkIn, .other: String(alert.title.prefix(30))
        }
    }

    public static func level(for severity: Severity) -> RenderedNotification.Level {
        switch severity { case .urgent: .timeSensitive; case .attention: .active; case .info: .passive }
    }

    static func clock(_ date: Date, timeZone: TimeZone, locale: Locale) -> String {
        let f = DateFormatter(); f.locale = locale; f.timeZone = timeZone; f.dateStyle = .none; f.timeStyle = .short
        return f.string(from: date)
    }
}
