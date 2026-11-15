@testable import DebbieFeatures
import DebbieCore
import Foundation
import Testing

/// A fake Gemini: sends `pieces` with a pause before each, then ends.
struct SlowAssistant: AssistantService {
    let pieces: [String]
    var pause: Duration = .milliseconds(150)
    var isGenerative: Bool { true }
    func reply(instructions: String, homeData: String, conversation: [ChatTurn]) -> AsyncThrowingStream<String, Error> {
        let pieces = pieces, pause = pause
        return AsyncThrowingStream { continuation in
            let task = Task {
                for piece in pieces {
                    try? await Task.sleep(for: pause)
                    if Task.isCancelled { break }
                    continuation.yield(piece)
                }
                continuation.finish()
            }
            continuation.onTermination = { _ in task.cancel() }
        }
    }
}

/// Debbie's conversation (D-031; research note 17 R11, R14, R22): what the reply guard catches, and that Stop, the
/// time limits and a reset never leave a partial answer, a wrong error or an old reply behind.
@MainActor @Suite struct DebbieChatTests {
    static func model(_ assistant: AssistantService) -> DebbieChatModel {
        DebbieChatModel(assistant: assistant, homeData: { "<home_data now=\"Saturday\" demo=\"yes\">\n</home_data>" },
                        fallback: { _ in "On-device summary." })
    }

    static func settle(_ chat: DebbieChatModel, within limit: Duration = .seconds(5)) async {
        let end = ContinuousClock.now + limit
        while chat.busy, ContinuousClock.now < end { try? await Task.sleep(for: .milliseconds(20)) }
    }

    @Test func guardCatchesEveryBannedPhraseWhereverItSits() {
        for text in ["She's safe at home and her heart rate is steady.", "This safety check ran at 4:10 PM, and she is safe.",
                     "Everything is fine at home.", "It's **all** clear.", "They’re safe."] {
            #expect(ReplyGuard.check(text) == .init(replacement: nil), "\(text)")
        }
        for text in ["Her heart rate was abnormally high.", "No arrhythmias were seen.", "She seems tachycardic.", "Possibly a heart attack."] {
            #expect(ReplyGuard.check(text)?.replacement != nil, "clinical: \(text)")
        }
        #expect(ReplyGuard.check("As a doctor would tell you, rest.") == .init(replacement: nil))
        for text in ["Monitoring is on, confirmed 4:41 PM.", "Heart rate: 72 beats a minute, steady.", "The camera was unsafe? No: it's working.",
                     "Fall detection is running."] {
            #expect(ReplyGuard.check(text) == nil, "allowed: \(text)")
        }
    }

    @Test func guardCatchesAnAllClearAboutAnyone() {
        for text in ["Your loved one is fine.", "Mum's okay now.", "The home is\u{00A0}fine.", "It's an all-clear from the sensors."] {
            #expect(ReplyGuard.check(text) == .init(replacement: nil), "\(text)")
        }
    }

    @Test func onlyJudgedWordsAreShownMidStream() {
        #expect(ReplyGuard.checkedPrefix("Monitoring is on. Everything is fine.") == "Monitoring is on. Everything is")
        #expect(ReplyGuard.checkedPrefix("Hello") == "")
    }

    @Test func aOneWordAnswerIsKept() async {
        let chat = Self.model(SlowAssistant(pieces: ["Yes."], pause: .milliseconds(20)))
        chat.send("Is monitoring on?")
        await Self.settle(chat)
        #expect(chat.messages.last?.fromDebbie == true && chat.messages.last?.text == "Yes.")
        #expect(chat.problem == nil)
    }

    @Test func aCutWordWaitsForTheRestBeforeTheGuardJudges() {
        // Mid-stream "…data is safe" may still become "safeguarded".
        #expect(ReplyGuard.check("Your home's data is safe", complete: false) == nil)
        #expect(ReplyGuard.check("Your home's data is safeguarded by the hub.", complete: true) == nil)
        #expect(ReplyGuard.check("She is safe now", complete: false) == .init(replacement: nil))
    }

    @Test func stopKeepsNothingPartialAndShowsNoError() async {
        let chat = Self.model(SlowAssistant(pieces: ["An urgent alert ", "about a possible fall ", "hasn't been answered."], pause: .milliseconds(200)))
        chat.send("How are things?")
        while !chat.messages.contains(where: \.fromDebbie), chat.busy { try? await Task.sleep(for: .milliseconds(10)) }
        chat.stop()
        await Self.settle(chat)
        #expect(!chat.busy)
        #expect(chat.messages.allSatisfy { !$0.fromDebbie }, "no partial answer is kept")
        #expect(chat.messages.map(\.text) == ["How are things?"], "the question stays, to ask again")
        #expect(chat.problem == nil, "a stop by the caregiver shows no error row")
    }

    @Test func stopBeforeAnyWordsShowsNoError() async {
        let chat = Self.model(SlowAssistant(pieces: ["Late words."], pause: .seconds(2)))
        chat.send("Any news?")
        try? await Task.sleep(for: .milliseconds(100))
        chat.stop()
        await Self.settle(chat)
        #expect(chat.problem == nil)
        #expect(chat.messages.allSatisfy { !$0.fromDebbie })
    }

    @Test func resetDuringAReplyLeavesAFreshConversation() async {
        let chat = Self.model(SlowAssistant(pieces: ["Monitoring ", "is on."], pause: .milliseconds(150)))
        chat.greetIfNeeded()
        try? await Task.sleep(for: .milliseconds(200))
        chat.reset()
        try? await Task.sleep(for: .milliseconds(600))
        #expect(chat.messages.isEmpty, "no old reply comes back")
        #expect(chat.problem == nil, "no stale error")
        #expect(!chat.busy)
        chat.greetIfNeeded()
        await Self.settle(chat)
        #expect(chat.messages.last?.text == "Monitoring is on.", "the next session greets again")
    }

    @Test func aFinishedAnswerIsKept() async {
        let chat = Self.model(SlowAssistant(pieces: ["Monitoring is on, ", "confirmed 4:41 PM."], pause: .milliseconds(30)))
        chat.send("Is monitoring on?")
        await Self.settle(chat)
        #expect(chat.messages.last?.fromDebbie == true)
        #expect(chat.messages.last?.done == true)
        #expect(chat.messages.last?.text == "Monitoring is on, confirmed 4:41 PM.")
    }

    @Test func aBannedAnswerIsReplacedWhenItEnds() async {
        let chat = Self.model(SlowAssistant(pieces: ["Everything is ", "fine."], pause: .milliseconds(30)))
        chat.send("How are things?")
        await Self.settle(chat)
        #expect(chat.messages.last?.text == "On-device summary.")
        #expect(chat.messages.last?.onDevice == true)
    }

    @Test func onlyRetriesThatCanWorkOfferTryAgain() {
        #expect(!AssistantError.blocked.retryHelps && !AssistantError.rejectedKey.retryHelps && !AssistantError.notConfigured.retryHelps)
        #expect(AssistantError.offline.retryHelps && AssistantError.slow.retryHelps && AssistantError.server(503).retryHelps)
    }
}
