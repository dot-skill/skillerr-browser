# Protected video (Widevine)

Netflix, Disney+, Prime Video, Spotify's web player and other streaming sites encrypt their video with DRM. Chrome
plays it with Google's Widevine module; stock Electron doesn't include it, so those sites said "your browser can't play
protected content".

Skillerr is built on [castlabs' Electron for Content Security](https://github.com/castlabs/electron-releases), the same
Electron with Widevine support (`package.json`: `electron` from `castlabs/electron-releases`, currently `44.1.0+wvcus`).

- **The Widevine module** isn't shipped in the installer. Skillerr fetches it from Google's component updater in the
  background on first launch and keeps it updated (`startWidevine` in `src/main.js`). A streaming page opened before it
  finished downloading plays after a reload. Offline on first launch, it tries again next time.
- **VMP signing.** Some services (Netflix among them) also require the app to be VMP-signed on macOS and Windows.
  castlabs signs it for free with an EVS account: the release build does it when the `EVS_ACCOUNT_NAME` and
  `EVS_PASSWD` secrets are set (`scripts/vmp-sign.cjs`, `.github/workflows/deploy.yml`). macOS is signed before code
  signing, Windows after. Without them, sites that insist on VMP still refuse to play.
- **Linux** needs no VMP signing; Netflix limits Linux to standard definition, as in Chrome.

To set up VMP signing:

1. Create a free account: `python3 -m pip install castlabs-evs && python3 -m castlabs_evs.account signup`.
2. Add `EVS_ACCOUNT_NAME` and `EVS_PASSWD` as secrets on the repository's `production` and `staging` environments.
3. The next build logs `VMP signing` for macOS and Windows instead of `VMP signing skipped`.

Updating Electron: pick the matching castlabs release tag (`vX.Y.Z+wvcus`), since castlabs follows upstream Electron a
few patch releases behind.
