import Foundation

// Debbie, the care companion (owner direction 16:16; D-031). It turns the home's state into short, plain answers.
// - GeminiAssistant (DebbieNetworking) writes them with Google Gemini.
// - OfflineAssistant (DebbieFeatures) writes a plain summary on the phone when there is no key or no network.

/// One turn of the conversation, in the order it happened.
public struct ChatTurn: Sendable, Equatable {
    public enum Role: String, Sendable { case caregiver = "user", debbie = "model" }
    public let role: Role
    public let text: String
    public init(role: Role, text: String) { self.role = role; self.text = text }
}

/// Writes Debbie's reply, streamed in pieces.
public protocol AssistantService: Sendable {
    /// Whether replies come from a generative model, so the screen can say so (HIG Generative AI; research note 17).
    var isGenerative: Bool { get }
    /// - Parameters:
    ///   - instructions: who Debbie is and how she answers.
    ///   - homeData: the home's current state as plain text, the only facts she may use.
    ///   - conversation: every turn so far, ending with the caregiver's question.
    func reply(instructions: String, homeData: String, conversation: [ChatTurn]) -> AsyncThrowingStream<String, Error>
}

/// Why Debbie couldn't answer. Each case has words for the caregiver; none of them carries a key or a response body.
public enum AssistantError: Error, Equatable, Sendable {
    case notConfigured, offline, rateLimited, rejectedKey, unavailable, blocked, slow, server(Int), malformed

    public var message: String {
        switch self {
        case .notConfigured: "Debbie's answers aren't set up in this build."
        case .offline: "Debbie can't reach the internet right now. Check your connection, then try again."
        case .rateLimited: "Debbie has had a lot of questions. Wait a minute, then try again."
        case .rejectedKey: "Debbie's AI service didn't accept this build's key."
        case .unavailable: "Debbie's AI service isn't available to this build right now."
        case .blocked: "Debbie can't answer that one. Try one of these:"
        case .slow: "Debbie is taking longer than usual. Try again in a moment."
        case .server: "Debbie's AI service had a problem. Try again in a moment."
        case .malformed: "Debbie's answer didn't come through properly. Try again."
        }
    }

    /// Whether asking again could work. It can't for a refusal, or for a build without a working key or model.
    public var retryHelps: Bool {
        switch self {
        case .blocked, .notConfigured, .rejectedKey, .unavailable: false
        case .offline, .rateLimited, .slow, .server, .malformed: true
        }
    }
}
