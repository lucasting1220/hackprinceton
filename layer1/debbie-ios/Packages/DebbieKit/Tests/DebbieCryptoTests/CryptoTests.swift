import CryptoKit
import DebbieCore
@testable import DebbieCrypto
import Foundation
import Testing

@Suite struct ContractCryptoTests {
    @Test func envelopeRoundTripAndTamper() throws {
        let key = SymmetricKey(size: .bits256)
        let env = try ContractCrypto.seal(Data("{\"a\":1}".utf8), key: key, kid: "home", homeID: "h1", type: "alert")
        #expect(try ContractCrypto.open(env, key: key, homeID: "h1", type: "alert") == Data("{\"a\":1}".utf8))
        // Relabelling the type (associated data) must fail.
        #expect(throws: ContractCrypto.Failure.authenticationFailed) { try ContractCrypto.open(env, key: key, homeID: "h1", type: "status") }
        // A different home must fail.
        #expect(throws: ContractCrypto.Failure.authenticationFailed) { try ContractCrypto.open(env, key: key, homeID: "h2", type: "alert") }
    }

    @Test func pairingAgreesOnBothSides() throws {
        let phone = Curve25519.KeyAgreement.PrivateKey(), hub = Curve25519.KeyAgreement.PrivateKey()
        let secret = Data((0..<16).map { UInt8($0) })
        let a = try ContractCrypto.sharedSecret(phone, hub.publicKey), b = try ContractCrypto.sharedSecret(hub, phone.publicKey)
        #expect(a == b)
        #expect(ContractCrypto.pairingCode(shared: a, secret: secret) == ContractCrypto.pairingCode(shared: b, secret: secret))
        #expect(ContractCrypto.pairingCode(shared: a, secret: secret).count == 4)
    }

    @Test func rejectsAllZeroSharedSecret() throws {
        let phone = Curve25519.KeyAgreement.PrivateKey()
        let lowOrder = try Curve25519.KeyAgreement.PublicKey(rawRepresentation: Data(repeating: 0, count: 32))
        #expect(throws: ContractCrypto.Failure.lowOrderPoint) { _ = try ContractCrypto.sharedSecret(phone, lowOrder) }
    }

    @Test func proofNormalisesNameToNFC() {
        let secret = Data(repeating: 7, count: 16), pub = Data(repeating: 9, count: 32)
        let composed = ContractCrypto.proof(secret: secret, phonePublic: pub, role: .caregiver, name: "Mam\u{00E1}")
        let decomposed = ContractCrypto.proof(secret: secret, phonePublic: pub, role: .caregiver, name: "Mama\u{0301}")
        #expect(composed == decomposed)
    }
}

/// Generates docs/contracts/vectors.json from fixed inputs (CONTRACTS.md §10) and checks the committed file.
@Suite struct VectorTests {
    static func fixedKey(_ byte: UInt8) throws -> Curve25519.KeyAgreement.PrivateKey {
        try Curve25519.KeyAgreement.PrivateKey(rawRepresentation: Data(repeating: byte, count: 32))
    }

