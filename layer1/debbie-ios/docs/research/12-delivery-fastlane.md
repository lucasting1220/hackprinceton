# 12 Delivery: fastlane, unattended signing and TestFlight
_Researched 2026-11-14. Toolchain: Xcode 26.6 (17F113) / iOS 26.5 SDK, Swift 6.3.3, macOS 26.2. Current public iOS: **iOS 27.2.1** (released 2026-11-09). iOS 27.0 shipped 2026-09-14, iOS 27.1 (2026-10-23) went only to iPhone Duo, iOS 27.2 came out 2026-10-26, and iOS 27 runs on iPhone 11 and later [S1]. Nothing in this pipeline needs the iOS 27 SDK (see "What changed")._

## Questions answered
- Brief §9 topic 12: "Delivery: fastlane with an App Store Connect API key, run non-interactively; unattended signing within the limits in section 3; uploading without waiting for processing; validating an archive before upload; export compliance; internal testing groups."
- The assignment: "Delivery: fastlane with an App Store Connect API key; unattended signing; TestFlight processing, export compliance and internal testing."
- Brief §7, all of it [S57]: "fastlane pinned per project through a Gemfile and bundler", the read-only preflight (team, bundle IDs for the app and the Notification Service Extension, capabilities, app record, internal group), "Build numbers. Always above the latest TestFlight build", "Export compliance… Set only the Info.plist answer", "Push environment. Verify which push environment TestFlight builds use…", "What to Test" notes, and uploading early.

## Summary
- **App Store Connect still accepts Xcode 26.6 uploads.** Since 2026-04-28, apps have to be built with Xcode 26 or later and an iOS 26 SDK. Since 2026-09-09, apps have to target iOS 13 or later. No Xcode 27 requirement had been announced by 2026-11-14 [S2][S3].
- **The API key must be a Team key with the Admin role.** Individual keys can't use the provisioning endpoints [S14]. Creating distribution certificates and profiles needs Account Holder or Admin, or an App Manager who has been given access to Certificates, Identifiers & Profiles [S13], and a team key can't be given that extra access [S21]. Cloud signing through `xcodebuild` works only with Admin keys [S15][S21].
- **Recommended signing: manual, with `cert` and `sigh` writing to a dedicated, appended keychain.** Automatic or cloud signing still signs the archive with a development identity first [S15]. That would create a development key in the login keychain, or reuse the owner's identities, and it needs a registered device. `match` needs remote storage. Manual signing with `codesign --keychain` uses only the identity we created [S59].
- **What the API can't do: create the app record [S5], register an app group identifier [S10][S9], or assign a group to an App ID [S9].** It can register bundle IDs [S6], enable capabilities [S7], and create certificates and profiles [S44]. The owner has to create the app record by hand [S4].
- **Export compliance: `ITSAppUsesNonExemptEncryption = NO`.** CryptoKit and URLSession are encryption inside Apple's operating system, so no documentation is needed. The WebRTC library's standard algorithms need documentation only if the app is distributed on the App Store in France [S32][S35]. The owner should confirm this answer.
- **TestFlight builds use production APNs; builds run from Xcode with a development profile use sandbox [S24]. The Simulator uses sandbox [S27].** App Store and TestFlight installs have no embedded provisioning profile [S23][S22]. So the app reports `sandbox` in the Simulator, the profile's `aps-environment` when a profile is embedded, and otherwise `production`.
- **Two fastlane traps can break the brief's rules.** `upload_to_testflight` submits a build for Beta App Review whenever you pass `groups:` and leave `submit_beta_review` at its default of `true`. It also PATCHes the build's export-compliance answer through the API when the Info.plist key is missing [S44]. Pass explicit `false`s, add no `groups`, and use `skip_submission: true`.
- **Secrets end up in logs by default.** `xcodebuild` prints `Command line invocation:` with every argument, including any `-authenticationKey*` values (tested locally [S18]). gym prints the commands it runs [S44]. Every log has to pass through a redactor.
- **Build number = the latest upload from `latest_testflight_build_number(initial_build_number: 0)` plus 1, passed as `CURRENT_PROJECT_VERSION=N` to xcodebuild.** That action reads the most recent build upload, including ones still PROCESSING or FAILED [S44]. Don't use agvtool, because it rewrites project files [S42].
- **Pin fastlane 2.241.2 with Bundler 4 into `vendor/bundle`.** Its gemspec requires Ruby 3.2 or later and a Bundler below 5 [S46], and Ruby 4 has been supported since 2.238.0 [S45]. Never run the global Homebrew fastlane 2.240.1. In that version the iTMSTransporter path `rm -rf`s `~/.appstoreconnect/private_keys` [S44].

## Findings

### F1. Platform and upload requirements as of 2026-11-14
- iOS 27.2.1 and iPadOS 27.2.1 are dated 09 Nov 2026. iOS 27.2 is 26 Oct 2026, iOS 27.1 lists only "iPhone Duo", and iOS 27 is 14 Sep 2026 for "iPhone 11 and later". iOS 18.7.12 (09 Nov 2026) still ships for iPhone XS, XS Max and XR [S1].
- "SDK minimum requirements, Since April 28, 2026: Apps uploaded to App Store Connect must be built with Xcode 26 or later using an SDK for iOS 26…". "Since September 9, 2026: iOS and iPadOS apps uploaded to App Store Connect must target iOS 13 or later." [S2]
- The Upload builds help page lists, for iOS apps and extensions, "Built using Xcode 26 or later" and "Uploaded using Xcode 14 or later" [S3].
- On this Mac (local evidence): `xcodebuild -version` reports Xcode 26.6, build 17F113, from `/Applications/Xcode.app`, a release name with no beta suffix. `xcrun --sdk iphoneos --show-sdk-version` reports 26.5. altool is version 26.40.1 [S18][S19].
- Since Xcode 14, fastlane uploads with `xcrun altool`, because "Xcode 14 no longer supports iTMSTransporter" (source comment) [S44].

### F2. fastlane with an App Store Connect API key
- `app_store_connect_api_key(key_id:, issuer_id:, key_filepath: | key_content:, duration:, in_house:)` signs a JWT. It stores the key hash in `lane_context[SharedValues::APP_STORE_CONNECT_API_KEY]` and, through `set_spaceship_token` (default `true`), in `Spaceship::ConnectAPI.token`. Actions such as `pilot` pick it up from there automatically [S38][S39]. `duration` defaults to 500 s, with a maximum of 1200. `in_house` defaults to `false` and is `true` only for Enterprise teams [S38][S39].
- Masking (fastlane source [S44]): in `app_store_connect_api_key`, only `key_content` is `sensitive: true`. `key_id`, `issuer_id` and `key_filepath` are not masked. `pilot`'s `api_key` option is sensitive, so it is masked in summary tables.
- How the key reaches altool (fastlane 2.241.2 source [S44]): the transporter writes `AuthKey_<id>.p8` with mode 0600 into a fresh `Dir.mktmpdir("deliver-")`, runs `API_PRIVATE_KEYS_DIR=<tmp> xcrun altool --upload-app --apiKey … --apiIssuer …`, then deletes only that temporary directory. In **2.240.1** (the global Homebrew install), the iTMSTransporter path writes into `~/.appstoreconnect/private_keys` and then runs `FileUtils.rm_rf` on the whole directory. The fastlane docs still warn that "any other files in that directory will be deleted" [S40]. That path is taken only when `FASTLANE_ITUNES_TRANSPORTER_USE_SHELL_SCRIPT` or a custom iTMSTransporter path is set [S40][S44].
- altool 26.40.1 also accepts `--p8-file-path <filepath>` ("Direct path to JWT p8 authentication file"). Without it, it looks for `AuthKey_<id>.p8` in `./private_keys`, `~/private_keys`, `~/.private_keys`, `~/.appstoreconnect/private_keys` or `$API_PRIVATE_KEYS_DIR` [S19].
- Non-interactive behaviour: fastlane's `UI.interactive?` is false when stdout isn't a TTY or when a CI variable such as `CI` is set. In that case a missing value raises an error instead of prompting [S44].
- `setup_ci` has `set_default_keychain` defaulting to **true**, so it would switch the default keychain. The brief forbids that [S44][S57].
- Usage metrics: fastlane_core still has an `AnalyticsSession`. You opt out with `opt_out_usage` or `FASTLANE_OPT_OUT_USAGE` [S44].
- Versions and Ruby:
  - fastlane 2.241.2 was released 2026-10-26 and requires Ruby 3.2 or later [S46].
  - Its dependencies include `bundler >= 2.4.0, < 5.0.0` [S46].
  - 2.238.0 (2026-08-12) added "Support for Ruby 4 (+ testing)", and 2.240.1 added "cgi gem for Ruby 4 std removal" [S45].
  - 2.241.1 (2026-10-15) reverted "[produce] Support App Store Connect API key for create/enable_services/disable_services" [S45]. As a result, `produce` and `modify_services` still log in only with an Apple ID (`Spaceship.login(username, nil)`) [S44], so neither can be used here.
  - On this Mac: Ruby 4.0.7 (Homebrew), Bundler 4.0.20, global fastlane 2.240.1 (`ruby -v`, `fastlane --version`). PROGRESS.md records that `gem "fastlane", "2.241.2"` installs under Bundler 4 into a scratch `vendor/bundle` and that `bundle exec fastlane --version` reports 2.241.2 [S62]. That shows it installs and starts, not that every action works under Ruby 4.
