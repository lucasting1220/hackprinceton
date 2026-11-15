// swift-tools-version: 6.2
// Debbie's shared code. Module boundaries and the import allowlist: CRAFT.md §8 E2.
import PackageDescription

let ui: [SwiftSetting] = [
    .defaultIsolation(MainActor.self),
    .enableUpcomingFeature("NonisolatedNonsendingByDefault"),
    .enableUpcomingFeature("InferIsolatedConformances"),
]
let logic: [SwiftSetting] = [
    .enableUpcomingFeature("NonisolatedNonsendingByDefault"),
    .enableUpcomingFeature("InferIsolatedConformances"),
]

let package = Package(
    name: "DebbieKit",
    platforms: [.iOS("26.0")],
    products: [
        .library(name: "DebbieCore", targets: ["DebbieCore"]),
        .library(name: "DebbieCrypto", targets: ["DebbieCrypto"]),
        .library(name: "DebbieSecureStore", targets: ["DebbieSecureStore"]),
        .library(name: "DebbieNetworking", targets: ["DebbieNetworking"]),
        .library(name: "DebbieDesignSystem", targets: ["DebbieDesignSystem"]),
        .library(name: "DebbieCareScreens", targets: ["DebbieCareScreens"]),
        .library(name: "DebbieFeatures", targets: ["DebbieFeatures"]),
    ],
    targets: [
        .target(name: "DebbieCore", swiftSettings: logic),
        .target(name: "DebbieCrypto", dependencies: ["DebbieCore"], swiftSettings: logic),
        .target(name: "DebbieSecureStore", dependencies: ["DebbieCore"], swiftSettings: logic),
        .target(name: "DebbieNetworking", dependencies: ["DebbieCore", "DebbieCrypto", "DebbieSecureStore"], swiftSettings: logic),
        .target(name: "DebbieDesignSystem", resources: [.process("Resources")], swiftSettings: ui),
        .target(name: "DebbieCareScreens", dependencies: ["DebbieCore", "DebbieDesignSystem"], swiftSettings: ui),
        .target(name: "DebbieFeatures", dependencies: ["DebbieCore", "DebbieCrypto", "DebbieSecureStore", "DebbieNetworking", "DebbieDesignSystem", "DebbieCareScreens"], swiftSettings: ui),
        .testTarget(name: "DebbieCryptoTests", dependencies: ["DebbieCrypto", "DebbieCore"]),
        .testTarget(name: "DebbieCoreTests", dependencies: ["DebbieCore"]),
        .testTarget(name: "DebbieNetworkingTests", dependencies: ["DebbieNetworking", "DebbieCrypto", "DebbieCore", "DebbieSecureStore"]),
        .testTarget(name: "DebbieDesignSystemTests", dependencies: ["DebbieDesignSystem"]),
        .testTarget(name: "DebbieFeaturesTests", dependencies: ["DebbieFeatures", "DebbieCore"]),
    ]
)
