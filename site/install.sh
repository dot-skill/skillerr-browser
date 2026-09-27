#!/bin/sh
# Install Skillerr, the agentic browser, and connect it to your AI apps.
#   curl -fsSL https://skillerr.com/install.sh | sh
#   curl -fsSL https://skillerr.com/install.sh | sh -s -- --prefer     # also make Skillerr your AI's browser
# Options are passed to Skillerr's setup: --prefer, --dry-run, --claude-code, --claude-desktop, --cursor, --no-connect
set -e
VERSION="${SKILLERR_VERSION:-0.1.1}"
BASE="${SKILLERR_RELEASE:-https://github.com/bharatdudeja13-cmd/skillerr-releases/releases/download/v$VERSION}"
CONNECT=1
for a in "$@"; do [ "$a" = "--no-connect" ] && CONNECT=0; done
SETUP_ARGS=$(printf '%s ' "$@" | sed 's/--no-connect//g')
say() { printf '%s\n' "$*"; }
tmp=$(mktemp -d); trap 'rm -rf "$tmp"' EXIT
case "$(uname -s)" in
  Darwin)
    case "$(uname -m)" in arm64) file="Skillerr-$VERSION-arm64.dmg" ;; *) file="Skillerr-$VERSION.dmg" ;; esac
    say "Downloading $file…"
    curl -fL --progress-bar -o "$tmp/Skillerr.dmg" "$BASE/$file"
    osascript -e 'quit app "Skillerr"' >/dev/null 2>&1 || true
    vol=$(hdiutil attach -nobrowse -readonly "$tmp/Skillerr.dmg" | grep -o '/Volumes/.*' | head -1)
    rm -rf /Applications/Skillerr.app
    ditto "$vol/Skillerr.app" /Applications/Skillerr.app
    hdiutil detach "$vol" -quiet || true
    # You chose to install from the terminal, so skip the "downloaded from the internet" prompt for this app only.
    xattr -dr com.apple.quarantine /Applications/Skillerr.app 2>/dev/null || true
    BIN=/Applications/Skillerr.app/Contents/MacOS/Skillerr
    SETUP=/Applications/Skillerr.app/Contents/Resources/app.asar/mcp/setup.js
    say "Installed to /Applications/Skillerr.app"
    open -a /Applications/Skillerr.app
    ;;
  Linux)
    case "$(uname -m)" in aarch64|arm64) file="Skillerr-$VERSION-arm64.AppImage" ;; *) file="Skillerr-$VERSION.AppImage" ;; esac
    say "Downloading $file…"
    curl -fL --progress-bar -o "$tmp/Skillerr.AppImage" "$BASE/$file"
    chmod +x "$tmp/Skillerr.AppImage"
    dir="$HOME/.local/share/skillerr"
    rm -rf "$dir/app"; mkdir -p "$dir" "$HOME/.local/bin" "$HOME/.local/share/applications"
    (cd "$tmp" && ./Skillerr.AppImage --appimage-extract >/dev/null) && mv "$tmp/squashfs-root" "$dir/app"
    BIN="$dir/app/$(ls "$dir/app" | grep -iE '^skillerr' | grep -v '\.' | head -1)"
    SETUP="$dir/app/resources/app.asar/mcp/setup.js"
    ln -sf "$BIN" "$HOME/.local/bin/skillerr"
    cat > "$HOME/.local/share/applications/skillerr.desktop" <<DESK
[Desktop Entry]
Name=Skillerr
Comment=The agentic browser
Exec=$BIN %U
Icon=$dir/app/.DirIcon
Type=Application
Categories=Network;WebBrowser;
MimeType=x-scheme-handler/skillerr;
DESK
    say "Installed to $dir (run: skillerr)"
    (nohup "$BIN" >/dev/null 2>&1 &) || true
    ;;
  *) say "This installer is for macOS and Linux. On Windows use: irm https://skillerr.com/install.ps1 | iex"; exit 1 ;;
esac
if [ "$CONNECT" = 1 ]; then
  say "Connecting your AI apps…"
  # shellcheck disable=SC2086
  ELECTRON_RUN_AS_NODE=1 "$BIN" "$SETUP" $SETUP_ARGS
fi
say "Skillerr is ready. Ask your AI to look something up; it will open in Skillerr."