- Bundler 4 behaviour [S47]: "When [path is] not set, Bundler install[s] by default … to the default system path (Gem.dir) before Bundler 5." `bundle config set --local` writes `<project_root>/.bundle/config`. `frozen` (`BUNDLE_FROZEN`) blocks any change to `Gemfile.lock`. `deployment` means frozen plus `vendor/bundle`. `.gitignore` already covers `vendor/bundle/` and `.bundle/`.

### F3. Unattended signing with only an API key: three options compared
| | (a) Automatic signing: `xcodebuild -allowProvisioningUpdates` with an API key, cloud-managed distribution certificate | (b) `cert` + `sigh` (manual signing) | (c) `match` |
|---|---|---|---|
| What it does | "For automatically signed targets, xcodebuild will create and update profiles, app IDs, and certificates" when it is given `-authenticationKeyPath/ID/IssuerID` [S18]. Cloud signing takes "the developer-signed … app in your archive", builds a partial signature, and Apple's servers finish signing [S15] | `cert` creates an Apple Distribution certificate from a locally generated CSR and imports the key into the keychain you name. `sigh` creates or downloads App Store profiles [S44] | Keeps encrypted certificates and profiles in git, S3 or GCS storage |
| Role needed | Admin or Account Holder can cloud-sign by default. Developers need the "Access to Cloud Managed Distribution Certificate" setting [S15], which can't be set on an API key, so a key works only with the Admin role [S21] | Distribution certificates: Account Holder or Admin, or App Manager with CI&P access [S13]. Use Admin | The same as (b) |
| Local items | The archive must be **development-signed**, so a local Apple Development identity is needed. Xcode creates it in the default (login) keychain or reuses the owner's existing identities (3 are installed). A development profile also needs a registered device | One new Apple Distribution certificate, with its private key in a **dedicated keychain** that is appended to the search list. Two App Store profiles | The same items as (b), plus a storage remote |
| Problems for Debbie | It breaks "signing items come only from asc.env and the items this section lets you create" [S57]. It writes to the login keychain and needs a device. Whether app groups get registered from the command line is not documented | Uses one distribution-certificate slot. If the team is at its limit, stop and don't free a slot [S57]. `cert` writes the private key unencrypted as `<id>.p12` under `output_path` [S44] | It needs a remote (git, S3 or GCS), and the brief forbids remotes [S57] |
- If an archive is manually signed and you choose automatic signing at export, "Xcode will create provisioning profiles and managed cloud signing certificates as necessary, but will not register devices, register app IDs, or modify app ID settings" [S18].
- Cloud-managed certificates "are associated with your Apple Developer Program membership and managed remotely". Xcode cloud-signs for distribution "if… a local signing certificate is not found". Rotation is for Account Holders and Admins [S20].
- `codesign --keychain filename` searches "only … the keychain file specified" for the identity. The normal search path is still used to build the certificate chain [S59].
- The user keychain search list on this Mac currently holds only `login.keychain-db` (`security list-keychains -d user`). `create_keychain` with `add_to_search_list: true` (the default) appends to that list, and `default_keychain` defaults to `false` [S43][S44].
- `cert` and `sigh` safety [S44]:
  - `cert` reuses a team certificate only if that certificate is installed in the given `keychain_path`. If none is, it creates a new one, and at the limit it fails with "reached the maximum number of available … certificates".
  - `sigh` with `force: true` deletes the existing profile (`profile.delete!`) and recreates it. The brief forbids that, so leave `force` at its default of `false`.
  - `cert_id` limits `sigh` to profiles that contain our certificate.
- Enabling a capability invalidates every profile that uses that App ID [S11]. So enable all capabilities first, then create profiles.

### F4. What the App Store Connect API can and can't create
| Item | Possible through the API? | Evidence |
|---|---|---|
| Bundle ID (app, `BUNDLE_ID.NotificationService`) | **Yes**, `POST /v1/bundleIds`, platform `IOS` | [S6]; `Spaceship::ConnectAPI::BundleId.create` [S44] |
| Capability on a bundle ID | **Yes**, `POST /v1/bundleIdCapabilities`. Documented types include `PUSH_NOTIFICATIONS`, `APP_GROUPS` and `HEALTHKIT` [S8]. Time Sensitive is **not** in Apple's documented enum, but spaceship sends `USERNOTIFICATIONS_TIMESENSITIVE` [S44] | [S7][S8] |
| App group identifier (`group.…`) | **No.** There is no endpoint, and the only capability settings are `ICLOUD_VERSION`, `DATA_PROTECTION_PERMISSION_LEVEL` and `APPLE_ID_AUTH_APP_CONSENT` [S9]. Registering a group is a website task for Account Holder or Admin, "or … in Xcode" [S10]. Assigning one uses "Configure" on the App ID [S11] | [S9][S10][S11] |
| Keychain sharing group | **Not needed.** Xcode prefixes keychain groups with the team ID [S54], and there is no API capability type for it [S8] | [S54][S8] |
| App record | **No**: "Don't use this API to create new apps; instead, create new apps on the App Store Connect website" | [S5]; required before the first upload [S4][S17] |
| Certificates, profiles | **Yes**: `cert` and `sigh` use `Spaceship::ConnectAPI::Certificate.create` and `Profile` creation | [S44] |
| Build upload | Possible through the **Build Uploads** resource (`buildUploads`, `buildUploadFiles`). Not needed here: altool or xcodebuild upload is enough | [S52][S3] |
| Export compliance answer | The API can (`PATCH /v1/builds` `usesNonExemptEncryption`, app encryption declarations), and **the brief forbids it** | [S35][S44][S57] |

### F5. Build numbers
- `CFBundleVersion` is "one to three period-separated integers… The string can only contain numeric characters (0-9) and periods" [S53]. "The build string is used to uniquely identify the build throughout the system" [S3]. A failed upload's build number may be reused [S50].
- `latest_testflight_build_number` (an alias of `app_store_build_number`) in 2.240.1 and 2.241.2 calls `get_build_uploads(filter: {state: "PROCESSING,FAILED,COMPLETE"}, sort: "-uploadedDate", limit: 1)`. It returns the **most recently uploaded** build number, across all versions unless `version:` is given. If nothing exists it returns `initial_build_number`, or errors when that isn't set [S44][S41].
- `increment_build_number` uses agvtool, which edits the project, unless `build_number:` is given [S42]. Passing `CURRENT_PROJECT_VERSION=N` as an xcodebuild build setting changes no files, and it applies to every target in the build, the app and the NSE alike. Reasoning: build settings given on the xcodebuild command line override project settings for all targets.

### F6. Export compliance
- Apple: "Set the value to `NO` if your app—including any third-party libraries it links against—doesn't use encryption, or if it only uses forms of encryption that are exempt from export compliance documentation requirements. Otherwise, set it to `YES`." Also: "Typically, the use of encryption that's built into the operating system—for example, when your app makes HTTPS connections using URLSession—is exempt from export documentation upload requirements, whereas the use of proprietary encryption is not." [S28]. Without the key, "App Store Connect walks you through an export compliance questionnaire every time you upload" [S29]. `YES` "typically" goes with an `ITSEncryptionExportComplianceCode` that Apple issues after reviewing documentation [S29][S30].
- App Store Connect's table of required documentation [S32]:

  | Encryption used | Documentation |
  |---|---|
  | Only what is inside Apple's operating system | None |
  | An industry-standard algorithm not provided by the OS | French encryption declaration, "only required if you're distributing your app on the App Store in France" |
  | Proprietary algorithms | CCATS, plus the French declaration (France only) |

- The question model (API `AppEncryptionDeclaration`) [S35]:
  - `containsProprietaryCryptography`: "implements any proprietary encryption algorithms".
  - `containsThirdPartyCryptography`: "implements any standard encryption algorithms instead of, or in addition to, using or accessing the encryption in Apple's operating systems".
  - `availableOnFrenchStore`.
  - `exempt`: "exempt based on your use of encryption and the app's availability".
  - `usesEncryption` is deprecated.
- Developer responsibility: "you're responsible for all liabilities associated with misinterpretation of export regulations or claiming exemption inaccurately" [S31].
- When no documentation is needed, Apple says to "update your app's information property list (Info.plist) file in Xcode to let us know that your app doesn't use encryption or is exempt from providing documentation." Answering or uploading in App Store Connect needs Account Holder, Admin or App Manager [S33]. Builds without an answer show **Missing Compliance**, which is fixed under TestFlight → build → Manage [S49][S34].
- Classifying Debbie:
  - CryptoKit (X25519, HKDF, ChaCha20-Poly1305) and URLSession HTTPS are "encryption within Apple's operating system" [S28][S35]. Debbie uses no proprietary algorithms, since the brief forbids inventing cryptography [S57].
  - The bundled WebRTC framework ships its own DTLS, SRTP and TLS code [S57], so `containsThirdPartyCryptography = true` from the build that adds it.
  - With no App Store distribution in France, no documentation is required [S32]. That fits `NO` as Apple defines it [S28].
