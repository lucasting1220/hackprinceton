import DebbieCore
import Foundation
import Security

/// Keychain storage shared with the Notification Service Extension (CRAFT.md §8 E7; research note 11a R8–R9).
/// Generic passwords, service `debbie.pairing`, the shared access group from Info.plist, readable after first
/// unlock, this device only, never synchronised. Values are never logged.
public struct SecureStore: Sendable {
    public enum Account: String, Sendable, CaseIterable {
        case phonePrivateKey = "phone-private-key", phoneKey = "phone-key", homeKey = "home-key"
        case deviceCredential = "device-credential", homeConfig = "home-config", seenAlerts = "seen-alerts"
    }
    public enum Failure: Error, Equatable, Sendable { case missingEntitlement, lockedBeforeFirstUnlock, notFound, unexpected(Int32) }

    public static let service = "debbie.pairing"
    public let accessGroup: String?

    public init(accessGroup: String? = Bundle.main.object(forInfoDictionaryKey: "DebbieKeychainAccessGroup") as? String) {
        self.accessGroup = accessGroup
    }

    private func base(_ account: Account) -> [String: Any] {
        var q: [String: Any] = [kSecClass as String: kSecClassGenericPassword,
                                kSecAttrService as String: Self.service,
                                kSecAttrAccount as String: account.rawValue]
        if let accessGroup { q[kSecAttrAccessGroup as String] = accessGroup }
        return q
    }

    private static func map(_ status: OSStatus) -> Failure {
        switch status {
        case -34018: .missingEntitlement
        case errSecInteractionNotAllowed: .lockedBeforeFirstUnlock
        case errSecItemNotFound: .notFound
        default: .unexpected(status)
        }
    }

    public func save(_ data: Data, as account: Account) throws(Failure) {
        let q = base(account)
        SecItemDelete(q as CFDictionary)
        var add = q
        add[kSecValueData as String] = data
        add[kSecAttrAccessible as String] = kSecAttrAccessibleAfterFirstUnlockThisDeviceOnly
        let status = SecItemAdd(add as CFDictionary, nil)
        guard status == errSecSuccess else { throw Self.map(status) }
    }

    public func load(_ account: Account) throws(Failure) -> Data {
        var q = base(account)
        q[kSecReturnData as String] = true
        q[kSecMatchLimit as String] = kSecMatchLimitOne
        var out: CFTypeRef?
        let status = SecItemCopyMatching(q as CFDictionary, &out)
        guard status == errSecSuccess, let data = out as? Data else { throw Self.map(status) }
        return data
    }

    /// Unpair: deletes every Debbie item in the group, including the extension's (brief §5.1.8).
    public func deleteAll() {
        for account in Account.allCases { SecItemDelete(base(account) as CFDictionary) }
    }
}

/// What a paired phone keeps (secrets live in separate Keychain items; this is the non-secret config).
/// What the networking layer needs from the Keychain store. Tests give the service a store held in memory, so they can
/// drive its real requests without the Keychain (UnpairRouteTests).
public protocol PairingStore: Sendable {
    func save(_ data: Data, as account: SecureStore.Account) throws(SecureStore.Failure)
    func load(_ account: SecureStore.Account) throws(SecureStore.Failure) -> Data
    func deleteAll()
}

extension SecureStore: PairingStore {}

public struct HomeConfig: Codable, Sendable, Equatable {
    public let homeID: String
    public let deviceID: String
    public let role: Role
    public let homeName: String
    public let relayURL: String
    public var lanAddrs: [String]
    public let hubPub: String
    public let pairedAt: Date
    public init(homeID: String, deviceID: String, role: Role, homeName: String, relayURL: String, lanAddrs: [String], hubPub: String, pairedAt: Date) {
        self.homeID = homeID; self.deviceID = deviceID; self.role = role; self.homeName = homeName
        self.relayURL = relayURL; self.lanAddrs = lanAddrs; self.hubPub = hubPub; self.pairedAt = pairedAt
    }
}
