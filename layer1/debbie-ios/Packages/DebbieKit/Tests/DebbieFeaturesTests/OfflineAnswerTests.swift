@testable import DebbieFeatures
import Testing

/// Debbie's on-device answers (note 17 R13): plain sentences, never raw data, the urgent alert first, and an answer to
/// what was asked. These are what a build without a Gemini key shows.
@MainActor @Suite struct OfflineAnswerTests {
    static func home(_ lines: [String]) -> String {
        (["<home_data now=\"Saturday 14 November 2026, 4:42 PM\" demo=\"yes\">"] + lines + ["</home_data>"]).joined(separator: "\n")
    }
    static let fresh = ["connection: home last in touch 4:41 PM (1 min ago)", "monitoring: on, confirmed 4:41 PM (1 min ago)",
                        "sensors: Kitchen laptop reporting; Living room laptop reporting; camera up; microphone up; fall detection running; sound detection running"]
    static let heart = "heart_rate: 72 beats a minute, steady, measured 4:30 PM (12 min ago)"
    static let fall = "- urgent | Possible fall | noticed 4:31 PM (11 min ago) | not acknowledged | Sample: a fall in the kitchen"
    static let quiet = home(fresh + [heart, "alerts: none in the last 24 h"])

    @Test func theUrgentAlertComesFirstInPlainWords() {
        let answer = OfflineAssistant.summary(from: Self.home(Self.fresh + [Self.heart, "alerts, newest first:", Self.fall]), question: "How are they today?")
        #expect(answer == "An urgent alert hasn't been answered: possible fall at 4:31 PM. Open it on the Home tab, or call your loved one. "
                + "Monitoring is on, confirmed 1 min ago. The latest heart rate is 72 beats a minute, steady, measured 12 min ago.")
        #expect(!answer.contains("(") && !answer.contains("STALE") && !answer.contains("|"), "no raw data")
    }

    @Test func itAnswersWhatWasAsked() {
        #expect(OfflineAssistant.summary(from: Self.quiet, question: "How's the heart rate?")
                == "The latest heart rate is 72 beats a minute, steady, measured 12 min ago.")
        #expect(OfflineAssistant.summary(from: Self.quiet, question: "Any alerts?")
                == "Monitoring is on, confirmed 1 min ago. No alerts have arrived in the last 24 hours.", "never 'no alerts' without monitoring")
        #expect(OfflineAssistant.summary(from: Self.quiet, question: "Is everything working at home?")
                == "The home is connected, last in touch 1 min ago. Monitoring is on, confirmed 1 min ago. Both laptops are reporting. "
                + "The camera and microphone are working. Fall and sound detection are running.")
        #expect(OfflineAssistant.summary(from: Self.quiet, question: "How is my loved one doing right now?")
                == "Monitoring is on, confirmed 1 min ago. The latest heart rate is 72 beats a minute, steady, measured 12 min ago. "
                + "No alerts have arrived in the last 24 hours.")
    }

    @Test func anUnreachableHomeIsSaidWhateverWasAsked() {
        let data = Self.home(["connection: can't reach the home; last in touch 2:05 PM (2 h 37 min ago)",
                              "monitoring: unknown, last confirmed 2:05 PM (2 h 37 min ago), STALE", "heart_rate: no readings",
                              "alerts: none in the last 24 h"])
        #expect(OfflineAssistant.summary(from: data, question: "Any news?")
                == "I can't reach the home right now. It was last in touch at 2:05 PM. I can't confirm monitoring right now. "
                + "It was last confirmed at 2:05 PM. No alerts have arrived in the last 24 hours.")
        #expect(OfflineAssistant.summary(from: data, question: "How's the heart rate?")
                == "I can't reach the home right now. It was last in touch at 2:05 PM. No heart-rate readings have arrived yet.")
    }

    @Test func aWorriedQuestionGetsTheEmergencyAdviceFirst() {
        let answer = OfflineAssistant.summary(from: Self.quiet, question: "Is she having a heart attack?")
        #expect(answer.hasPrefix("I can't tell what's happening medically from the home's data. If you're worried right now, call emergency services."))
        #expect(ReplyGuard.check(answer) == nil, "the on-device answer passes its own guard")
    }

    @Test func otherAlertsAndAnswersReadNaturally() {
        let data = Self.home(Self.fresh + [Self.heart, "alerts, newest first:",
                                           "- attention | No movement noticed | noticed 4:20 PM (22 min ago) | not acknowledged",
                                           Self.fall.replacingOccurrences(of: "not acknowledged", with: "acknowledged 4:33 PM")])
        #expect(OfflineAssistant.summary(from: data, question: "Any alerts?")
                == "Monitoring is on, confirmed 1 min ago. Latest alert: no movement noticed at 4:20 PM, not answered yet.")
        let acknowledged = Self.home(Self.fresh + [Self.heart, "alerts, newest first:", Self.fall.replacingOccurrences(of: "not acknowledged", with: "acknowledged 4:33 PM")])
        #expect(OfflineAssistant.summary(from: acknowledged, question: "Any alerts?")
                == "Monitoring is on, confirmed 1 min ago. Latest alert: possible fall at 4:31 PM, answered at 4:33 PM.")
    }

    @Test func timesWithTheSystemsNarrowSpaceStillRead() {
        // iOS formats "4:31 PM" with U+202F before PM.
        let data = Self.home(["monitoring: on, confirmed 4:41\u{202F}PM (just now)"])
        #expect(OfflineAssistant.summary(from: data, question: "Is monitoring on?").hasPrefix("Monitoring is on, confirmed just now."))
    }

    @Test func oldEventsSayHowOldTheyAre() {
        let data = Self.home(["connection: can't reach the home; last in touch 2:05 PM (26 h 3 min ago)",
                              "monitoring: unknown, last confirmed 2:05 PM (26 h 3 min ago), STALE", "heart_rate: no readings",
                              "alerts, newest first:", "- urgent | Possible fall | noticed 4:31 PM (49 h 11 min ago) | not acknowledged"])
        let answer = OfflineAssistant.summary(from: data, question: "How are they today?")
        #expect(answer.hasPrefix("An urgent alert hasn't been answered: possible fall at 4:31 PM, 2 days ago."))
        #expect(answer.contains("It was last in touch at 2:05 PM, 1 day ago."))
        #expect(answer.contains("It was last confirmed at 2:05 PM, 1 day ago."))
        #expect(HomeFacts.moment("9:00 AM", "13 h 2 min ago") == "at 9:00 AM, 13 hours ago")
        #expect(HomeFacts.moment("9:00 AM", "11 h 59 min ago") == "at 9:00 AM")
    }

    @Test func worryIsRecognisedByWholeWords() {
        for q in ["She isn't answering her phone", "I think she fell", "She's not responding", "She won't pick up", "Is she having a heart attack?",
                  "She’s not answering and I’m scared"] {
            #expect(OfflineAssistant.topic(of: q) == .worried, "\(q)")
        }
        for q in ["Can you help me understand the alerts?", "Is the painting crew there?", "How are they today?"] {
            #expect(OfflineAssistant.topic(of: q) != .worried, "\(q)")
        }
        #expect(OfflineAssistant.topic(of: "Is everything working at home?") == .working)
        #expect(OfflineAssistant.topic(of: "How's the heart rate?") == .heart)
    }

    @Test func aLaptopNameCantAddFacts() {
        // homeDataForDebbie turns ";" into "," so the sensors line keeps its own fields; HomeFacts reads it back plainly.
        let data = Self.home(["sensors: Den, camera down reporting; camera up; microphone up; fall detection running; sound detection running"])
        #expect(OfflineAssistant.summary(from: data, question: "Is the camera working?")
                == "The laptop is reporting. The camera and microphone are working. Fall and sound detection are running.")
    }
}
