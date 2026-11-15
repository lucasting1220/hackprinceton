import DebbieCore
@testable import DebbieNetworking
import Foundation
import Testing

/// Debbie's answers from the home (Layer 4, with the home's Ollama model): the latest question goes to the home, its
/// answer comes back as the reply, and failures become the chat's plain words.
@Suite struct HomeAssistantTests {
    static func collect(_ stream: AsyncThrowingStream<String, Error>) async throws -> String {
        var text = ""
        for try await piece in stream { text += piece }
        return text
    }

    @Test func theLatestQuestionGoesToTheHomeAndItsAnswerComesBack() async throws {
        let asked = AskedQuestions()
        let assistant = HomeAssistant(ask: { question in
            await asked.add(question)
            return "Her heart rate was 72 at 10:12 PM."
        })
        let conversation = [ChatTurn(role: .caregiver, text: "How is she?"), ChatTurn(role: .debbie, text: "Monitoring is on."),
                            ChatTurn(role: .caregiver, text: "And her heart rate?")]
        let answer = try await Self.collect(assistant.reply(instructions: "Be kind.", homeData: "<home_data></home_data>", conversation: conversation))
        #expect(answer == "Her heart rate was 72 at 10:12 PM.")
        #expect(await asked.all == ["And her heart rate?"])
    }

    @Test func itWaitsLongerThanTheDefaultForTheHomesModel() {
        let assistant = HomeAssistant(ask: { _ in "" })
        #expect(assistant.answerLimit > NetworkHomeService.replyWait)
        #expect(assistant.isGenerative)
    }

    @Test(arguments: [
        (HomeError.removed as Error, AssistantError.notConfigured),
        (HomeError.notPaired as Error, AssistantError.notConfigured),
        (HomeError.cantReachHome as Error, AssistantError.server(503)),
        (AssistantError.slow as Error, AssistantError.slow),
        (URLError(.notConnectedToInternet) as Error, AssistantError.offline),
    ])
    func failuresBecomeTheChatsWords(error: Error, expected: AssistantError) {
        #expect(HomeAssistant.assistantError(error) as? AssistantError == expected)
    }

    @Test func aCancelledAskStaysACancellation() {
        #expect(HomeAssistant.assistantError(CancellationError()) is CancellationError)
        #expect(HomeAssistant.assistantError(URLError(.cancelled)) is CancellationError)
    }
}

private actor AskedQuestions {
    private(set) var all: [String] = []
    func add(_ question: String) { all.append(question) }
}
