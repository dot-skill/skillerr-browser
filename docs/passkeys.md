# Passkeys in Skillerr

**Status:** passkey sign-in didn't work on Mac. This change turns on what Electron 44 can do, and explains the rest to
the user instead of leaving the sign-in page hanging.

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

The path to full iCloud Keychain support: ask Apple for the browser entitlement, then bridge `ASAuthorizationController`
with browser client data, either through a native module (for example
[vault12/electron-webauthn-mac](https://github.com/vault12/electron-webauthn-mac)) or a future Electron API. That's a
separate project.

## Building a Mac build with passkeys

1. In the Apple Developer portal, register the App ID `com.skillerr.browser` and enable **Keychain Sharing**. Create a
   **Developer ID** provisioning profile for it and download it.
2. Set these, locally or as CI secrets (see `.github/workflows/release.yml`):
   - `CSC_LINK` + `CSC_KEY_PASSWORD` (Developer ID Application certificate)
   - `APPLE_TEAM_ID`, your 10-character Team ID
   - `MAC_PROVISIONING_PROFILE`, the path to the `.provisionprofile`
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
