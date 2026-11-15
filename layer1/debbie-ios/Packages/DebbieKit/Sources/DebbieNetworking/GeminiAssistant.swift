import DebbieCore
import Foundation

/// Debbie's replies from Google Gemini (D-031; research note 17 R1–R5). TestFlight only.
/// - Owner's decisions (16:16): the key is built into the build, and the home's data is sent without a consent step.
/// - Request: `v1` `streamGenerateContent?alt=sse`, with the key in the `x-goog-api-key` header, so it never appears in a
///   URL, a log or a crash report.
/// - The system instruction never changes. The home's data travels as one `<home_data>` block in the latest user turn.
public struct GeminiAssistant: AssistantService {
    /// Models Debbie may use, with the thinking level each needs (note 17 R1). Any other id is refused, so a typo can't
    /// send a request Gemini rejects (`minimal` errors on Gemini 4 and 3.8; `-latest` and `-preview` ids are hot-swapped).
    static let thinkingLevels: [String: String] = [
        "gemini-3.5-flash-lite": "minimal",
        "gemini-3.8-flash": "low",
        "gemini-4-hydrogen": "low",
    ]
    public static let defaultModel = "gemini-3.5-flash-lite"

    let key: String
    let model: String
    let session: URLSession

    public init(key: String, model: String = GeminiAssistant.defaultModel, session: URLSession = .shared) {
        self.key = key
        self.model = model
        self.session = session
    }

    public var isGenerative: Bool { true }

    public func reply(instructions: String, homeData: String, conversation: [ChatTurn]) -> AsyncThrowingStream<String, Error> {
        let request = makeRequest(instructions: instructions, homeData: homeData, conversation: conversation)
        let session = self.session
        return AsyncThrowingStream { continuation in
            let task = Task {
                do {
                    guard let request else { throw AssistantError.notConfigured }
                    try await Self.stream(request, session: session, into: continuation)
                    continuation.finish()
                } catch let error as AssistantError {
                    continuation.finish(throwing: error)
                } catch is CancellationError {
                    continuation.finish(throwing: CancellationError())
                } catch let error as URLError {
                    continuation.finish(throwing: error.code == .cancelled ? CancellationError() : AssistantError.offline)
                } catch {
                    continuation.finish(throwing: AssistantError.offline)
                }
            }
            continuation.onTermination = { _ in task.cancel() }
        }
    }

    /// One reply, with up to 2 retries for 408, 429 and 5xx before any text has arrived: about 1 s, then 2 s, plus
    /// jitter, or Gemini's own retry delay for 429. The total wait is capped at 10 s (note 17 R5).
    static func stream(_ request: URLRequest, session: URLSession,
                       into continuation: AsyncThrowingStream<String, Error>.Continuation) async throws {
        var waited: Double = 0
        for attempt in 0...2 {
            let (bytes, response) = try await session.bytes(for: request)
            guard let http = response as? HTTPURLResponse else { throw AssistantError.malformed }
            guard http.statusCode == 200 else {
                var body = Data()
                for try await byte in bytes {
                    body.append(byte)
                    if body.count > 8_192 { break }
                }
                let retryable = http.statusCode == 408 || http.statusCode == 429 || (500...599).contains(http.statusCode)
                let delay = GeminiWire.retryDelay(body: body) ?? Double(attempt + 1) + Double.random(in: 0...0.5)
                if retryable, attempt < 2, waited + delay <= 10 {
                    waited += delay
                    try await Task.sleep(for: .seconds(delay))
                    continue
                }
                throw GeminiWire.error(status: http.statusCode, body: body)
            }
            for try await line in bytes.lines {
                switch try GeminiWire.parse(line: line) {
                case .text(let piece): continuation.yield(piece)
                case .done: return
                case .skip: continue
                }
            }
            return
        }
    }

    /// The HTTPS request. It's internal so tests can check its shape, and that the key sits in the header and nowhere else.
    func makeRequest(instructions: String, homeData: String, conversation: [ChatTurn]) -> URLRequest? {
        guard !key.isEmpty, let level = Self.thinkingLevels[model],
              let url = URL(string: "https://generativelanguage.googleapis.com/v1/models/\(model):streamGenerateContent?alt=sse")
        else { return nil }
        var request = URLRequest(url: url, timeoutInterval: 45)
        request.httpMethod = "POST"
        request.setValue("application/json", forHTTPHeaderField: "Content-Type")
        request.setValue(key, forHTTPHeaderField: "x-goog-api-key")
        let body = GeminiWire.Request(
            systemInstruction: .init(role: nil, parts: [.init(text: instructions)]),
            contents: Self.contents(homeData: homeData, conversation: conversation),
            generationConfig: .init(maxOutputTokens: 600, thinkingConfig: .init(thinkingLevel: level)),
            safetySettings: ["HARM_CATEGORY_HARASSMENT", "HARM_CATEGORY_HATE_SPEECH", "HARM_CATEGORY_SEXUALLY_EXPLICIT",
                             "HARM_CATEGORY_DANGEROUS_CONTENT"].map { .init(category: $0, threshold: "BLOCK_ONLY_HIGH") },
            store: false)
        request.httpBody = try? JSONEncoder().encode(body)
        return request
    }

