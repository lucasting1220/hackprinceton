import SwiftUI

/// The only events that play a haptic (CRAFT.md §4.1). Everything else is silent (§4.2).
public enum DebbieHaptic: String, CaseIterable, Sendable {
    case scanRecognized, scanInvalid, paired, pairingFailed, alertUrgentArrived, acknowledged
    case liveViewStarted, liveViewDenied, liveViewEndedByResident, liveViewLost
    case laptopApproved, laptopApprovalFailed, syncSucceeded, syncFailed
    case toggleChanged, choiceChanged, unpairIncomplete, formInvalid

    /// Only feedback types that play on iPhone (CRAFT.md §4.3 H1; `.start`/`.stop` are watchOS-only).
    public var feedback: SensoryFeedback {
        switch self {
        case .scanRecognized: .impact(weight: .light)
        case .paired, .acknowledged, .liveViewStarted, .laptopApproved, .syncSucceeded: .success
        case .alertUrgentArrived, .liveViewDenied, .liveViewEndedByResident, .unpairIncomplete: .warning
        case .scanInvalid, .pairingFailed, .liveViewLost, .laptopApprovalFailed, .syncFailed, .formInvalid: .error
        case .toggleChanged, .choiceChanged: .selection
        }
    }
}

public extension View {
    /// Plays `event` when `trigger` changes — the single choke point for haptics (CRAFT.md §4; lint H1).
    func debbieHaptic<T: Equatable>(_ event: DebbieHaptic, trigger: T) -> some View {
        sensoryFeedback(event.feedback, trigger: trigger)
    }

    /// Plays whichever event `event(old, new)` returns, or nothing.
    func debbieHaptic<T: Equatable>(trigger: T, _ event: @escaping (T, T) -> DebbieHaptic?) -> some View {
        sensoryFeedback(trigger: trigger) { old, new in event(old, new)?.feedback }
    }
}
