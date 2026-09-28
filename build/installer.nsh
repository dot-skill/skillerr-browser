; Included by electron-builder's NSIS installer (package.json → build.nsis.include).
; Uninstalling Skillerr also disconnects it from Claude Desktop, Claude Code and Cursor and gives Claude Code its own
; web tools back (mcp/setup.js --uninstall). Skipped on updates: electron-builder runs the old uninstaller when a new
; version installs, and an update must keep the connections.
!macro customUnInstall
  ${ifNot} ${isUpdated}
    System::Call 'Kernel32::SetEnvironmentVariable(t "ELECTRON_RUN_AS_NODE", t "1") i'
    ExecWait '"$INSTDIR\${APP_EXECUTABLE_FILENAME}" "$INSTDIR\resources\app.asar\mcp\setup.js" --uninstall'
    System::Call 'Kernel32::SetEnvironmentVariable(t "ELECTRON_RUN_AS_NODE", t "")'
  ${endIf}
!macroend
