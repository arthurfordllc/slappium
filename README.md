# Slappium

**Lightning-fast iOS & Android testing CLI built for AI agents.**

Slappium gives AI agents (Claude, GPT, Gemini, or any LLM) a dead-simple interface to interact with mobile applications running in the iOS Simulator or Android Emulator. One command to see the screen. One command to tap. One command to type. Zero runtime dependencies -- just a CLI that wraps Appium's REST API into fast, composable commands.

```
slap peek              # screenshot + element tree -- instant understanding
slap tap login-button  # tap by testID with auto-wait
slap type email-input "user@example.com"  # type into a field
```

## Why This Exists

There was no good way for AI agents to test mobile apps. Maestro has JVM startup overhead on every command. XCUITest/Espresso require compiled test bundles. Raw Appium requires JSON payloads over curl. AI agents need something fundamentally different:

- **One command = one action.** `slap tap login-button`. That's it. No session setup, no JSON, no curl.
- **`peek` gives you everything.** Screenshot + collapsed element tree in a single call. An AI agent can see the screen and know every `testID` instantly.
- **Auto-wait on every interaction.** Element not rendered yet? Slappium polls automatically (configurable timeout). No `sleep`. No retry loops.
- **Rich error messages.** When a `testID` isn't found, the error shows ALL visible `testID`s on screen so you can adapt immediately.
- **Session auto-recovery.** Appium session expired? Next command silently creates a new one. You never notice.
- **`type` bypasses the keyboard.** Uses Appium's `setValue` directly on the element. No keyboard dismissal, no hidden buttons, no fighting input quirks.
- **iOS + Android from the same CLI.** Set `"platform": "android"` in your config and every command works on Android. Same testIDs, same workflow.

## Stats

| Metric | Value |
|--------|-------|
| Source files | 6 |
| Tests | 69 |
| Bundle size | 30KB |
| Runtime deps | 0 |
| Startup time | ~50ms |

## Quick Start

### Prerequisites

