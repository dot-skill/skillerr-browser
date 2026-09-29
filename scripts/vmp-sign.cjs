// VMP-signs a packaged Skillerr for Widevine, so streaming sites that require it (Netflix, Disney+, …) play protected
// video. Skillerr is built on castlabs' Electron for Content Security (the Widevine CDM itself is downloaded by the app
// on first launch, from Google's component updater). castlabs' EVS signs the package with a production VMP
// certificate, free with an EVS account: https://github.com/castlabs/electron-releases/wiki/EVS
//
// macOS is signed before code signing (electron-builder's afterPack), Windows after it (afterSign). Linux needs none.
// Without an EVS account (EVS_ACCOUNT_NAME and EVS_PASSWD in CI) the build is left unsigned for VMP: everything works
// except the few sites that insist on it.
const { execFileSync } = require('child_process');

function vmpSign(context, platform) {
  if (context.electronPlatformName !== platform) return;
  if (!process.env.EVS_ACCOUNT_NAME) {
    console.log(`  • VMP signing skipped for ${platform}: no EVS account (EVS_ACCOUNT_NAME)`);
    return;
  }
  const python = process.platform === 'win32' ? 'python' : 'python3';
  execFileSync(python, ['-m', 'castlabs_evs.vmp', '-n', 'sign-pkg', context.appOutDir], { stdio: 'inherit' });
  execFileSync(python, ['-m', 'castlabs_evs.vmp', 'verify-pkg', context.appOutDir], { stdio: 'inherit' });
}

module.exports = {
  afterPack: (context) => vmpSign(context, 'darwin'),
  afterSign: (context) => vmpSign(context, 'win32'),
};
