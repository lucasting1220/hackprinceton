import DebbieCore
import Foundation

/// Debbie's replies from the home: the question goes to the hub as a `request` with kind `ask`, and Layer 4 answers it
/// with the home's own Ollama model from the live status (phone-hub.md §3). Nothing leaves the home but the question.
public struct HomeAssistant: AssistantService {
    let ask: @Sendable (String) async throws -> String

    /// - Parameter ask: sends one question to the home and returns its answer (`HomeService.ask`).
    public init(ask: @escaping @Sendable (String) async throws -> String) {
        self.ask = ask
    }

    public var isGenerative: Bool { true }

    /// The home's reply wait, plus time for the request itself to reach the hub.
    public var answerLimit: Duration { NetworkHomeService.replyWait + .seconds(15) }

    /// Only the caregiver's latest question goes to the home: Layer 4 answers from its own live status, so the phone's
    /// home data and the instructions stay on the phone.
    public func reply(instructions: String, homeData: String, conversation: [ChatTurn]) -> AsyncThrowingStream<String, Error> {
        let question = conversation.last { $0.role == .caregiver }?.text ?? ""
        let ask = self.ask
        return AsyncThrowingStream { continuation in
            let task = Task {
                do {
                    continuation.yield(try await ask(question))
                    continuation.finish()
                } catch {
                    continuation.finish(throwing: Self.assistantError(error))
                }
            }
            continuation.onTermination = { _ in task.cancel() }
        }
    }

    /// The words the chat shows for a failure. A cancelled ask stays a cancellation, so the chat shows nothing.
    static func assistantError(_ error: Error) -> Error {
        switch error {
        case let error as AssistantError:
            return error
        case is CancellationError:
            return CancellationError()
        case let error as URLError:
            return error.code == .cancelled ? CancellationError() : AssistantError.offline
        case let error as HomeError where error == .removed || error == .notPaired:
            return AssistantError.notConfigured
        default:
            return AssistantError.server(503)
        }
    }
}
