import DebbieDesignSystem
import SwiftUI

/// Demo home only (DEMO_HOME.md; brief §6 "fires every named haptic event"): plays each haptic in CRAFT.md §4 so it
/// can be felt on a real iPhone, with when Debbie plays it. Reached from Settings while the demo is on.
struct DemoControlsSheet: View {
    let close: () -> Void
    private struct Play: Equatable { let event: DebbieHaptic; let n: Int }
    @State private var play: Play?
    @State private var count = 0

    var body: some View {
        VStack(spacing: 0) {
            DebbieSheetHeader("Demo Controls", onClose: close)
            ScrollView {
                VStack(alignment: .leading, spacing: Space.s16) {
                    Text("Feel each haptic").font(DType.title).foregroundStyle(Color.dText).accessibilityAddTraits(.isHeader)
                    Text("Every haptic Debbie plays, and when it plays it. Tap one to feel it on this iPhone.")
                        .font(DType.body).foregroundStyle(Color.dText2).fixedSize(horizontal: false, vertical: true)
                    ForEach(DebbieHaptic.allCases, id: \.self) { event in
                        VStack(alignment: .leading, spacing: Space.s4) {
                            Button(Self.title(event)) { count += 1; play = Play(event: event, n: count) }
                                .buttonStyle(.debbie(.secondary, size: .regular))
                                .accessibilityHint("Plays the \(Self.feel(event)) haptic")
                            Text("\(Self.when(event)) Feels like: \(Self.feel(event)).")
                                .font(DType.secondary).foregroundStyle(Color.dText2).fixedSize(horizontal: false, vertical: true)
                        }
                    }
                }
                .padding(Space.s20)
            }
        }
        .background(Color.dCanvas.ignoresSafeArea())
        .debbieHaptic(trigger: play) { _, new in new?.event }
    }

    static func title(_ e: DebbieHaptic) -> String {
        switch e {
        case .scanRecognized: "Code Recognised"
        case .scanInvalid: "Not a Debbie Code"
        case .paired: "Paired"
        case .pairingFailed: "Pairing Failed"
        case .alertUrgentArrived: "Urgent Alert Arrived"
        case .acknowledged: "I'm On It"
        case .liveViewStarted: "Live View Started"
        case .liveViewDenied: "Live View Is Off at Home"
        case .liveViewEndedByResident: "Turned Off at Home"
        case .liveViewLost: "Live View Lost"
        case .laptopApproved: "Laptop Added"
        case .laptopApprovalFailed: "Laptop Not Added"
        case .syncSucceeded: "Heart Rate Sent"
        case .syncFailed: "Heart Rate Not Sent"
        case .toggleChanged: "Switch Changed"
        case .choiceChanged: "Choice Changed"
        case .unpairIncomplete: "Unpaired Here Only"
        case .formInvalid: "Check This Field"
        }
    }

    static func when(_ e: DebbieHaptic) -> String {
        switch e {
        case .scanRecognized: "When the camera reads a Debbie code."
        case .scanInvalid: "When a scanned code is wrong or expired."
        case .paired: "When pairing completes."
        case .pairingFailed: "When pairing can't finish."
        case .alertUrgentArrived: "When an urgent alert, like a possible fall, arrives while Debbie is open."
        case .acknowledged: "When you press I'm On It."
        case .liveViewStarted: "When the camera starts playing."
        case .liveViewDenied: "When live view is off at home."
        case .liveViewEndedByResident: "When the person at home turns live view off while you watch."
        case .liveViewLost: "When the connection to the camera is lost."
        case .laptopApproved: "When a new laptop joins the home."
        case .laptopApprovalFailed: "When a laptop couldn't be added."
        case .syncSucceeded: "When Sync Now sends heart readings home."
        case .syncFailed: "When heart readings couldn't be sent."
        case .toggleChanged: "When you flip a switch."
        case .choiceChanged: "When you pick an option."
        case .unpairIncomplete: "When this iPhone unpaired but couldn't tell home."
        case .formInvalid: "When a form can't be sent yet."
        }
    }

    static func feel(_ e: DebbieHaptic) -> String {
        switch e.feedback {
        case .success: "success, two quick rising taps"
        case .warning: "warning, two taps that fall"
        case .error: "error, three quick taps"
        case .selection: "selection, a faint tick"
        default: "a light tap"
        }
    }
}