- US law, Reasoning (not legal advice):
  - Since the 2021-03-29 BIS rule (86 FR 16482) [S37], the annual self-classification report in 15 CFR 740.17(e)(3) "applies to 'mass market' encryption components and 'executable software'… as well as to non-'mass market' encryption commodities and software" [S36]. 'executable software' there means software "from an existing hardware component".
  - A consumer app with standard cryptography sold to the general public is a mass-market end item (5D992), not a component. So no annual report is expected.
  - Apple's older note says such apps "might… be required to submit a year-end self-classification report" [S28]. The owner should confirm.
- fastlane hazard: `upload_to_testflight` → `distribute_build` → `set_export_compliance_if_needed`. If the processed build has `usesNonExemptEncryption == nil` (no Info.plist key), fastlane PATCHes the build with the `uses_non_exempt_encryption` option, which defaults to `false` [S44][S40]. The brief forbids answering through fastlane [S57]. Having the key in Info.plist, or never reaching `distribute_build`, prevents it.

### F7. Push environment
- `aps-environment`: "Xcode sets the value of the entitlement based on your app's current provisioning profile… if you're using a development provisioning profile, Xcode sets the value to `development`. Production provisioning profile and Prerelease Versions and Beta Testers use `production`… The `development` environment is also referred to as the `sandbox` environment." [S24]
- Servers: `api.sandbox.push.apple.com` for development and `api.push.apple.com` for production [S25]. A token sent to the wrong environment gets `400 BadDeviceToken`: "Verify… that the token matches the environment". Don't retry it [S26].
- The Simulator "supports the Apple Push Notification Service Sandbox environment", and each simulator generates its own tokens [S27].
- "Apps that you download from the App Store don't contain an embedded provisioning profile" [S23]. Apple DTS: "App Store, and hence TestFlight, re-sign your app before distribution" (a macOS thread, 2024) [S22].
- There is no public iOS API to read your own entitlements at run time: `SecTask` isn't in the iOS 26.5 SDK's Security headers [S58]. So the app has to infer its environment.
- The relay: two SNS platform applications, `APNS` for TestFlight and `APNS_SANDBOX` for Xcode runs, with the environment registered alongside each token [S56]. SNS's platform names are `APNS` and `APNS_SANDBOX` [S55]. `docs/CONTRACTS.md` §8.1 already proposes `POST /v1/push-tokens {"environment": "production" | "sandbox"}`, inferred from the embedded profile [S60]. Its rule needs a Simulator exception.
- Time Sensitive: the local SDK marks `UNAuthorizationOptionTimeSensitive` deprecated with "Use time-sensitive entitlement" [S58]. Time Sensitive Notifications is a capability for Apple Developer Program members [S12], and `.timeSensitive` "breaks through system notification controls" [S61].

### F8. TestFlight: upload, processing and internal testing
- The app record must exist "before uploading a build" [S4]. Xcode's GUI can create it during distribution [S17][S15]. The API can't [S5].
- Statuses:
  - Upload states are Processing, Failed and Complete. "If… it remains in the Processing state for more than 24 hours, there may be an issue" [S50].
  - The API's `Build.processingState` is `PROCESSING|FAILED|INVALID|VALID` [S51].
  - `BuildBetaDetail.internalBuildState` includes `MISSING_EXPORT_COMPLIANCE`, `READY_FOR_BETA_TESTING`, `IN_BETA_TESTING` and `EXPIRED` [S51].
  - `Build.buildAudienceType` is `INTERNAL_ONLY|APP_STORE_ELIGIBLE` [S51].
  - Builds expire after 90 days [S49]. An email arrives when processing ends [S3].
- Internal groups: up to 100 internal testers, who must be App Store Connect users. With "Enable automatic distribution", builds go to the group automatically; without it, they must be added by hand [S48]. The API's `BetaGroup` has `isInternalGroup` and `hasAccessToAllBuilds` [S51]. Reasoning: `hasAccessToAllBuilds` is the API's form of automatic distribution, so check it against the App Store Connect UI once.
- TestFlight Internal Only:
  - "This kind of build can be shared with your team, but can never be submitted to the App Store" [S16].
  - Such builds "can only [be added] to internal tester groups—you can't submit them for external testing or to customers" [S48].
  - xcodebuild exposes it as `testFlightInternalTestingOnly` [S18].
  - The help says this applies to builds "uploaded… from Xcode or Xcode Cloud" [S48]. Whether the flag survives exporting an IPA and uploading it with altool isn't documented (see Open questions).
- `upload_to_testflight` behaviour (2.241.2 source [S44], docs [S40]):
  - `submit_beta_review` defaults to `true`. Its `env_name` is `PILOT_DISTRIBUTE_EXTERNAL`, the same variable as `distribute_external`.
  - `distribute_build` runs `post_beta_app_review_submission` when `submit_beta_review && (groups || distribute_external)`. **Passing an internal group name with the defaults submits the build for Beta App Review.**
  - `skip_submission: true` returns after the build metadata is updated, before `distribute_build`.
  - `skip_waiting_for_build_processing: true` without a `changelog` returns right after upload. With a `changelog`, it waits until the build appears.
  - The changelog (What to Test) is limited to 4000 bytes. Emoji and `<` are stripped.
  - `notify_external_testers: nil` leaves App Store Connect's default alone.
  - With `distribute_only: true`, it distributes, or with `skip_submission` only updates the metadata of, an existing build.
  - The "App Manager" or "Admin" role is needed to update build information [S40].
- `gym`'s `export_method` validation accepts only the old names (`app-store`…) [S44]. xcodebuild 26.6 lists `app-store-connect` and marks `app-store` as deprecated [S18]. Export options that matter:
  - `manageAppVersionAndBuildNumber` defaults to YES.
  - `uploadSymbols` defaults to YES.
  - `destination` is `export|upload`.
  - `signingStyle`, `signingCertificate` and `provisioningProfiles` are "for manual signing only" [S18].
  - `method=validation` exists, and so does `altool --validate-app` [S18][S19].

### F9. How secrets leak, observed on this machine
- `xcodebuild` prints `Command line invocation:` followed by the full argument list. A local run with a fake `-authenticationKeyID FAKEKEYID000` echoed the value. It also rejects a key file that isn't a PEM document before doing anything else [S18].
- gym runs xcodebuild with `print_command: true` [S44]. So the key ID, issuer ID or key path should never be passed through gym's `xcargs`, and every xcodebuild or altool log needs redacting.
- macOS 26.2 has no `timeout` command (`command not found`). Time limits need another mechanism, such as `perl -e 'alarm shift; exec @ARGV'`.

## What changed in the current iOS release
- **iOS 27 (current: 27.2.1).** I found no change to TestFlight's or APNs' environment rules or to the `aps-environment` documentation tied to iOS 27 [S24][S1]. iOS 27 needs iPhone 11 or later, and XS/XR stay on iOS 18.7.x [S1]. That matters for the minimum-iOS decision in note 02, not for delivery.
- **Upload requirements (App Store Connect, not the OS):** the Xcode 26 / iOS 26 SDK minimum (since 2026-04-28) is still in force, and the iOS 13 minimum deployment target is **new since 2026-09-09** [S2]. No Xcode 27 or iOS 27 SDK upload requirement had been announced. **Nothing in this pipeline needs a newer SDK than 26.5.** If Apple later announces an iOS 27 SDK minimum, Xcode 27 is needed, and this Mac would also need a macOS update (see note 01).
- **Tooling changes since mid-2026:**
  - fastlane gained Ruby 4 support in 2.238.0, requires Ruby 3.2 or later from 2.241.0, and reverted API-key support in `produce` in 2.241.1 [S45].
  - The transporter's cleanup of `~/.appstoreconnect/private_keys` was fixed after 2.240.1 [S44].
  - altool 26.40.1 documents kebab-case `--api-key`/`--api-issuer` and new `--p8-file-path`, `--upload-package --wait` and `--build-status` options. fastlane still passes the camelCase `--apiKey`/`--apiIssuer` [S19][S44].
  - The App Store Connect API now has a Build Uploads resource, and fastlane's build-number lookup uses it [S52][S44].

## Recommendations for Debbie

**Credentials and fastlane**
- **R1. Ship with the installed Xcode 26.6 / iOS 26.5 SDK.**
  - `preflight` fails if the major version from `xcodebuild -version` is below 26.
  - `IPHONEOS_DEPLOYMENT_TARGET` must be ≥ 13.0. Note 02 picks the real value.
  - Re-read the Upcoming Requirements page before the final upload. [S2][S3]
  - ADOPT-TONIGHT: it is the only toolchain we have, and App Store Connect accepts it.
