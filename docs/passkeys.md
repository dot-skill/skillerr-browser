# Passkeys in Skillerr

Skillerr supports passkeys wherever the platform allows it, and where it can't, it says so and offers the site's other
sign-in options instead of leaving the page hanging.

## What works where

| Platform | Passkeys | How |
|---|---|---|
| **macOS, Developer ID build with `APPLE_TEAM_ID`** | Touch ID passkeys **created in Skillerr**, for any site | `app.configureWebAuthn({ touchID: { keychainAccessGroup } })`, stored in Skillerr's keychain group |
| macOS, ad-hoc or unsigned build | None | Chip: "Passkeys need the signed Skillerr for Mac", plus "Use another way" |
| **Windows** | Windows Hello passkeys, security keys, phone sign-in | Chromium hands WebAuthn to Windows Hello, which shows its own UI |
| Linux | None | Chip: "Passkeys aren't available here yet", plus "Use another way" |

### Why iCloud Keychain passkeys don't work on Mac

Passkeys saved by Safari, Chrome or iCloud Keychain can't be used for arbitrary sites by an Electron app. Electron's
`platformPasskeys` option uses Apple's `ASAuthorizationController`, but only for domains that list the app in their
`apple-app-site-association` file. Google, GitHub and other third-party sites never will. Chrome and Safari reach them
through Apple's browser-only entitlement (`com.apple.developer.web-browser.public-key-credential`), which Electron
doesn't support today. So on Mac:

- A passkey **created in Skillerr** (in the site's security settings, "Add a passkey", while using Skillerr) works with
  Touch ID.
- A passkey that lives in iCloud Keychain or another browser doesn't. Skillerr catches the failure and shows "That
  passkey isn't saved in Skillerr" with "Use another way".

Full iCloud Keychain support needs Apple's browser entitlement and a bridge to `ASAuthorizationController`, which
Electron doesn't offer yet.

## Building a Mac build with passkeys

1. In the Apple Developer portal, register the App ID `com.skillerr.browser` and enable **Keychain Sharing**. Create a
   **Developer ID** provisioning profile for it and download it.
2. Set these locally (`CSC_LINK`, `CSC_KEY_PASSWORD`, `APPLE_TEAM_ID`, `MAC_PROVISIONING_PROFILE` as a file path), or as
   secrets for the release workflow (`MAC_CSC_LINK`, `MAC_CSC_KEY_PASSWORD`, `APPLE_TEAM_ID`,
   `MAC_PROVISIONING_PROFILE_B64`; see `.github/workflows/deploy.yml`):
   - the Developer ID Application certificate and its password
   - your 10-character Team ID
   - the Developer ID provisioning profile
3. `npm run dist`. Then:
   - `electron-builder.config.cjs` adds `keychain-access-groups: <TEAM_ID>.com.skillerr.browser.webauthn` to the
     entitlements and embeds the profile.
   - `scripts/build.mjs` writes the same group into the app's `package.json` (`skillerrKeychainGroup`).
   - At start, `setupPasskeys()` in `src/main.js` calls `app.configureWebAuthn` with it.
4. Check: on a site with passkeys, "Add a passkey" shows the Touch ID prompt ("Skillerr is trying to sign in to …").

When a site offers several Skillerr passkeys, Skillerr asks which account to use (`select-webauthn-account`).

## Code

- `src/main.js`: `setupPasskeys()`, `PASSKEY_WATCH_JS` (notes a passkey request, and a `NotAllowedError` failure),
  and `passkeyHelp(tab, reason)`.
- `src/ui/ui.js`: the passkey chip text, which depends on the platform and the reason.
- `electron-builder.config.cjs`, `scripts/build.mjs`: the entitlement and the keychain group.
