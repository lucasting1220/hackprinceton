@testable import DebbieFeatures
import Testing

/// The launch intro plays once per process, only when the app opens on the welcome screen (CRAFT.md §3.7 N3; D-033).
/// The gate is process-wide state, so these run in order within one suite.
@MainActor @Suite(.serialized) struct IntroGateTests {
    @Test func armsOnceAndSpendsOnce() {
        IntroGate.resetForTesting()
        IntroGate.arm(opensOnWelcome: true)
        IntroGate.arm(opensOnWelcome: false)   // a later root init can't change the decision
        #expect(IntroGate.pending, "armed by the first decision")
        IntroGate.spend()
        #expect(!IntroGate.pending, "spent once the welcome has appeared: no replay after leaving the demo or unpairing")
    }

    @Test func neverArmsWhenTheAppOpensElsewhere() {
        IntroGate.resetForTesting()
        IntroGate.arm(opensOnWelcome: false)
        #expect(!IntroGate.pending, "a caregiver opening to an alert never waits for it")
        IntroGate.arm(opensOnWelcome: true)
        #expect(!IntroGate.pending, "and a later welcome in the same process doesn't play it either")
    }
}
