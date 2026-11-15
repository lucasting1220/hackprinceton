import CryptoKit
import DebbieCore
import Foundation

/// Phone ↔ hub cryptography, exactly as the Layer 1 doc specifies (CONTRACTS.md §2).
/// X25519, HKDF-SHA256, HMAC-SHA256 and ChaCha20-Poly1305 from CryptoKit; nothing invented.
public enum ContractCrypto {
    public enum Failure: Error, Equatable, Sendable { case badKey, lowOrderPoint, badEnvelope, authenticationFailed }

    // MARK: Keys

    public static func newPrivateKey() -> Curve25519.KeyAgreement.PrivateKey { .init() }

    public static func publicKey(fromBase64URL s: String) throws(Failure) -> Curve25519.KeyAgreement.PublicKey {
        guard let raw = Base64URL.decode(s), raw.count == 32,
              let key = try? Curve25519.KeyAgreement.PublicKey(rawRepresentation: raw) else { throw .badKey }
        return key
    }

    /// `shared = X25519(phone, hub)`; an all-zero result (low-order point) is rejected.
    public static func sharedSecret(_ priv: Curve25519.KeyAgreement.PrivateKey,
                                    _ pub: Curve25519.KeyAgreement.PublicKey) throws(Failure) -> Data {
        guard let secret = try? priv.sharedSecretFromKeyAgreement(with: pub) else { throw .lowOrderPoint }
        let raw = secret.withUnsafeBytes { Data($0) }
        guard raw.contains(where: { $0 != 0 }) else { throw .lowOrderPoint }
        return raw
    }

    // MARK: Pairing

    /// `proof = HMAC-SHA256(secret, phone_pub ‖ role ‖ 0x00 ‖ NFC(name))`.
    public static func proof(secret: Data, phonePublic: Data, role: Role, name: String) -> Data {
        var msg = Data()
        msg.append(phonePublic)
        msg.append(contentsOf: Array(role.rawValue.utf8))
        msg.append(0)
        msg.append(contentsOf: Array(name.precomposedStringWithCanonicalMapping.utf8))
        return Data(HMAC<SHA256>.authenticationCode(for: msg, using: SymmetricKey(data: secret)))
    }

    /// `phone_key = HKDF-SHA256(shared, salt = secret, info = "debbie/v1/phone-key", 32)`.
    public static func phoneKey(shared: Data, secret: Data) -> SymmetricKey {
        HKDF<SHA256>.deriveKey(inputKeyMaterial: SymmetricKey(data: shared), salt: secret,
                               info: Data("debbie/v1/phone-key".utf8), outputByteCount: 32)
    }

    /// 4-digit code: first 4 bytes of `HKDF(shared, secret, "debbie/v1/code", 4)` as big-endian, mod 10000.
    public static func pairingCode(shared: Data, secret: Data) -> String {
        let key = HKDF<SHA256>.deriveKey(inputKeyMaterial: SymmetricKey(data: shared), salt: secret,
                                         info: Data("debbie/v1/code".utf8), outputByteCount: 4)
        let bytes = key.withUnsafeBytes { Array($0) }
        let value = bytes.reduce(UInt32(0)) { ($0 << 8) | UInt32($1) }
        return String(format: "%04u", value % 10_000)
    }

    // MARK: Envelopes

    /// Associated data: `debbie/v1/{home_id}/{kid}/{type}`, or `debbie/v1/pair` during pairing.
    public static func associatedData(homeID: String?, kid: String, type: String) -> Data {
        kid == "pair" ? Data("debbie/v1/pair".utf8) : Data("debbie/v1/\(homeID ?? "")/\(kid)/\(type)".utf8)
    }

    public static func seal(_ plaintext: Data, key: SymmetricKey, kid: String, homeID: String?, type: String,
                            nonce: ChaChaPoly.Nonce = .init()) throws(Failure) -> Envelope {
        guard let box = try? ChaChaPoly.seal(plaintext, using: key, nonce: nonce,
                                             authenticating: associatedData(homeID: homeID, kid: kid, type: type)) else { throw .badEnvelope }
        // combined = nonce ‖ ciphertext ‖ tag; the envelope splits off the 12-byte nonce.
        let combined = box.combined
        return Envelope(kid: kid, n: Base64URL.encode(combined.prefix(12)), c: Base64URL.encode(combined.dropFirst(12)))
    }

    public static func open(_ envelope: Envelope, key: SymmetricKey, homeID: String?, type: String) throws(Failure) -> Data {
        guard envelope.v == 1, let n = Base64URL.decode(envelope.n), n.count == 12,
              let c = Base64URL.decode(envelope.c), c.count >= 16,
              let box = try? ChaChaPoly.SealedBox(combined: n + c) else { throw .badEnvelope }
        guard let plain = try? ChaChaPoly.open(box, using: key,
                                               authenticating: associatedData(homeID: homeID, kid: envelope.kid, type: type)) else {
            throw .authenticationFailed
        }
        return plain
    }

    /// SHA-256 of the credential's UTF-8 bytes, lowercase hex (CONTRACTS.md §5).
    public static func credentialHash(_ credential: String) -> String {
        SHA256.hash(data: Data(credential.utf8)).map { String(format: "%02x", $0) }.joined()
    }
}

public extension SymmetricKey {
    /// Raw bytes, for Keychain storage only (never logged).
    var rawData: Data { withUnsafeBytes { Data($0) } }
}
