import DebbieCore
import DebbieFeatures
import DebbieNetworking
import DebbieSecureStore
import SwiftUI
import UIKit
import UserNotifications

@main
struct DebbieApp: App {
    @UIApplicationDelegateAdaptor(AppDelegate.self) private var delegate
    @State private var model = AppEnvironment.makeModel()

    var body: some Scene {
        WindowGroup {
            #if DEBUG
            // Debug-only: the component gallery for the designer kit (DebbieDebugTools/DebbieGallery.swift).
            if ProcessInfo.processInfo.environment["DEBBIE_GALLERY"] != nil {
                DebbieGallery()
            } else {
                RootView(model: model, debugQRPayload: AppEnvironment.debugQRPayload)
            }
            #else
            RootView(model: model, debugQRPayload: AppEnvironment.debugQRPayload)
            #endif
        }
    }
}

/// Composition root: the transport is chosen by configuration only (brief §6; CRAFT.md §8 E8).
enum AppEnvironment {
    static var mode: NetworkHomeService.Mode {
        #if DEBUG
        if let override = ProcessInfo.processInfo.environment["DEBBIE_TRANSPORT"], let m = NetworkHomeService.Mode(rawValue: override) { return m }
        #endif
        let configured = Bundle.main.object(forInfoDictionaryKey: "DebbieTransportMode") as? String
        let mode = NetworkHomeService.Mode(rawValue: configured ?? "auto") ?? .auto
        return mode == .mock && !isDebug ? .auto : mode
    }

    static var isDebug: Bool {
        #if DEBUG
        true
        #else
        false
        #endif
    }

    static var debugQRPayload: String? {
        #if DEBUG
        ProcessInfo.processInfo.environment["DEBBIE_DEBUG_QR"]
        #else
        nil
        #endif
    }

    /// Debbie's answers come from the home: Layer 4 answers each question with the home's own Ollama model (nil here).
    /// A Debug run with `DEBBIE_ASSISTANT=offline` uses the on-device wording instead.
    static var assistant: AssistantService? {
        #if DEBUG
        if ProcessInfo.processInfo.environment["DEBBIE_ASSISTANT"] == "offline" { return OfflineAssistant() }
        #endif
        return nil
    }

    @MainActor static func makeModel() -> AppModel {
        #if DEBUG
        // Debug-only test hook: start unpaired, whatever an earlier test left behind (DEBBIE_RESET=1).
        if ProcessInfo.processInfo.environment["DEBBIE_RESET"] == "1" { SecureStore().deleteAll() }
        #endif
        let mode = mode, debug = isDebug
        #if DEBBIE_DEMO_HOME
        return AppModel(network: { NetworkHomeService(mode: mode, isDebug: debug) },
                        demo: { DemoHomeService() }, demoMedia: { FakeMediaEngine() },
                        heartbeatInterval: 60, assistant: assistant)
        #else
        return AppModel(network: { NetworkHomeService(mode: mode, isDebug: debug) }, demo: nil, demoMedia: nil,
                        heartbeatInterval: 60, assistant: assistant)
        #endif
    }
}

final class AppDelegate: NSObject, UIApplicationDelegate, UNUserNotificationCenterDelegate {
    func application(_ application: UIApplication, didFinishLaunchingWithOptions launchOptions: [UIApplication.LaunchOptionsKey: Any]? = nil) -> Bool {
        UNUserNotificationCenter.current().delegate = self
        return true
    }

    /// Foreground presentation by tier (research note 10 R6): urgent shows a banner with sound; others list quietly.
    nonisolated func userNotificationCenter(_ center: UNUserNotificationCenter, willPresent notification: UNNotification) async -> UNNotificationPresentationOptions {
        switch notification.request.content.interruptionLevel {
        case .timeSensitive, .critical: [.banner, .list, .sound]
        case .active: [.list]
        default: []
        }
    }
}
