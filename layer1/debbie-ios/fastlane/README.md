fastlane documentation
----

# Installation

Make sure you have the latest version of the Xcode command line tools installed:

```sh
xcode-select --install
```

For _fastlane_ installation instructions, see [Installing _fastlane_](https://docs.fastlane.tools/#installing-fastlane)

# Available Actions

## iOS

### ios preflight

```sh
[bundle exec] fastlane ios preflight
```

Read-only checks (brief §7 Preflight; note 12 R17). Prints names, counts and states — never secrets.

### ios test

```sh
[bundle exec] fastlane ios test
```

Generate, lint, contract vectors, mock-home smoke test, package unit tests, UI main path, warnings

### ios build

```sh
[bundle exec] fastlane ios build
```

Debug Simulator build, unsigned Release device build, Release cleanliness, demo removable by one setting, no warnings

### ios beta

```sh
[bundle exec] fastlane ios beta
```

Archive, sign (dedicated keychain, API key only), validate, upload for INTERNAL testing only

### ios build_status

```sh
[bundle exec] fastlane ios build_status
```

Read-only: the processing state of an uploaded build

### ios beta_notes

```sh
[bundle exec] fastlane ios beta_notes
```

After processing: attach the What to Test notes, and add the build to the internal group if it isn't automatic

----

This README.md is auto-generated and will be re-generated every time [_fastlane_](https://fastlane.tools) is run (tools/ci/fl sets FASTLANE_SKIP_DOCS, so it is edited by hand here).

More information about _fastlane_ can be found on [fastlane.tools](https://fastlane.tools).

The documentation of _fastlane_ can be found on [docs.fastlane.tools](https://docs.fastlane.tools).