    static func vectors() throws -> [String: Any] {
        let b = Base64URL.encode
        let phone = try fixedKey(0x11), hub = try fixedKey(0x22), resident = try fixedKey(0x33)
        let secret = Data((0..<16).map { UInt8($0 * 3) })
        let shared = try ContractCrypto.sharedSecret(phone, hub.publicKey)
        let sharedR = try ContractCrypto.sharedSecret(resident, hub.publicKey)
        func pairing(_ name: String, _ pk: Curve25519.KeyAgreement.PrivateKey, _ sh: Data, role: Role, device: String) -> [String: Any] {
            ["name": name, "secret": b(secret), "phone_public": b(pk.publicKey.rawRepresentation), "role": role.rawValue,
             "device_name": device, "proof": b(ContractCrypto.proof(secret: secret, phonePublic: pk.publicKey.rawRepresentation, role: role, name: device)),
             "shared": b(sh), "phone_key": b(ContractCrypto.phoneKey(shared: sh, secret: secret).rawData),
             "code": ContractCrypto.pairingCode(shared: sh, secret: secret)]
        }
        func env(_ name: String, key: Data, nonceByte: UInt8, homeID: String, kid: String, type: String, plaintext: String) throws -> [String: Any] {
            let nonce = try ChaChaPoly.Nonce(data: Data(repeating: nonceByte, count: 12))
            let e = try ContractCrypto.seal(Data(plaintext.utf8), key: SymmetricKey(data: key), kid: kid, homeID: homeID, type: type, nonce: nonce)
            return ["name": name, "key": b(key), "nonce": b(Data(repeating: nonceByte, count: 12)), "home_id": homeID, "kid": kid, "type": type,
                    "ad": String(decoding: ContractCrypto.associatedData(homeID: homeID, kid: kid, type: type), as: UTF8.self),
                    "plaintext": plaintext, "envelope": ["v": 1, "kid": e.kid, "n": e.n, "c": e.c]]
        }
        let homeKey = Data((0..<32).map { UInt8(255 - $0) })
        let phoneKey = ContractCrypto.phoneKey(shared: shared, secret: secret).rawData
        let homeID = "7a8e0c4e-5f1d-4c39-9d7e-1b2a3c4d5e6f", deviceID = "0f9e8d7c-6b5a-4938-8271-605f4e3d2c1b"
        return [
            "v": 1, "generated_by": "DebbieCryptoTests/VectorTests",
            "x25519": [["name": "phone-hub", "phone_private": b(phone.rawRepresentation), "hub_private": b(hub.rawRepresentation),
                        "phone_public": b(phone.publicKey.rawRepresentation), "hub_public": b(hub.publicKey.rawRepresentation), "shared": b(shared)]],
            "pairing": [pairing("caregiver", phone, shared, role: .caregiver, device: "Caregiver's iPhone"),
                        pairing("resident-non-ascii", resident, sharedR, role: .resident, device: "Mam\u{00E1}'s iPhone")],
            "envelopes": [
                try env("alert-home-key", key: homeKey, nonceByte: 1, homeID: homeID, kid: "home", type: "alert",
                        plaintext: #"{"alert_id":"a1","body":"Debbie asked \"Are you okay?\" and heard no answer.","detected_at":"2026-11-14T15:12:03Z","kind":"fall","msg_id":"m1","sent_at":"2026-11-14T15:12:04Z","severity":"urgent","title":"Possible fall","type":"alert","update":false}"#),
                try env("heartbeat-home-key", key: homeKey, nonceByte: 2, homeID: homeID, kid: "home", type: "heartbeat",
                        plaintext: #"{"msg_id":"m2","sent_at":"2026-11-14T15:13:00Z","type":"heartbeat"}"#),
                try env("ack-phone-key", key: phoneKey, nonceByte: 3, homeID: homeID, kid: deviceID, type: "ack",
                        plaintext: #"{"acked_at":"2026-11-14T15:14:00Z","alert_id":"a1","false_alarm":false,"msg_id":"m3","sent_at":"2026-11-14T15:14:00Z","type":"ack"}"#),
                try env("pairing-bundle", key: phoneKey, nonceByte: 4, homeID: homeID, kid: "pair", type: "pair",
                        plaintext: #"{"device_id":"0f9e8d7c-6b5a-4938-8271-605f4e3d2c1b","home_id":"7a8e0c4e-5f1d-4c39-9d7e-1b2a3c4d5e6f","msg_id":"m0","role":"caregiver","sent_at":"2026-11-14T15:10:00Z","v":1}"#),
            ],
            "credential_hash": [["credential": "dGVzdC1jcmVkZW50aWFs", "sha256_hex": ContractCrypto.credentialHash("dGVzdC1jcmVkZW50aWFs")]],
        ]
    }

    @Test func generateOrVerifyVectors() throws {
        let data = try JSONSerialization.data(withJSONObject: try Self.vectors(), options: [.prettyPrinted, .sortedKeys, .withoutEscapingSlashes])
        let url = URL(fileURLWithPath: #filePath).deletingLastPathComponent().appendingPathComponent("../../../../docs/contracts/vectors.json").standardized
        if ProcessInfo.processInfo.environment["DEBBIE_WRITE_VECTORS"] == "1" || !FileManager.default.fileExists(atPath: url.path) {
            try data.write(to: url)
        }
        #expect(try Data(contentsOf: url) == data, "docs/contracts/vectors.json is out of date; rerun with DEBBIE_WRITE_VECTORS=1")
    }
}