- **R2. Use an App Store Connect Team key with the Admin role.**
  - Load it once per lane with `app_store_connect_api_key(key_id: ENV["ASC_KEY_ID"], issuer_id: ENV["ASC_ISSUER_ID"], key_filepath: ENV["ASC_KEY_PATH"], duration: 1200, in_house: false)`.
  - Other actions take it from `lane_context`, and spaceship from `Spaceship::ConnectAPI.token`.
  - Our code never reads or copies the `.p8`. [S14][S13][S21][S38][S39]
  - ADOPT-TONIGHT: individual keys can't provision, and non-Admin keys can't create distribution certificates.
- **R3. Pin fastlane with a committed `Gemfile` and `Gemfile.lock`** (exact files below).
  - Once: `bundle config set --local path vendor/bundle`, `bundle install`, then `bundle config set --local frozen true`.
  - Always run lanes through `tools/ci/fl` (below), never the global `/opt/homebrew/bin/fastlane` 2.240.1.
  - Check: `bundle exec fastlane --version` prints 2.241.2. [S46][S47][S45][S44]
  - ADOPT-TONIGHT: Bundler 4 otherwise installs into the system Gem.dir, and the global 2.240.1 can wipe `~/.appstoreconnect/private_keys`.
- **R4. Run fastlane only through the wrapper, with this environment:**
  - stdin from `/dev/null`, `CI=1`, `FASTLANE_OPT_OUT_USAGE=YES` and `FASTLANE_SKIP_UPDATE_CHECK=1`;
  - `asc.env` read with `set -a; . "$HOME/.config/debbie-ios/asc.env"; set +a` inside the wrapper's own process;
  - never `--verbose`, `fastlane env`, `setup_ci`, `FASTLANE_ITUNES_TRANSPORTER_USE_SHELL_SCRIPT` or `FASTLANE_ITUNES_TRANSPORTER_PATH`;
  - `opt_out_usage` as the first line of the Fastfile.
  - [S44][S57]
  - ADOPT-TONIGHT: any Apple ID prompt fails instead of hanging, nothing is tracked, and the default keychain stays untouched.
- **R5. Redact every log.**
  - xcodebuild and altool run only through `tools/ci/xcb.sh`, which pipes output through a `perl` filter that replaces the values of `ASC_KEY_ID`, `ASC_ISSUER_ID` and `ASC_KEY_PATH` with `[REDACTED]` before writing `logs/<step>-<N>.log`.
  - `tools/ci/check-logs.sh` exits non-zero if any value appears in `logs/` or `build/`, and prints only file names.
  - It runs before every commit. [S18][S44][S57]
  - ADOPT-TONIGHT: xcodebuild echoes its arguments, as tested here.

**Signing**
- **R6. Sign manually with `cert` and `sigh` into a dedicated keychain. Don't use automatic or cloud signing, and don't use `match`.**
  - Keychain `.signing/debbie-signing.keychain-db` (gitignored, `.signing/` mode 0700), with a random 64-hex password in `.signing/keychain-password` (mode 0600).
  - `create_keychain(path:, password:, default_keychain: false, unlock: true, timeout: 28800, lock_when_sleeps: false, add_to_search_list: true)`.
  - `cert(development: false, generate_apple_certs: true, keychain_path:, keychain_password:, output_path: ".signing/certs")`.
  - `sigh(app_identifier:, cert_id: ENV["CER_CERTIFICATE_ID"], force: false, provisioning_name: "Debbie AppStore <id>", output_path: ".signing/profiles")` for the app and for the NSE.
  - Archive and export with `CODE_SIGN_STYLE=Manual`, the certificate's SHA-1 as the identity, per-target `PROVISIONING_PROFILE_SPECIFIER`, and `OTHER_CODE_SIGN_FLAGS=--keychain $(SRCROOT)/.signing/debbie-signing.keychain-db`.
  - Record in MORNING_REPORT.md, with the undo for each:
    - the keychain: `security delete-keychain <path>` removes it from the list and deletes it;
    - the certificate ID: the owner revokes it after the hackathon;
    - the profile UUIDs: the files in `~/Library/Developer/Xcode/UserData/Provisioning Profiles`.
  - In later lanes, unlock with `unlock_keychain(path:, password:, add_to_search_list: true, set_default: false)`. `true` appends; never pass `:replace`, which rewrites the search list [S44].
  - Export re-signs with the certificate's unique SHA-1, so it can't pick another identity.
  - Check: `security find-identity -v -p codesigning .signing/debbie-signing.keychain-db` shows exactly 1 identity, and `security list-keychains -d user` still begins with `login.keychain-db`.
  - [S43][S44][S59][S15][S18][S57]
  - ADOPT-TONIGHT: this is the only option that uses only the items we create, never touches the login keychain, and needs no device.
- **R7. Provision in this order, once, in a `signing_setup` lane:**
  1. Register `BUNDLE_ID.NotificationService` if it's missing.
  2. Enable `PUSH_NOTIFICATIONS`, `USERNOTIFICATIONS_TIMESENSITIVE` and `HEALTHKIT` on `BUNDLE_ID`. The NSE needs none.
  3. Create the certificate.
  4. Create the profiles.
  - Write each capability in PROGRESS.md before enabling it. Enable only; never disable.
  - If the time-sensitive capability is rejected (it isn't in Apple's documented enum), stop. The owner ticks it on the website (O4).
  - If `cert` reports the maximum, stop and record it (O5).
  - Never pass `force: true`, and never run `cert revoke_expired`.
  - [S6][S7][S8][S11][S44][S57]
  - ADOPT-TONIGHT: enabling a capability after profiles exist invalidates them.
- **R8. No App Group tonight.**
  - The app and the NSE share the Keychain group `$(AppIdentifierPrefix)<BUNDLE_ID>.shared` through `keychain-access-groups` in both entitlements files. No portal step is needed.
  - Check: decode the profile with `security cms -D -i <profile>`. `Entitlements.keychain-access-groups` should cover `<TEAMID>.*`. Reasoning: that's how team-prefixed groups are authorised; verify it on the first profile.
  - If an App Group becomes necessary, follow O3. The API can't do it.
  - [S54][S9][S10][S11]
  - ADOPT-TONIGHT: it avoids a manual blocker that the API can't remove.

**Building and uploading**
- **R9. Set the build number to `[latest_testflight_build_number(app_identifier:, initial_build_number: 0), last number in build/last-uploaded-build].max + 1`.**
  - Pass it as `CURRENT_PROJECT_VERSION=N` on the xcodebuild command line.
  - Both Info.plists use `$(CURRENT_PROJECT_VERSION)` and `$(MARKETING_VERSION)`. `MARKETING_VERSION` stays `1.0` all night.
  - Never use agvtool or `increment_build_number`.
  - Check: `CFBundleVersion` equals N in the IPA's app and `.appex` Info.plists. [S41][S44][S42][S53][S3]
  - ADOPT-TONIGHT: it always stays above the latest upload and leaves no project diffs.
- **R10. Generate the export options at run time into gitignored `build/ExportOptions.plist`:**
  - `method=app-store-connect` and `destination=export`;
  - `signingStyle=manual`, `signingCertificate=<SHA-1>`, and `provisioningProfiles={BUNDLE_ID: <app profile UUID>, BUNDLE_ID.NotificationService: <NSE profile UUID>}`;
  - `teamID=$APPLE_TEAM_ID`;
  - `testFlightInternalTestingOnly=true`, `manageAppVersionAndBuildNumber=false`, `uploadSymbols=true`.
  - [S18][S16][S48]
  - ADOPT-TONIGHT: it is deterministic, it signs no Xcode-managed build numbers, and it adds a second guard against external or App Store submission.
- **R11. Upload with exactly:**
  ```ruby
  upload_to_testflight(ipa:, app_identifier:, skip_submission: true, skip_waiting_for_build_processing: true,
                       distribute_external: false, submit_beta_review: false)
  ```
  - Pass no `groups`, `changelog`, `beta_app_review_info`, `notify_external_testers`, `expire_previous_builds` or `reject_build_waiting_for_review`.
  - Run it in the background with logs in `logs/`, at most about once an hour.
  - Check: the log says "Successfully uploaded" and contains no "beta review" or "Export compliance has been set".
  - Fallback after 2 failures for the same reason: `xcodebuild -exportArchive` with `destination=upload` and the `-authenticationKey*` flags, run through R5's redactor. [S40][S44][S18][S57]
  - ADOPT-TONIGHT: these flags make a Beta App Review submission or an API compliance answer impossible.
