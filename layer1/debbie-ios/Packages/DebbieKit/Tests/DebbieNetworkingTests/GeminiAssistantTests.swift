@testable import DebbieNetworking
import DebbieCore
import Foundation
import Testing

/// Debbie's Gemini client (D-031; research note 17 R1–R5). The key stays in the header, the request has the documented
/// shape, the stream parses, and errors become plain words.
@Suite struct GeminiAssistantTests {
    // A made-up value with a key's shape, never a real key.
    static let fakeKey = "test-key-0123456789"
    static let homeData = "<home_data now=\"Saturday\" demo=\"yes\">\nheart_rate: 68 beats a minute\n</home_data>"

    static func body(_ request: URLRequest) throws -> [String: Any] {
        let data = try #require(request.httpBody)
        return try #require(try JSONSerialization.jsonObject(with: data) as? [String: Any])
    }

    @Test func keyTravelsOnlyInTheHeader() throws {
        let gemini = GeminiAssistant(key: Self.fakeKey)
        let request = try #require(gemini.makeRequest(instructions: "Be kind.", homeData: Self.homeData,
                                                      conversation: [ChatTurn(role: .caregiver, text: "How are things?")]))
        #expect(request.value(forHTTPHeaderField: "x-goog-api-key") == Self.fakeKey)
        #expect(request.url?.absoluteString == "https://generativelanguage.googleapis.com/v1/models/gemini-3.5-flash-lite:streamGenerateContent?alt=sse")
        #expect(request.url?.query?.contains("key=") == false, "never ?key= in the URL")
        let raw = try #require(request.httpBody.flatMap { String(data: $0, encoding: .utf8) })
        #expect(!raw.contains(Self.fakeKey), "the key never goes in the body")
    }

    @Test func bodyHasTheDocumentedShape() throws {
        let conversation = [ChatTurn(role: .caregiver, text: "How is Mum?"), ChatTurn(role: .debbie, text: "Monitoring is on."),
                            ChatTurn(role: .caregiver, text: "Did she sleep?")]
        let request = try #require(GeminiAssistant(key: Self.fakeKey).makeRequest(instructions: "SYSTEM", homeData: Self.homeData,
                                                                                  conversation: conversation))
        let body = try Self.body(request)
        let system = try #require(body["systemInstruction"] as? [String: Any])
        let systemText = (system["parts"] as? [[String: Any]])?.first?["text"] as? String
        #expect(systemText == "SYSTEM", "the system instruction never carries the home's data")
        let contents = try #require(body["contents"] as? [[String: Any]])
        #expect(contents.map { $0["role"] as? String } == ["user", "model", "user"])
        let last = (contents.last?["parts"] as? [[String: Any]])?.first?["text"] as? String ?? ""
        #expect(last.hasPrefix("<home_data") && last.hasSuffix("answer: Did she sleep?"), "home data goes in the last user turn only")
        let first = (contents.first?["parts"] as? [[String: Any]])?.first?["text"] as? String ?? ""
        #expect(!first.contains("home_data"))
        let config = try #require(body["generationConfig"] as? [String: Any])
        #expect(config["temperature"] == nil, "sampling parameters are deprecated")
        #expect((config["thinkingConfig"] as? [String: Any])?["thinkingLevel"] as? String == "minimal")
        #expect((config["thinkingConfig"] as? [String: Any])?["thinkingBudget"] == nil)
        #expect(body["store"] as? Bool == false)
        #expect((body["safetySettings"] as? [[String: Any]])?.count == 4)
    }

    @Test func historyIsCappedAndStartsWithTheCaregiver() throws {
        var conversation: [ChatTurn] = []
        for i in 0..<5 { conversation += [ChatTurn(role: .caregiver, text: "q\(i)"), ChatTurn(role: .debbie, text: "a\(i)")] }
        conversation.append(ChatTurn(role: .caregiver, text: "latest"))
        let contents = GeminiAssistant.contents(homeData: Self.homeData, conversation: conversation)
        #expect(contents.count <= 6)
        #expect(contents.first?.role == "user" && contents.last?.role == "user")
    }

    @Test func onlyKnownModelsAreUsed() {
        for model in ["gemini-2.5-flash", "gemini-flash-latest", "gemini-3.6-flash-preview", "gemini-typo"] {
            #expect(GeminiAssistant(key: Self.fakeKey, model: model).makeRequest(instructions: "", homeData: "", conversation: []) == nil, "\(model)")
        }
        #expect(GeminiAssistant.defaultModel.wholeMatch(of: /gemini-[0-9.]+-[a-z-]+/) != nil)
        #expect(GeminiAssistant(key: "").makeRequest(instructions: "", homeData: "", conversation: []) == nil, "no key, no request")
    }

    @Test func parsesTheEventStream() throws {
        let chunk = #"data: {"candidates":[{"content":{"parts":[{"text":"All is quiet "},{"text":"at home."}],"role":"model"},"index":0}]}"#
        #expect(try GeminiWire.parse(line: chunk) == .text("All is quiet at home."))
        #expect(try GeminiWire.parse(line: #"data: {"candidates":[{"content":{"parts":[{"text":"hidden","thought":true},{"text":"shown"}]}}]}"#) == .text("shown"))
        #expect(try GeminiWire.parse(line: "") == .skip)
        #expect(try GeminiWire.parse(line: ": keep-alive") == .skip)
        #expect(try GeminiWire.parse(line: #"data: {"candidates":[{"finishReason":"STOP"}]}"#) == .done)
        #expect(try GeminiWire.parse(line: #"data: {"candidates":[{"content":{"parts":[{"text":"end"}]},"finishReason":"MAX_TOKENS"}]}"#) == .text("end"))
        #expect(throws: AssistantError.blocked) { try GeminiWire.parse(line: #"data: {"candidates":[{"finishReason":"SAFETY"}]}"#) }
        #expect(throws: AssistantError.blocked) { try GeminiWire.parse(line: #"data: {"promptFeedback":{"blockReason":"OTHER"}}"#) }
        #expect(throws: AssistantError.rateLimited) { try GeminiWire.parse(line: #"data: {"error":{"code":429,"message":"quota","status":"RESOURCE_EXHAUSTED"}}"#) }
        #expect(try GeminiWire.parse(line: "data: not json") == .skip)
    }

    @Test func errorsBecomeWords() {
        let badKey = Data(#"{"error":{"code":400,"message":"API key not valid. Please pass a valid API key.","status":"INVALID_ARGUMENT"}}"#.utf8)
        #expect(GeminiWire.error(status: 400, body: badKey) == .rejectedKey)
        #expect(GeminiWire.error(status: 403, body: Data()) == .unavailable, "403 isn't always the key")
        #expect(GeminiWire.error(status: 404, body: Data()) == .unavailable)
        #expect(GeminiWire.error(status: 429, body: Data()) == .rateLimited)
        #expect(GeminiWire.error(status: 503, body: Data()) == .server(503))
        let retry = Data(#"{"error":{"code":429,"details":[{"@type":"type.googleapis.com/google.rpc.RetryInfo","retryDelay":"7s"}]}}"#.utf8)
        #expect(GeminiWire.retryDelay(body: retry) == 7)
        for error in [AssistantError.offline, .rateLimited, .rejectedKey, .unavailable, .blocked, .slow, .server(500), .malformed, .notConfigured] {
            #expect(!error.message.isEmpty && !error.message.contains("http"), "plain words, no codes or URLs")
        }
    }
}
