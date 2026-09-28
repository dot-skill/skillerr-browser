// electron-builder config: package.json "build", plus real code signing when credentials are in the environment.
//
// macOS (Developer ID + notarization), set in CI secrets or your shell:
//   CSC_LINK (base64 .p12 or path) + CSC_KEY_PASSWORD, or CSC_NAME for a certificate already in the keychain
//   APPLE_API_KEY + APPLE_API_KEY_ID + APPLE_API_ISSUER, or APPLE_ID + APPLE_APP_SPECIFIC_PASSWORD + APPLE_TEAM_ID
// Windows (Authenticode): WIN_CSC_LINK + WIN_CSC_KEY_PASSWORD (or CSC_LINK when building on Windows).
// Passkeys (macOS Touch ID, see docs/passkeys.md): APPLE_TEAM_ID, plus MAC_PROVISIONING_PROFILE (a Developer ID
// provisioning profile for com.skillerr.browser with Keychain Sharing) so the keychain-access-groups entitlement holds.
// Without them the build is what it was before: macOS ad-hoc signed, Windows unsigned.
const fs = require('fs');
const path = require('path');
const pkg = require('./package.json');

const env = process.env;
const macCert = !!(env.CSC_LINK || env.CSC_NAME);
const notarize = macCert && !!((env.APPLE_API_KEY && env.APPLE_API_KEY_ID && env.APPLE_API_ISSUER) || (env.APPLE_ID && env.APPLE_APP_SPECIFIC_PASSWORD && env.APPLE_TEAM_ID));
const winCert = !!(env.WIN_CSC_LINK || (process.platform === 'win32' && env.CSC_LINK));

const base = pkg.build;
const mac = { ...base.mac };
if (macCert) {
  delete mac.identity; // "-" means ad-hoc; without it electron-builder uses the Developer ID certificate
  Object.assign(mac, {
    hardenedRuntime: true,
    gatekeeperAssess: false,
    entitlements: 'build/entitlements.mac.plist',
    entitlementsInherit: 'build/entitlements.mac.plist',
    notarize,
  });
}

// Touch ID passkeys: the keychain group Skillerr stores WebAuthn credentials under must be in the entitlements.
const keychainGroup = macCert && env.APPLE_TEAM_ID ? `${env.APPLE_TEAM_ID}.${base.appId}.webauthn` : '';
if (keychainGroup) {
  const plist = fs.readFileSync(path.join(__dirname, 'build/entitlements.mac.plist'), 'utf8').replace('</dict>',
    `  <key>keychain-access-groups</key>\n  <array>\n    <string>${keychainGroup}</string>\n  </array>\n</dict>`);
  fs.writeFileSync(path.join(__dirname, 'build/entitlements.generated.plist'), plist);
  mac.entitlements = 'build/entitlements.generated.plist';
  if (env.MAC_PROVISIONING_PROFILE) mac.provisioningProfile = env.MAC_PROVISIONING_PROFILE;
}

const win = { ...base.win, ...(winCert ? { signAndEditExecutable: true } : {}) };

// CI decides how a build is published (deploy.yml): always as a draft first, promoted once every platform uploaded.
const publish = base.publish.map((p) => ({ ...p, releaseType: env.RELEASE_TYPE || 'draft' }));

module.exports = { ...base, mac, win, publish };