- Node.js 18+
- [Appium](https://appium.io/) 3+ with the appropriate driver:

**For iOS:**
```bash
npm install -g appium
appium driver install xcuitest
```
- Xcode + iOS Simulator with your app installed (dev build, not Expo Go)

**For Android:**
```bash
npm install -g appium
appium driver install uiautomator2
```
- Android SDK with `ANDROID_HOME` set and `adb` on PATH
- Android Emulator running with your app installed

**Start Appium:**
```bash
appium --port 4723 &
```

### Install

```bash
npm install -g @arthurfordllc/slappium
```

Or from source:
```bash
git clone https://github.com/arthurfordllc/slappium.git
cd slappium
npm install && npm run build
```

### Configure

Copy the example config for your platform:

```bash
# iOS
cp slappium.config.example.json slappium.config.json

# Android
cp slappium.config.android.example.json slappium.config.json
```

Edit `slappium.config.json` with your device UDID, app identifiers, and login credentials.

**Find your device UDID:**
```bash
# iOS Simulator
xcrun simctl list devices booted

# Android Emulator
adb devices
```

### Run

```bash
slap peek
```

## Configuration

```json
{
  "platform": "ios",
  "appiumUrl": "http://127.0.0.1:4723",
  "capabilities": {
    "platformName": "iOS",
    "appium:automationName": "XCUITest",
    "appium:udid": "YOUR-SIMULATOR-UDID",
    "appium:bundleId": "com.your.app",
    "appium:noReset": true,
    "appium:newCommandTimeout": 600
  },
  "defaults": {
    "timeout": 5000,
    "pollInterval": 300,
    "screenshotDir": "/tmp",
    "maxScrollAttempts": 10
  },
  "login": {
    "email": "test@example.com",
    "password": "your-password",
    "otp": "123456"
  }
}
```

Set `"platform": "android"` and swap `capabilities` for Android:

```json
{
  "platform": "android",
  "capabilities": {
    "platformName": "Android",
    "appium:automationName": "UiAutomator2",
    "appium:udid": "emulator-5554",
    "appium:appPackage": "com.your.app",
    "appium:appActivity": ".MainActivity",
    "appium:noReset": true,
    "appium:newCommandTimeout": 600
  }
}
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
slap type <testID> <text>                # Type text (bypasses keyboard)
slap otp <digits>                        # Enter OTP -- types each digit into otp-digit-0..N
slap back                                # Navigate back (testID, label, or hardware back)
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
slap screenshot [name]                   # Screenshot only
slap source                              # Raw XML page source
slap inspect <testID>                    # Element details: type, label, value, visible, enabled
slap find "<text>"                       # Find elements by label/value content
```

### Session & Lifecycle

```bash
slap session                             # Create/verify Appium session (usually automatic)
slap status                              # Check if session is alive
slap login [email] [pass] [otp]          # Full login flow with config defaults
slap reload                              # Trigger Metro bundle reload
slap chain "cmd1" "cmd2" ...             # Run commands sequentially, stop on first failure
```

## How It Works

Slappium wraps two things into a single CLI:

1. **Appium REST API** -- element finding, tapping, typing, and session management.
2. **Platform tools** -- `xcrun simctl` (iOS) or `adb` (Android) for screenshots and device control.

### Element Finding

On iOS, React Native `testID` maps to `accessibilityIdentifier`, which Appium finds via the `accessibility id` locator strategy.

On Android, React Native `testID` maps to both `resource-id` and `content-desc` depending on the component. Slappium handles this automatically -- it tries `accessibility id` first, then falls back to UiAutomator's `resourceId()` selector.

### Element Tree

The tree parser takes Appium's verbose 500+ line XML page source and collapses it into ~20 lines of meaningful `testID`s and labels. It auto-detects iOS (XCUITest) vs Android (UiAutomator2) XML format and normalizes both into the same readable output. This is what makes `peek` so powerful for AI agents -- you get a complete, readable summary of the screen in one command.

### Platform Differences (Handled Automatically)

| Feature | iOS | Android |
|---------|-----|---------|
| Screenshots | `xcrun simctl` | `adb exec-out screencap` |
| Back navigation | testID → label → swipe | testID → label → hardware back key |
| Scrolling | `mobile: scroll` | `mobile: scrollGesture` |
| Text finding | iOS predicate string | UiAutomator selector |
| testID locator | `accessibility id` | `accessibility id` + `resourceId()` fallback |
| Reload | Shake gesture | Menu key (keyevent 82) |
| Session file | `/tmp/slappium-ios-session.json` | `/tmp/slappium-android-session.json` |

### Key Design Decisions

- **No keyboard interaction.** `type` uses Appium's `setValue` API directly, bypassing the on-screen keyboard entirely.
- **Session persistence.** The Appium session ID is saved per-platform to `/tmp/slappium-{platform}-session.json`. Subsequent commands reuse it. If the session is dead, a new one is created automatically.
- **Custom XML parser.** Zero-dependency recursive descent parser handles both iOS and Android XML formats without any XML library.

## For AI Agent Developers

If you're building an AI agent that needs to interact with mobile apps, Slappium is designed for you. Here's the typical workflow:

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
slap tap verify-btn

# 4. Verify navigation
slap wait-gone otp-digit-0 15000
slap assert-text "Welcome"

# 5. See the new state
slap peek
```

Every command is stateless (connects, acts, exits). Exit codes are meaningful (0 = success, 1 = element not found / assertion failed, 2 = error). Output is concise and parseable. This is what AI agents need.

### Works With

- **React Native / Expo** -- `testID` prop works on both iOS and Android
- **Native iOS** -- SwiftUI `.accessibilityIdentifier()`, UIKit `accessibilityIdentifier`
- **Native Android** -- `android:contentDescription`, `resource-id`
- **Any framework** that sets accessibility identifiers

## Tests

```bash
npm test            # Run all 69 tests
npm run test:watch  # Watch mode
```

## License

MIT -- see [LICENSE](LICENSE).

## Built by

[Arthur Ford, LLC](https://github.com/arthurfordllc)
