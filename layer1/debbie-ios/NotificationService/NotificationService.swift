import CryptoKit
import DebbieCore
import DebbieCrypto
import DebbieSecureStore
import Foundation
import UserNotifications

/// Decrypts the pushed alert so the notification says what happened (brief §5.1.3). One synchronous path,
/// the renderer is a pure function (unit-tested), and every failure keeps safe generic text (research note 11a R11).
nonisolated final class NotificationService: UNNotificationServiceExtension {
    private var contentHandler: ((UNNotificationContent) -> Void)?
    private var best: UNMutableNotificationContent?

    override func didReceive(_ request: UNNotificationRequest, withContentHandler contentHandler: @escaping (UNNotificationContent) -> Void) {
        self.contentHandler = contentHandler
        guard let content = request.content.mutableCopy() as? UNMutableNotificationContent else { contentHandler(request.content); return }
        best = content
        let store = SecureStore()
        let homeKey = (try? store.load(.homeKey)).map { SymmetricKey(data: $0) }
        let homeID = (try? store.load(.homeConfig)).flatMap { try? JSONDecoder.debbie.decode(HomeConfig.self, from: $0) }?.homeID
        let payload = (request.content.userInfo["debbie"] as? [String: Any]) ?? [:]
        let r = NotificationRenderer.render(payload: payload, homeKey: homeKey, homeID: homeID, alreadyShown: { _ in false },
                                            now: .now, timeZone: .current, locale: .current)
        content.title = r.title
        content.subtitle = r.subtitle
        content.body = r.body
        content.threadIdentifier = r.threadID
        content.categoryIdentifier = r.category
        content.interruptionLevel = switch r.level { case .timeSensitive: .timeSensitive; case .active: .active; case .passive: .passive }
        if r.silent { content.sound = nil }
        deliver()
    }

    override func serviceExtensionTimeWillExpire() {
        if let best {
            best.title = NotificationRenderer.fallback.title
            best.body = NotificationRenderer.fallback.body
        }
        deliver()
    }

    private func deliver() {
        guard let handler = contentHandler, let best else { return }
        contentHandler = nil
        handler(best)
    }
}