- **R12. Check processing later with a read-only `beta_status build:N` lane. Then set "What to Test" in a separate `beta_notes` lane:**
  ```ruby
  upload_to_testflight(distribute_only: true, app_version:, build_number:, changelog:,
                       skip_submission: true, distribute_external: false, submit_beta_review: false)
  ```
  - `beta_status` reads `processingState`, `internalBuildState`, `buildAudienceType` and `usesNonExemptEncryption`.
  - Run `beta_notes` only when `processingState == VALID`.
  - Notes are plain text of 600 bytes or less (fastlane's hard limit is 4000), with no emoji and no `<`. They name the build's features, how to open the demo home, and known issues.
  - Poll every 5 minutes at most.
  - `PROCESSING` for more than 24 hours, or `INVALID`/`FAILED`: stop uploading and record it.
  - Check: PROGRESS.md records the build number, time, result and state.
  - [S51][S50][S44][S40][S57]
  - ADOPT-TONIGHT: the brief says to upload without waiting, then check with a read-only call.
- **R13. Internal group.**
  - `preflight` lists internal groups: name, `hasAccessToAllBuilds` and tester count, never names or emails.
  - Use the group with `hasAccessToAllBuilds == true` and at least one tester. If there are several, record the choice under "Decisions to confirm".
  - If none has automatic distribution, add each VALID build only to that internal group with `upload_to_testflight(distribute_only: true, build_number:, groups: ["<internal group name>"], distribute_external: false, submit_beta_review: false)`. Assert `isInternalGroup` first.
  - Never create groups or invite testers.
  - [S48][S51][S44][S57]
  - ADOPT-TONIGHT: the build is installable in the morning without touching Beta App Review.
- **R14. Validate each IPA before upload with `tools/ci/validate-ipa.sh N`.** It fails on any miss.
  - App Info.plist:
    - `CFBundleVersion == N`, `CFBundleShortVersionString == 1.0`, `ITSAppUsesNonExemptEncryption == false`;
    - purpose strings present for every API used: `NSCameraUsageDescription`, `NSLocalNetworkUsageDescription` with `NSBonjourServices` containing `_debbie._tcp`, and `NSHealthShareUsageDescription` once HealthKit is in;
    - a `PrivacyInfo.xcprivacy` in the app bundle;
    - the app icon in `Assets.car`, checked with `xcrun assetutil --info`.
  - `codesign -d --entitlements - --xml` on the app shows `aps-environment = production`, `com.apple.developer.usernotifications.time-sensitive = true`, and the keychain group.
  - The `.appex` shows the same keychain group.
  - `embedded.mobileprovision` is an App Store profile for the right team.
  - Optionally, `xcrun altool --validate-app -f <ipa> -t ios` with API-key authentication, through R5.
  - [S2][S19][S24][S57]
  - ADOPT-TONIGHT: the brief requires validation, and catching an INVALID locally saves an hour.

**Export compliance and push**
- **R15. Export compliance: set `INFOPLIST_KEY_ITSAppUsesNonExemptEncryption = NO` (Boolean false) on the app target only. Never answer through the API or fastlane.**
  - Decision for the owner to confirm. Reasoning: Apple-OS crypto plus standard algorithms in WebRTC, with no App Store distribution in France, needs no documentation, which is Apple's definition of `NO`. No US annual self-classification report should be due for a mass-market end item.
  - If Debbie is ever offered on the App Store in France with WebRTC, it needs the French declaration, then `YES` plus `ITSEncryptionExportComplianceCode`.
  - If "Missing Compliance" appears anyway, the owner answers in App Store Connect → TestFlight → build → Manage:
    - proprietary algorithms: **No**;
    - standard algorithms instead of or in addition to Apple's OS: **Yes** for builds that contain WebRTC, or "None of the algorithms mentioned above" for builds before WebRTC;
    - available on the App Store in France: **No**;
    - then Save.
  - Check after processing: `usesNonExemptEncryption == false` and `internalBuildState != MISSING_EXPORT_COMPLIANCE`.
  - [S28][S29][S32][S35][S34][S36][S37][S31][S44]
  - ADOPT-TONIGHT: the brief requires the Info.plist answer.
- **R16. Push entitlement and environment.**
  - App entitlements: `aps-environment = $(DEBBIE_APS_ENVIRONMENT)`, with Debug = `development` and Release = `production`.
  - The app target carries `com.apple.developer.usernotifications.time-sensitive = true`.
  - At run time, report:
    - `sandbox` under `#if targetEnvironment(simulator)`;
    - otherwise, if `embedded.mobileprovision` exists, its `Entitlements["aps-environment"]` (`development` → `sandbox`, `production` → `production`);
    - otherwise `production`.
  - Send it with every `POST /v1/push-tokens`.
  - Unit-test the parser with: no profile → production; a development profile → sandbox; an App Store or ad hoc profile → production.
  - Reasoning: don't derive APNs from StoreKit's `AppTransaction.environment`. That describes App Store servers, not APNs.
  - Tell the relay: create the endpoint under `APNS` for `production` and `APNS_SANDBOX` for `sandbox`, keep each token's environment, and never retry `BadDeviceToken`. Update CONTRACTS.md §8.1 with the Simulator case.
  - [S24][S23][S22][S27][S25][S26][S55][S56][S60][S58]
  - ADOPT-TONIGHT: Layer 1's push test (build step 0b) needs a correctly reporting build.
- **R17. `preflight` is read-only and prints only non-secret facts:**
  - each asc.env name is present (names, never values) and the key file is readable;
  - the JWT works (`GET /v1/apps?filter[bundleId]=`);
  - whether the app record is present;
  - the app and NSE bundle IDs, each with its sorted capability types;
  - the count of `DISTRIBUTION` certificates;
  - internal groups as in R13;
  - the latest build number;
  - the Xcode and SDK versions;
  - whether the dedicated keychain exists.
  - No read-only endpoint reveals a team key's role. Reasoning: Apple documents none. So a 200 on `GET /v1/bundleIds` and `GET /v1/certificates` is necessary but not proof. The first write in R7 is the proof, and a 403 there means the owner needs an Admin key (O6). [S5][S6][S14][S44][S57]
  - ADOPT-TONIGHT: the brief's Phase 0 gate.
- **R18. Prove signing in Phase 0 with `beta dry_run:true`:** archive, export and `validate-ipa`, with no upload.
  - Run it in the background with stdin closed and a 30-minute `perl alarm` limit.
  - Write to `build/scratch/` and `logs/`.
  - If it hangs, prompts, or errors twice for the same reason, record a blocker. Don't switch to the owner's identities.
  - Then upload the Phase 4 shell, which already carries push, Time Sensitive, the NSE and the keychain group (§7). [S57][S18]
  - ADOPT-TONIGHT: the brief requires it.
- **R19. LATER: switch to `xcodebuild … destination=upload` with the Build Upload API and webhook status.** That would replace polling and guarantee "TestFlight Internal Only". [S52][S48]
  - LATER: altool works tonight; this adds a second redaction surface.
- **R20. LATER, after the hackathon (owner):** revoke the API key and the Debbie distribution certificate, run `security delete-keychain` on the Debbie keychain, and remove the two profiles. If the team grows, consider `match` with private storage or Xcode Cloud. [S14][S44]
  - LATER: cleanup and scale-up, not needed tonight.

### Exact files and lanes

`Gemfile` (commit together with `Gemfile.lock`):
```ruby
# frozen_string_literal: true
source "https://rubygems.org"
gem "fastlane", "2.241.2" # exact pin; needs Ruby >= 3.2, Bundler < 5 (rubygems metadata)
```

`tools/ci/fl` (wrapper; relocatable):
```sh
#!/bin/bash
set -euo pipefail
ROOT="$(cd "$(dirname "$0")/../.." && pwd)"; cd "$ROOT"
ENVF="$HOME/.config/debbie-ios/asc.env"
if [ -r "$ENVF" ]; then set -a; . "$ENVF"; set +a; fi   # values stay in this process; never echoed
export CI=1 FASTLANE_OPT_OUT_USAGE=YES FASTLANE_SKIP_UPDATE_CHECK=1 FASTLANE_HIDE_CHANGELOG=1 \
       LANG=en_US.UTF-8 LC_ALL=en_US.UTF-8 BUNDLE_PATH=vendor/bundle BUNDLE_FROZEN=true
mkdir -p logs
exec bundle exec fastlane "$@" </dev/null
```

`tools/ci/xcb.sh` (the core of it; every xcodebuild call goes through `run`):
```sh
#!/bin/bash
set -euo pipefail
ROOT="$(cd "$(dirname "$0")/../.." && pwd)"
redact() { perl -pe 'BEGIN{@v=grep{length}map{$ENV{$_}//""}qw(ASC_KEY_ID ASC_ISSUER_ID ASC_KEY_PATH)} for my $v(@v){s/\Q$v\E/[REDACTED]/g}'; }
limit()  { local s=$1; shift; perl -e 'alarm shift; exec @ARGV' "$s" "$@"; }   # macOS has no `timeout`
run()    { local name=$1 secs=$2; shift 2; limit "$secs" "$@" </dev/null 2>&1 | redact > "$ROOT/logs/$name.log"; }
N="${2:-0}"
case "$1" in
  build-sim) run build-sim 1800 xcodebuild build -project "$ROOT/Debbie.xcodeproj" -scheme Debbie \
               -destination 'generic/platform=iOS Simulator' -derivedDataPath "$ROOT/build/DerivedData" CODE_SIGNING_ALLOWED=NO ;;
  archive)   run "archive-$N" 3600 xcodebuild archive -project "$ROOT/Debbie.xcodeproj" -scheme Debbie -configuration Release \
               -destination 'generic/platform=iOS' -archivePath "$ROOT/build/archives/Debbie-$N.xcarchive" \
               -derivedDataPath "$ROOT/build/DerivedData" CURRENT_PROJECT_VERSION="$N" ;;
  export)    run "export-$N" 1200 xcodebuild -exportArchive -archivePath "$ROOT/build/archives/Debbie-$N.xcarchive" \
               -exportOptionsPlist "$ROOT/build/ExportOptions.plist" -exportPath "$ROOT/build/export/$N" ;;
  test)      run test 3600 xcodebuild test -project "$ROOT/Debbie.xcodeproj" -scheme Debbie \
               -destination 'platform=iOS Simulator,name=Debbie SE' -derivedDataPath "$ROOT/build/DerivedData" \
               -resultBundlePath "$ROOT/build/results/test-$(date +%Y%m%d-%H%M%S).xcresult" ;;
  *) echo "usage: xcb.sh build-sim|test|archive N|export N" >&2; exit 2 ;;
esac
```
(Keychain-sharing tests in the Simulator need simulator signing, not `CODE_SIGNING_ALLOWED=NO`; see note 11. The "Debbie SE" simulator is the one `tools/sim/sim.sh` creates.)

`Config/Signing.xcconfig` (committed; values come from gitignored `Config/Signing.local.xcconfig`, which `signing_setup` writes. Add `Config/*.local.xcconfig` to `.gitignore`.):
```
CODE_SIGN_STYLE = Manual
DEVELOPMENT_TEAM = $(DEBBIE_TEAM_ID)
CODE_SIGN_IDENTITY[sdk=iphoneos*] = $(DEBBIE_SIGNING_IDENTITY)   // SHA-1 of our Apple Distribution cert
OTHER_CODE_SIGN_FLAGS[sdk=iphoneos*] = --keychain $(SRCROOT)/.signing/debbie-signing.keychain-db
DEBBIE_APS_ENVIRONMENT = production                             // Debug config overrides: development
#include? "Signing.local.xcconfig"
// App target: PROVISIONING_PROFILE_SPECIFIER[sdk=iphoneos*] = $(DEBBIE_APP_PROFILE)
// NSE target: PROVISIONING_PROFILE_SPECIFIER[sdk=iphoneos*] = $(DEBBIE_NSE_PROFILE)
```

`fastlane/Fastfile` (a sketch: every API call named here was checked against the fastlane 2.240.1/2.241.2 source [S44]):
```ruby
opt_out_usage
default_platform(:ios)
ROOT     = File.expand_path("..", __dir__)
SIGNING  = File.join(ROOT, ".signing")
KEYCHAIN = File.join(SIGNING, "debbie-signing.keychain-db")
def env!(k) = (ENV[k].to_s.strip.empty? ? UI.user_error!("asc.env: #{k} missing") : ENV[k])   # names only
def key!
  app_store_connect_api_key(key_id: env!("ASC_KEY_ID"), issuer_id: env!("ASC_ISSUER_ID"),
                            key_filepath: env!("ASC_KEY_PATH"), duration: 1200, in_house: false)
end
def nse_id = "#{env!('BUNDLE_ID')}.NotificationService"
def kc_pw  = File.read(File.join(SIGNING, "keychain-password")).strip

platform :ios do
  lane :preflight do                                    # READ-ONLY
    %w[ASC_KEY_ID ASC_ISSUER_ID ASC_KEY_PATH APPLE_TEAM_ID BUNDLE_ID].each { |k| env!(k) }
    UI.user_error!("ASC_KEY_PATH is not a readable file") unless File.file?(ENV["ASC_KEY_PATH"]) && File.readable?(ENV["ASC_KEY_PATH"])
    key!
    bid = env!("BUNDLE_ID")
    app = Spaceship::ConnectAPI::App.find(bid)
    UI.important("App record: #{app ? 'present' : 'MISSING (owner step O1)'}")
    [bid, nse_id].each do |id|
      b = Spaceship::ConnectAPI::BundleId.find(id)
      UI.message("#{id}: #{b ? b.get_capabilities.map(&:capability_type).compact.sort.join(',') : 'NOT REGISTERED'}")
    end
    UI.message("DISTRIBUTION certificates on team: #{Spaceship::ConnectAPI::Certificate.all(filter: { certificateType: 'DISTRIBUTION' }).count}")
    next unless app
    app.get_beta_groups.select(&:is_internal_group).each do |g|
      n = Spaceship::ConnectAPI::BetaTester.all(filter: { betaGroups: g.id }).count
      UI.message("Internal group '#{g.name}': automatic=#{g.has_access_to_all_builds} testers=#{n}")
    end
    UI.message("Latest uploaded build: #{latest_testflight_build_number(app_identifier: bid, initial_build_number: 0)}")
  end

  lane :signing_setup do                                # WRITES: only what brief §3 allows
    key!
    bid = env!("BUNDLE_ID")
    UI.user_error!("#{bid} not registered: owner step") unless Spaceship::ConnectAPI::BundleId.find(bid)
    Spaceship::ConnectAPI::BundleId.create(name: "Debbie Notification Service", platform: "IOS", identifier: nse_id) unless Spaceship::ConnectAPI::BundleId.find(nse_id)
    app_id = Spaceship::ConnectAPI::BundleId.find(bid)
    have = app_id.get_capabilities.map(&:capability_type)
    %w[PUSH_NOTIFICATIONS USERNOTIFICATIONS_TIMESENSITIVE HEALTHKIT].each do |cap|   # listed in PROGRESS.md first
      Spaceship::ConnectAPI::BundleIdCapability.create(bundle_id_id: app_id.id, capability_type: cap) unless have.include?(cap)
    end
    FileUtils.mkdir_p(SIGNING, mode: 0o700)
    pwf = File.join(SIGNING, "keychain-password")
    File.write(pwf, SecureRandom.hex(32), perm: 0o600) unless File.exist?(pwf)
    create_keychain(path: KEYCHAIN, password: kc_pw, default_keychain: false, unlock: true, timeout: 28_800,
                    lock_when_sleeps: false, add_to_search_list: true, require_create: false)
    cert(development: false, generate_apple_certs: true, keychain_path: KEYCHAIN, keychain_password: kc_pw,
         output_path: File.join(SIGNING, "certs"))
    [bid, nse_id].each do |id|
      sigh(app_identifier: id, cert_id: ENV["CER_CERTIFICATE_ID"], force: false,
           provisioning_name: "Debbie AppStore #{id}", output_path: File.join(SIGNING, "profiles"))
    end
    # then write Config/Signing.local.xcconfig + build/ExportOptions.plist (UUIDs, SHA-1, team); print nothing secret
  end

  lane :test  do sh(File.join(ROOT, "tools/ci/xcb.sh"), "test"); sh("node", File.join(ROOT, "tools/contracts/verify-vectors.mjs")) end
  lane :build do sh(File.join(ROOT, "tools/ci/xcb.sh"), "build-sim") end

  lane :beta do |o|
    key!
    bid  = env!("BUNDLE_ID")
    last = File.read(File.join(ROOT, "build/last-uploaded-build")).to_i rescue 0
    n    = [latest_testflight_build_number(app_identifier: bid, initial_build_number: 0), last].max + 1
    unlock_keychain(path: KEYCHAIN, password: kc_pw, add_to_search_list: true, set_default: false)
    sh(File.join(ROOT, "tools/ci/xcb.sh"), "archive", n.to_s)
    sh(File.join(ROOT, "tools/ci/xcb.sh"), "export", n.to_s)
    sh(File.join(ROOT, "tools/ci/validate-ipa.sh"), n.to_s)
    next if o[:dry_run]
    upload_to_testflight(ipa: File.join(ROOT, "build/export/#{n}/Debbie.ipa"), app_identifier: bid,
                         skip_submission: true, skip_waiting_for_build_processing: true,
                         distribute_external: false, submit_beta_review: false)
    File.write(File.join(ROOT, "build/last-uploaded-build"), n.to_s)
  end

  lane :beta_status do |o|                              # READ-ONLY
    key!
    app = Spaceship::ConnectAPI::App.find(env!("BUNDLE_ID"))
    b = Spaceship::ConnectAPI::Build.all(app_id: app.id, build_number: o[:build].to_s, limit: 1).first
    UI.message("build #{o[:build]}: processing=#{b&.processing_state} internal=#{b&.build_beta_detail&.internal_build_state} nonExemptEncryption=#{b&.uses_non_exempt_encryption.inspect}")
  end

  lane :beta_notes do |o|                               # one write: What to Test, after VALID
    key!
    upload_to_testflight(distribute_only: true, app_identifier: env!("BUNDLE_ID"), app_version: o[:version],
                         build_number: o[:build].to_s, changelog: File.read(File.join(ROOT, "fastlane/what_to_test/#{o[:build]}.txt")),
                         skip_submission: true, distribute_external: false, submit_beta_review: false)
  end
end
```
(`buildAudienceType` isn't mapped by spaceship's `Build` model as far as I checked. Read it with a raw `GET /v1/builds/{id}?fields[builds]=buildAudienceType` if R10's guard needs proof.)

### Manual steps for the owner (the API can't do these)
- **O1, the app record:** App Store Connect → Apps → **+** → New App.
  - Platforms: iOS.
  - Name: "Debbie", or the nearest available name.
  - Primary Language: English (U.S.).
  - Bundle ID: pick `BUNDLE_ID`.
  - SKU: `debbie-ios-1`.
  - User Access: Full Access → Create. [S4]
- **O2, the internal group:** the app → TestFlight → **+** next to Internal Testing.
  - Name it, tick "Enable automatic distribution", Create.
  - Invite Testers → choose yourself → Add. [S48]
- **O3, only if an App Group is adopted later:**
  1. Certificates, Identifiers & Profiles → Identifiers → **+** → App Groups → Continue.
  2. Description "Debbie", identifier `group.<BUNDLE_ID>` → Continue → Register.
  3. Then, for `BUNDLE_ID` and `BUNDLE_ID.NotificationService`: Edit → tick App Groups → Configure → select the group → Continue → Assign → Done.
  4. Then rerun `signing_setup`, because the profiles become invalid. [S10][S11]
- **O4, if the API refuses `USERNOTIFICATIONS_TIMESENSITIVE`:** Identifiers → `BUNDLE_ID` → Edit → tick "Time Sensitive Notifications" → Save, then rerun `signing_setup`. [S11][S12]
- **O5, if the team is at its distribution-certificate limit:** the owner decides whether to revoke one. The agent never does. [S57]
- **O6, if a provisioning write returns 403:** create a Team key with the **Admin** role (Users and Access → Integrations → App Store Connect API → Team Keys → Generate) and update `asc.env`. [S14]
- **O7, if a build shows Missing Compliance:** answer as in R15. [S34]

## Open questions / risks
- **Does `testFlightInternalTestingOnly` survive export plus altool upload?** Apple documents it for uploads from Xcode or Xcode Cloud [S48]. After the first upload, read `buildAudienceType`. If it shows `APP_STORE_ELIGIBLE`, R11's flags still stop any submission. Switching to R19 restores the guard.
- **`USERNOTIFICATIONS_TIMESENSITIVE` is undocumented in Apple's CapabilityType page** [S8]. Only fastlane's spaceship uses it [S44]. If it's refused, follow O4.
- **HealthKit background delivery:** whether the `HEALTHKIT` capability alone authorises `com.apple.developer.healthkit.background-delivery` in an App Store profile wasn't verified. Decode the profile after R7.
- **fastlane passes `--apiKey/--apiIssuer` while altool 26.40.1 documents `--api-key/--api-issuer`** [S19][S44]. The first upload proves which works. If it fails, upload with altool directly using `--p8-file-path`, or with R19.
- **`cert` writes the distribution private key unencrypted** to `.signing/certs/<id>.p12` [S44]. Keep `.signing/` at mode 0700, gitignored, and delete the file after import. Record that the key exists only in the Debbie keychain.
- **The keychain stays unlocked for up to 8 hours** (timeout 28800) so codesign never prompts. That's an overnight exposure, recorded for the owner.
- **Export compliance is a legal call** [S31]. The `NO` answer depends on "not on the App Store in France" and on the mass-market reading of 15 CFR 740.17 [S36]. The owner confirms.
- **Processing time has no Apple SLA.** Only the 24-hour "may be an issue" line exists [S50]. Reasoning: plan 10–60 minutes, and never block feature work on it.
- **Role detection:** there's no read-only way to prove the key is Admin (R17). The first write is the test.
- **The push environment for TestFlight on iOS** relies on TN3125's App Store statement plus a DTS reply in a macOS thread [S23][S22]. Confirm on the owner's iPhone: the TestFlight build should register `production`, and the relay's first push through `APNS` should arrive.

## Sources
- [S1] About Apple security releases (iOS 27.2.1 09 Nov 2026; 27.2 26 Oct 2026; 27.1 iPhone Duo; iOS 27 14 Sep 2026; iOS 18.7.12) — Apple — https://support.apple.com/en-us/100100 — undated (continuously updated) — accessed 2026-11-14 — primary
- [S2] Upcoming Requirements — Apple Developer News — https://developer.apple.com/news/upcoming-requirements/ — entries dated 2026-04-28 and 2026-09-09 — accessed 2026-11-14 — primary
- [S3] Upload builds — App Store Connect Help — https://developer.apple.com/help/app-store-connect/manage-builds/upload-builds/ — undated — accessed 2026-11-14 — primary
- [S4] Add a new app — App Store Connect Help — https://developer.apple.com/help/app-store-connect/create-an-app-record/add-a-new-app/ — undated — accessed 2026-11-14 — primary
- [S5] Apps (App Store Connect API) — Apple — https://developer.apple.com/documentation/appstoreconnectapi/apps — undated — accessed 2026-11-14 — primary
- [S6] Register a new bundle ID (POST /v1/bundleIds) — Apple — https://developer.apple.com/documentation/appstoreconnectapi/post-v1-bundleids — undated — accessed 2026-11-14 — primary
- [S7] Enable a capability (POST /v1/bundleIdCapabilities) — Apple — https://developer.apple.com/documentation/appstoreconnectapi/post-v1-bundleidcapabilities — undated — accessed 2026-11-14 — primary
- [S8] CapabilityType — Apple — https://developer.apple.com/documentation/appstoreconnectapi/capabilitytype — undated — accessed 2026-11-14 — primary
- [S9] CapabilitySetting — Apple — https://developer.apple.com/documentation/appstoreconnectapi/capabilitysetting — undated — accessed 2026-11-14 — primary
- [S10] Register an app group — Apple Developer Account Help — https://developer.apple.com/help/account/identifiers/register-an-app-group/ — undated — accessed 2026-11-14 — primary
- [S11] Enable app capabilities — Apple Developer Account Help — https://developer.apple.com/help/account/identifiers/enable-app-capabilities/ — undated — accessed 2026-11-14 — primary
- [S12] Supported capabilities (iOS) — Apple Developer Account Help — https://developer.apple.com/help/account/reference/supported-capabilities-ios/ — undated — accessed 2026-11-14 — primary
- [S13] Program roles — Apple Developer Support — https://developer.apple.com/support/roles/ — undated — accessed 2026-11-14 — primary
- [S14] Creating API Keys for App Store Connect API — Apple — https://developer.apple.com/documentation/appstoreconnectapi/creating-api-keys-for-app-store-connect-api — undated — accessed 2026-11-14 — primary
- [S15] WWDC21 session 10204 "Distribute apps in Xcode with cloud signing" — Apple — https://developer.apple.com/videos/play/wwdc2021/10204/ — 2021-06 — accessed 2026-11-14 — primary
- [S16] WWDC23 session 10224 "Simplify distribution in Xcode and Xcode Cloud" — Apple — https://developer.apple.com/videos/play/wwdc2023/10224/ — 2023-06 — accessed 2026-11-14 — primary
- [S17] Distributing your app for beta testing and releases — Apple Xcode documentation — https://developer.apple.com/documentation/xcode/distributing-your-app-for-beta-testing-and-releases — undated — accessed 2026-11-14 — primary
- [S18] `xcodebuild -help` and a local invocation test with fake key values (Xcode 26.6, 17F113) — Apple, run locally — /Applications/Xcode.app — 2026-11-14 — accessed 2026-11-14 — primary (local tool)
- [S19] `xcrun altool --help` (altool 26.40.1) — Apple, run locally — /Applications/Xcode.app/Contents/SharedFrameworks/ContentDelivery.framework — 2026-11-14 — accessed 2026-11-14 — primary (local tool)
- [S20] Cloud-managed certificates — Apple Developer Account Help — https://developer.apple.com/help/account/certificates/cloud-managed-certificates/ — undated — accessed 2026-11-14 — primary
- [S21] "Why does xcodebuild require admin access to cloud sign for distribution?" (thread 698117) — Apple Developer Forums (community posts) — https://developer.apple.com/forums/thread/698117 — 2022-01 to 2022-03 — accessed 2026-11-14 — secondary
- [S22] "TestFlight Removes my Embedded Provisioning File" (thread 767609, Apple DTS reply) — Apple Developer Forums — https://developer.apple.com/forums/thread/767609 — 2024-10/2024-11 — accessed 2026-11-14 — primary (Apple DTS)
- [S23] TN3125: Inside Code Signing: Provisioning Profiles — Apple — https://developer.apple.com/documentation/technotes/tn3125-inside-code-signing-provisioning-profiles — undated — accessed 2026-11-14 — primary
- [S24] APS Environment Entitlement — Apple — https://developer.apple.com/documentation/bundleresources/entitlements/aps-environment — undated — accessed 2026-11-14 — primary
- [S25] Sending notification requests to APNs — Apple — https://developer.apple.com/documentation/usernotifications/sending-notification-requests-to-apns — undated — accessed 2026-11-14 — primary
- [S26] Handling notification responses from APNs — Apple — https://developer.apple.com/documentation/usernotifications/handling-notification-responses-from-apns — undated — accessed 2026-11-14 — primary
- [S27] Xcode 14 Release Notes (Simulator remote notifications, APNs sandbox) — Apple — https://developer.apple.com/documentation/xcode-release-notes/xcode-14-release-notes — 2022 — accessed 2026-11-14 — primary
- [S28] Complying with Encryption Export Regulations — Apple — https://developer.apple.com/documentation/security/complying-with-encryption-export-regulations — undated — accessed 2026-11-14 — primary
- [S29] ITSAppUsesNonExemptEncryption — Apple — https://developer.apple.com/documentation/bundleresources/information-property-list/itsappusesnonexemptencryption — undated — accessed 2026-11-14 — primary
- [S30] ITSEncryptionExportComplianceCode — Apple — https://developer.apple.com/documentation/bundleresources/information-property-list/itsencryptionexportcompliancecode — undated — accessed 2026-11-14 — primary
- [S31] Overview of export compliance — App Store Connect Help — https://developer.apple.com/help/app-store-connect/manage-app-information/overview-of-export-compliance/ — undated — accessed 2026-11-14 — primary
- [S32] Export compliance documentation for encryption — App Store Connect Help — https://developer.apple.com/help/app-store-connect/reference/app-information/export-compliance-documentation-for-encryption/ — undated — accessed 2026-11-14 — primary
- [S33] Determine and upload app encryption documentation — App Store Connect Help — https://developer.apple.com/help/app-store-connect/manage-app-information/determine-and-upload-app-encryption-documentation/ — undated — accessed 2026-11-14 — primary
- [S34] Provide export compliance information for beta builds — App Store Connect Help — https://developer.apple.com/help/app-store-connect/test-a-beta-version/provide-export-compliance-information-for-beta-builds/ — undated — accessed 2026-11-14 — primary
- [S35] AppEncryptionDeclaration.Attributes — Apple (App Store Connect API) — https://developer.apple.com/documentation/appstoreconnectapi/appencryptiondeclaration/attributes-data.dictionary — undated — accessed 2026-11-14 — primary
- [S36] 15 CFR 740.17 License Exception ENC (current text) — eCFR / US Government — https://www.ecfr.gov/current/title-15/subtitle-B/chapter-VII/subchapter-C/part-740/section-740.17 — current as of 2026-11-14 — accessed 2026-11-14 — primary (regulation)
- [S37] "Export Administration Regulations: Implementation of Wassenaar Arrangement 2019 Plenary Decisions; Elimination of Reporting Requirements for Certain Encryption Items…" (86 FR 16482, doc 2021-05481) — Federal Register / BIS — https://www.federalregister.gov/documents/2021/03/29/2021-05481/export-administration-regulations-implementation-of-wassenaar-arrangement-2019-plenary-decisions — 2021-03-29 — accessed 2026-11-14 — primary (regulation)
- [S38] Using App Store Connect API — fastlane docs — https://docs.fastlane.tools/app-store-connect-api/ — built 2026-11-14 — accessed 2026-11-14 — primary (tool docs)
- [S39] app_store_connect_api_key — fastlane docs — https://docs.fastlane.tools/actions/app_store_connect_api_key/ — built 2026-11-14 — accessed 2026-11-14 — primary (tool docs)
- [S40] upload_to_testflight (pilot) — fastlane docs — https://docs.fastlane.tools/actions/upload_to_testflight/ — built 2026-11-14 — accessed 2026-11-14 — primary (tool docs)
- [S41] latest_testflight_build_number — fastlane docs — https://docs.fastlane.tools/actions/latest_testflight_build_number/ — built 2026-11-14 — accessed 2026-11-14 — primary (tool docs)
- [S42] increment_build_number — fastlane docs — https://docs.fastlane.tools/actions/increment_build_number/ — built 2026-11-14 — accessed 2026-11-14 — primary (tool docs)
- [S43] create_keychain — fastlane docs — https://docs.fastlane.tools/actions/create_keychain/ — built 2026-11-14 — accessed 2026-11-14 — primary (tool docs)
- [S44] fastlane source: 2.240.1 (local Homebrew gem) and tag 2.241.2 (GitHub), files `pilot/lib/pilot/build_manager.rb`, `pilot/lib/pilot/options.rb`, `fastlane_core/lib/fastlane_core/itunes_transporter.rb`, `cert/lib/cert/runner.rb`, `sigh/lib/sigh/runner.rb`, `fastlane/lib/fastlane/actions/{setup_ci,create_keychain,app_store_build_number,app_store_connect_api_key,modify_services}.rb`, `produce/lib/produce/*.rb`, `gym/lib/gym/{options,runner}.rb`, `fastlane_core/lib/fastlane_core/{cert_checker,module}.rb`, `spaceship/lib/spaceship/connect_api/models/*.rb` — fastlane — https://github.com/fastlane/fastlane/tree/2.241.2 — 2026-09-15 (2.240.1) / 2026-10-26 (2.241.2) — accessed 2026-11-14 — primary (tool source)
- [S45] fastlane releases 2.237.0–2.241.2 — fastlane (GitHub) — https://github.com/fastlane/fastlane/releases — 2026-07-05 to 2026-10-26 — accessed 2026-11-14 — primary (tool release notes)
- [S46] fastlane versions and gemspec metadata — rubygems.org API — https://rubygems.org/api/v1/versions/fastlane.json and https://rubygems.org/api/v2/rubygems/fastlane/versions/2.241.2.json — 2026-10-26 (latest) — accessed 2026-11-14 — primary (registry)
- [S47] `bundle help config` / `bundle help install` (Bundler 4.0.20, local) — Bundler / RubyGems — local manual; online at https://guides.rubygems.org/command-reference/bundle-config/ — 2026 — accessed 2026-11-14 — primary (tool docs)
- [S48] Add internal testers — App Store Connect Help — https://developer.apple.com/help/app-store-connect/test-a-beta-version/add-internal-testers/ — undated — accessed 2026-11-14 — primary
- [S49] App build statuses — App Store Connect Help — https://developer.apple.com/help/app-store-connect/reference/app-uploads/app-build-statuses/ — undated — accessed 2026-11-14 — primary
- [S50] Build upload statuses — App Store Connect Help — https://developer.apple.com/help/app-store-connect/reference/app-uploads/build-upload-statuses/ — undated — accessed 2026-11-14 — primary
- [S51] App Store Connect API object docs: BetaGroup.Attributes, Build.Attributes, BuildBetaDetail.Attributes, InternalBetaState, BuildAudienceType — Apple — https://developer.apple.com/documentation/appstoreconnectapi/betagroup/attributes-data.dictionary (and siblings `build/…`, `buildbetadetail/…`, `internalbetastate`, `buildaudiencetype`) — undated — accessed 2026-11-14 — primary
- [S52] Build uploads — Apple (App Store Connect API) — https://developer.apple.com/documentation/appstoreconnectapi/build-uploads — undated — accessed 2026-11-14 — primary
- [S53] CFBundleVersion — Apple — https://developer.apple.com/documentation/bundleresources/information-property-list/cfbundleversion — undated — accessed 2026-11-14 — primary
- [S54] Sharing access to keychain items among a collection of apps — Apple — https://developer.apple.com/documentation/security/sharing-access-to-keychain-items-among-a-collection-of-apps — undated — accessed 2026-11-14 — primary
- [S55] CreatePlatformApplication (Amazon SNS API Reference) — AWS — https://docs.aws.amazon.com/sns/latest/api/API_CreatePlatformApplication.html — undated — accessed 2026-11-14 — secondary
- [S56] Layer 1 design doc, "Remote connection (AWS)" and "Push" — Debbie team (project) — docs/context/upstream/layer1-join-and-connect.local-snapshot.md (layer-1@fa56475) — 2026-11-14 — accessed 2026-11-14 — primary (project source of truth)
- [S57] KICKOFF_PROMPT.md §3 and §7 — project owner (project brief) — KICKOFF_PROMPT.md — 2026-11-14 — accessed 2026-11-14 — primary (project)
- [S58] iOS 26.5 SDK headers and interfaces: `UserNotifications.framework/Headers/UNUserNotificationCenter.h` (`UNAuthorizationOptionTimeSensitive` deprecated, "Use time-sensitive entitlement"), `Security.framework/Headers` (no SecTask), `StoreKit.swiftmodule/arm64e-apple-ios.swiftinterface` (`AppStore.Environment`) — Apple, verified in local SDK — Xcode 26.6 iPhoneOS.sdk — 2026 — accessed 2026-11-14 — primary (local SDK)
- [S59] `man codesign` (`--keychain`) — Apple, local macOS 26.2 — local manual — undated — accessed 2026-11-14 — primary (local tool)
- [S60] docs/CONTRACTS.md §8.1 "Push environment" — Debbie iOS (project) — docs/CONTRACTS.md — 2026-11-14 — accessed 2026-11-14 — primary (project)
- [S61] UNNotificationInterruptionLevel.timeSensitive — Apple — https://developer.apple.com/documentation/usernotifications/unnotificationinterruptionlevel/timesensitive — undated — accessed 2026-11-14 — primary
- [S62] PROGRESS.md, "Environment (checked 09:13 EST)" (fastlane 2.241.2 under Bundler 4 / Ruby 4.0.7, verified 09:40) — Debbie iOS (project) — PROGRESS.md — 2026-11-14 — accessed 2026-11-14 — primary (project evidence)
