; Terminal Quest — Inno Setup installer script
; ---------------------------------------------------------------------------
; This produces a single self-contained TerminalQuest-Setup.exe for Windows.
;
; Prerequisites (run on a Windows build machine, or Wine):
;   1. npm install            (fetch Electron + builder)
;   2. npm run dist:unpacked  (electron-builder produces release\win-unpacked\)
;   3. Compile THIS script with Inno Setup 6:
;         "C:\Program Files (x86)\Inno Setup 6\ISCC.exe" installer\terminal-quest.iss
;
; The result lands in installer\Output\TerminalQuest-Setup-1.0.0.exe
;
; (Alternatively skip Inno Setup entirely and run `npm run dist`, which uses
;  electron-builder's built-in NSIS target to make an equivalent installer.)

#define MyAppName "Terminal Quest"
#define MyAppVersion "1.0.0"
#define MyAppPublisher "OmniCorp Interactive"
#define MyAppExeName "Terminal Quest.exe"
; Folder produced by electron-builder's dir/unpacked target:
#define UnpackedDir "..\release\win-unpacked"

[Setup]
AppId={{7F290B1F-B72C-5292-8DF9-7A6C46580301}
AppName={#MyAppName}
AppVersion={#MyAppVersion}
AppPublisher={#MyAppPublisher}
DefaultDirName={autopf}\{#MyAppName}
DefaultGroupName={#MyAppName}
DisableProgramGroupPage=yes
OutputBaseFilename=TerminalQuest-Setup-{#MyAppVersion}
OutputDir=Output
Compression=lzma2/max
SolidCompression=yes
WizardStyle=modern
SetupIconFile=..\assets\icon.ico
UninstallDisplayIcon={app}\{#MyAppExeName}
ArchitecturesInstallIn64BitMode=x64compatible
PrivilegesRequired=lowest
PrivilegesRequiredOverridesAllowed=dialog

[Languages]
Name: "english"; MessagesFile: "compiler:Default.isl"

[Tasks]
Name: "desktopicon"; Description: "{cm:CreateDesktopIcon}"; GroupDescription: "{cm:AdditionalIcons}"; Flags: checkedonce

[Files]
Source: "{#UnpackedDir}\*"; DestDir: "{app}"; Flags: recursesubdirs createallsubdirs ignoreversion

[Icons]
Name: "{group}\{#MyAppName}"; Filename: "{app}\{#MyAppExeName}"
Name: "{group}\Uninstall {#MyAppName}"; Filename: "{uninstallexe}"
Name: "{autodesktop}\{#MyAppName}"; Filename: "{app}\{#MyAppExeName}"; Tasks: desktopicon

[Run]
Filename: "{app}\{#MyAppExeName}"; Description: "{cm:LaunchProgram,{#StringChange(MyAppName, '&', '&&')}}"; Flags: nowait postinstall skipifsilent

[UninstallDelete]
; leave player saves in %APPDATA%\Terminal Quest by default; uncomment to purge:
; Type: filesandordirs; Name: "{userappdata}\Terminal Quest"