    /// At most the last 6 turns, starting with the caregiver and ending with their question. The home's data is placed
    /// in front of that question (note 17 R3, R8).
    static func contents(homeData: String, conversation: [ChatTurn]) -> [GeminiWire.Content] {
        var turns = Array(conversation.suffix(6))
        while turns.first?.role == .debbie { turns.removeFirst() }
        return turns.enumerated().map { index, turn in
            let isQuestion = index == turns.count - 1 && turn.role == .caregiver
            let text = isQuestion ? "\(homeData)\nBased on the home data above, answer: \(turn.text)" : turn.text
            return .init(role: turn.role.rawValue, parts: [.init(text: text)])
        }
    }
}

/// Gemini's JSON on the wire (REST v1, research note 17 F3–F5).
enum GeminiWire {
    struct Part: Codable {
        let text: String?
        var thought: Bool? = nil
    }
    struct Content: Codable {
        let role: String?
        let parts: [Part]?
    }
    struct ThinkingConfig: Encodable { let thinkingLevel: String }
    struct GenerationConfig: Encodable {
        let maxOutputTokens: Int
        let thinkingConfig: ThinkingConfig
    }
    struct SafetySetting: Encodable { let category: String; let threshold: String }
    struct Request: Encodable {
        let systemInstruction: Content
        let contents: [Content]
        let generationConfig: GenerationConfig
        let safetySettings: [SafetySetting]
        let store: Bool
    }
    struct Chunk: Decodable {
        struct Candidate: Decodable { let content: Content?; let finishReason: String? }
        struct Feedback: Decodable { let blockReason: String? }
        let candidates: [Candidate]?
        let promptFeedback: Feedback?
        let error: ErrorBody.Inner?
    }
    struct ErrorBody: Decodable {
        struct Detail: Decodable {
            let type: String?
            let retryDelay: String?
            enum CodingKeys: String, CodingKey { case type = "@type", retryDelay }
        }
        struct Inner: Decodable { let code: Int?; let message: String?; let status: String?; let details: [Detail]? }
        let error: Inner
    }

    enum Line: Equatable { case text(String), done, skip }

    static let blockedReasons: Set<String> = ["SAFETY", "PROHIBITED_CONTENT", "BLOCKLIST", "SPII", "RECITATION", "LANGUAGE",
                                              "OTHER", "MALFORMED_RESPONSE", "PUP_LIMITED_DISABLED"]

    /// One line of the event stream. Only `data:` lines carry content; comments, `event:` and `id:` lines are skipped.
    /// A blocked answer throws, even after partial text, so the caller removes what was shown (note 17 R4).
    static func parse(line: String) throws -> Line {
        guard line.hasPrefix("data:") else { return .skip }
        let json = line.dropFirst(5).trimmingCharacters(in: .whitespaces)
        guard let data = json.data(using: .utf8), let chunk = try? JSONDecoder().decode(Chunk.self, from: data) else { return .skip }
        if let failure = chunk.error { throw error(status: failure.code ?? 500, message: failure.message ?? "") }
        if chunk.promptFeedback?.blockReason != nil { throw AssistantError.blocked }
        let candidate = chunk.candidates?.first
        let text = (candidate?.content?.parts ?? []).filter { $0.thought != true }.compactMap(\.text).joined()
        if let reason = candidate?.finishReason {
            if blockedReasons.contains(reason) { throw AssistantError.blocked }
            return text.isEmpty ? .done : .text(text)
        }
        return text.isEmpty ? .skip : .text(text)
    }

    /// Gemini's own retry delay for a 429 ("RetryInfo.retryDelay", e.g. "7s"), if present.
    static func retryDelay(body: Data) -> Double? {
        guard let parsed = try? JSONDecoder().decode(ErrorBody.self, from: body),
              let delay = parsed.error.details?.compactMap(\.retryDelay).first else { return nil }
        return Double(delay.trimmingCharacters(in: CharacterSet(charactersIn: "s")))
    }

    /// Maps an HTTP error to words for the caregiver. The body is read only to classify the error, and is never kept.
    static func error(status: Int, body: Data) -> AssistantError {
        let parsed = try? JSONDecoder().decode(ErrorBody.self, from: body)
        return error(status: status, message: parsed?.error.message ?? "")
    }

    static func error(status: Int, message: String) -> AssistantError {
        switch status {
        case 400 where message.lowercased().contains("api key"): return .rejectedKey
        case 401: return .rejectedKey
        case 403, 404: return .unavailable
        case 408, 429: return .rateLimited
        default: return .server(status)
        }
    }
}
