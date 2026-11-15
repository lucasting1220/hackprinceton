@testable import DebbieNetworking
import Foundation
import Testing

/// Unpairing never waits on a home that doesn't answer (owner, 23:5x: with the laptop off, "Unpair This iPhone"
/// seemed to do nothing). `firstOf` returns at its deadline even when the work ignores cancellation.
@Suite struct UnpairDeadlineTests {
    @Test func aStuckAttemptIsAbandonedAtTheDeadline() async {
        let start = ContinuousClock.now
        let result: Bool? = await NetworkHomeService.firstOf(deadline: .milliseconds(300)) {
            // Work that doesn't stop when cancelled, like a Bonjour browse waiting out its own timer.
            let until = ContinuousClock.now + .seconds(3)
            while ContinuousClock.now < until { try? await Task.sleep(for: .milliseconds(50)) }
            return true
        }
        let waited = ContinuousClock.now - start
        #expect(result == nil, "gave up rather than waited")
        #expect(waited < .milliseconds(900), "returned at the deadline, not when the work ended: \(waited)")
    }

    @Test func aQuickAnswerIsKept() async {
        let result = await NetworkHomeService.firstOf(deadline: .seconds(2)) { () async -> Bool in
            try? await Task.sleep(for: .milliseconds(50))
            return true
        }
        #expect(result == true)
    }

    @Test func theDeadlineIsShort() {
        #expect(NetworkHomeService.unpairDeadline <= .seconds(5))
        // The hub goes first, and the relay keeps a real share of the time to revoke the credential.
        #expect(NetworkHomeService.hubUnpairDeadline < NetworkHomeService.unpairDeadline - .seconds(1))
    }
}
