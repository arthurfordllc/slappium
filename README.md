# Slappium

**Lightning-fast iOS testing CLI built for AI agents.**

Slappium gives AI agents (Claude, GPT, Gemini, or any LLM) a dead-simple interface to interact with iOS applications running in the Simulator. One command to see the screen. One command to tap. One command to type. Zero runtime dependencies -- just a CLI that wraps Appium's REST API and `xcrun simctl` into fast, composable commands.

```
slap peek              # screenshot + element tree -- instant understanding
slap tap login-button  # tap by testID with auto-wait
slap type email-input "user@example.com"  # type into a field
```

## Why This Exists

There was no good way for AI agents to test iOS apps. Maestro has JVM startup overhead on every command. XCUITest requires compiled test bundles. Raw Appium requires JSON payloads over curl. AI agents need something fundamentally different:

- **One command = one action.** `slap tap login-button`. That's it. No session setup, no JSON, no curl.
- **`peek` gives you everything.** Screenshot + collapsed element tree in a single call. An AI agent can see the screen and know every `testID` instantly.
- **Auto-wait on every interaction.** Element not rendered yet? Slappium polls automatically (configurable timeout). No `sleep`. No retry loops.
- **Rich error messages.** When a `testID` isn't found, the error shows ALL visible `testID`s on screen so you can adapt immediately.
- **Session auto-recovery.** Appium session expired? Next command silently creates a new one. You never notice.
- **Screenshots via `simctl`.** Appium's screenshot API returns black images on dev builds. Slappium uses `xcrun simctl io booted screenshot` which always works.
- **`type` bypasses the keyboard.** Uses Appium's `setValue` directly on the element. No keyboard dismissal, no hidden buttons, no fighting iOS input quirks.

## Stats

| Metric | Value |
|--------|-------|
| Source files | 5 |
| Tests | 41 |
| Bundle size | 26KB |
| Runtime deps | 0 |
| Startup time | ~50ms |

## Quick Start

### Prerequisites

- Node.js 18+
- Xcode + iOS Simulator
- [Appium](https://appium.io/) 2+ with the [XCUITest driver](https://github.com/nicedayfor/appium-xcuitest-driver):

```bash
npm install -g appium
appium driver install xcuitest
appium --port 4723 --relaxed-security &
```

- Your app installed in the Simulator (dev build, not Expo Go)

### Install

```bash
git clone https://github.com/arthurfordllc/slappium.git
cd slappium
npm install
npm run build
```

### Configure

Copy the example config and edit it:

```bash
cp slappium.config.example.json slappium.config.json
```

Edit `slappium.config.json` with your Simulator UDID, app bundle ID, and login credentials.

To find your Simulator UDID:
```bash
xcrun simctl list devices booted
```

### Run

```bash
./bin/slap peek
```

## Commands

### The Big Three (90% of usage)

```bash
slap peek                                # Screenshot + element tree
slap tap <testID>                        # Tap by testID with auto-wait
slap type <testID> <text>                # Clear + type into element
```

### Interaction

```bash
slap tap <testID>                        # Tap by React Native testID
slap tap-text "<label>"                  # Tap by visible text label
slap type <testID> <text>                # Type text (bypasses iOS keyboard)
slap otp <digits>                        # Enter OTP -- types each digit into otp-digit-0..N
slap back                                # Navigate back (tries testID "back-btn", then label "Back")
slap scroll <up|down>                    # Scroll one page
slap scroll-to <testID>                  # Scroll down until element found (max 10 attempts)
```

### Waiting

```bash
slap wait <testID> [timeout]             # Wait for element to appear
slap wait-text "<text>" [timeout]        # Wait for text on screen
slap wait-gone <testID> [timeout]        # Wait for element to disappear
```

### Assertions (exit code 0 = pass, 1 = fail)

```bash
slap assert <testID>                     # Visible -> exit 0
slap assert-text "<text>"                # Text on screen -> exit 0
slap assert-not <testID>                 # NOT visible -> exit 0
```

### Inspection

```bash
slap peek                                # Screenshot + element tree (THE command)
slap tree                                # Element tree only
slap screenshot [name]                   # Screenshot only (via simctl)
slap source                              # Raw XML page source
slap inspect <testID>                    # Element details: type, label, value, visible, enabled
slap find "<text>"                       # Find elements by label/value content
```

### Session & Lifecycle

```bash
slap session                             # Create/verify Appium session (usually automatic)
slap status                              # Check if session is alive
slap login [email] [pass] [otp]          # Full login flow with config defaults
slap reload                              # Shake gesture to reload Metro bundle
slap chain "cmd1" "cmd2" ...             # Run commands sequentially, stop on first failure
```

## How It Works

Slappium is a thin wrapper around two things:

1. **Appium REST API** -- for element finding, tapping, typing, and session management. Uses `accessibility id` locator strategy (React Native `testID` maps directly to this).
2. **`xcrun simctl`** -- for screenshots (Appium returns black images on dev builds) and simulator control.

The element tree parser takes Appium's verbose 500+ line XML page source and collapses it into ~20 lines of meaningful `testID`s and labels. This is what makes `peek` so powerful for AI agents -- you get a complete, readable summary of the screen in one command.

### Key Design Decisions

- **React Native `testID` = Appium `accessibility id`.** This is the primary locator. Set `testID` on your React Native components and Slappium finds them instantly.
- **No keyboard interaction.** `type` uses Appium's `setValue` API to set the value directly on the element, bypassing the iOS keyboard entirely. No keyboard dismissal, no autocorrect, no fighting.
- **Screenshots via simctl, not Appium.** Appium's screenshot endpoint returns a black image on development builds. `xcrun simctl io booted screenshot` works perfectly every time.
- **Session persistence.** The Appium session ID is saved to `/tmp/slappium-session.json`. Subsequent commands reuse it. If the session is dead, a new one is created automatically.

## For AI Agent Developers

If you're building an AI agent that needs to interact with iOS apps, Slappium is designed for you. Here's the typical workflow:

```bash
# 1. See what's on screen
slap peek
# -> saves screenshot to /tmp, prints element tree with all testIDs

# 2. Interact
slap tap login-button
slap type email-input "user@test.com"
slap type password-input "Password123"
slap tap submit-btn

# 3. Handle OTP (one command!)
slap wait otp-digit-0 10000
slap otp 123456

# 4. Verify
slap wait dashboard-header 15000
slap assert-text "Welcome"

# 5. See the new state
slap peek
```

Every command is stateless (connects, acts, exits). Exit codes are meaningful (0 = success, 1 = element not found / assertion failed, 2 = error). Output is concise and parseable. This is what AI agents need.

### Works with React Native, Expo, and native iOS apps

Any app running in the iOS Simulator with accessibility identifiers (React Native `testID`, SwiftUI `.accessibilityIdentifier()`, UIKit `accessibilityIdentifier`) works with Slappium.

## Tests

```bash
npm test            # Run all 41 tests
npm run test:watch  # Watch mode
```

## License

MIT -- see [LICENSE](LICENSE).

## Built by

[Arthur Ford, LLC](https://github.com/arthurfordllc)
