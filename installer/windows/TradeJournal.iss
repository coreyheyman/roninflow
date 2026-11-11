; RoninFlow — Windows installer (Inno Setup 6)
; Built automatically by .github/workflows/release.yml:
;   build\app   = the app (dist, server files, add-ons, scripts)      build\node = portable node.exe
; Installs per user (no admin prompt), starts with Windows, and keeps your data in %LOCALAPPDATA%\TradeJournal\data,
; so reinstalling or updating never touches your journal.

#ifndef AppVersion
  #define AppVersion "1.0.0"
#endif

[Setup]
AppId={{6E3C1B7A-4E0E-4C8E-9D7B-2F1A5C9E7D31}
AppName=RoninFlow
AppVersion={#AppVersion}
AppPublisher=RoninFlow contributors
AppPublisherURL=https://github.com
DefaultDirName={localappdata}\Programs\RoninFlow
DefaultGroupName=RoninFlow
PrivilegesRequired=lowest
OutputDir=..\..\build\out
OutputBaseFilename=RoninFlow-Setup-{#AppVersion}
Compression=lzma2/max
SolidCompression=yes
WizardStyle=modern
LicenseFile=..\..\LICENSE
SetupIconFile=TradeJournal.ico
UninstallDisplayIcon={app}\TradeJournal.ico
DisableProgramGroupPage=yes
CloseApplications=no

[Tasks]
Name: "autostart"; Description: "Start RoninFlow in the background when I sign in to Windows (recommended — keeps live sync running)"; Flags: checkedonce
Name: "desktopicon"; Description: "Create a desktop shortcut"; Flags: unchecked

[Files]
Source: "..\..\build\app\*"; DestDir: "{app}"; Flags: recursesubdirs createallsubdirs ignoreversion
Source: "..\..\build\node\node.exe"; DestDir: "{app}\node"; Flags: ignoreversion
Source: "launch.vbs"; DestDir: "{app}"; Flags: ignoreversion
Source: "stop.ps1"; DestDir: "{app}"; Flags: ignoreversion
Source: "TradeJournal.ico"; DestDir: "{app}"; Flags: ignoreversion

[Icons]
Name: "{group}\RoninFlow"; Filename: "{sys}\wscript.exe"; Parameters: """{app}\launch.vbs"" open"; IconFilename: "{app}\TradeJournal.ico"
Name: "{group}\Install platform add-ons"; Filename: "powershell.exe"; Parameters: "-NoProfile -ExecutionPolicy Bypass -File ""{app}\scripts\addons.ps1"""; IconFilename: "{app}\TradeJournal.ico"
Name: "{group}\Open data folder"; Filename: "{localappdata}\TradeJournal\data"
Name: "{group}\Stop RoninFlow"; Filename: "powershell.exe"; Parameters: "-NoProfile -ExecutionPolicy Bypass -WindowStyle Hidden -File ""{app}\stop.ps1"""
Name: "{group}\Uninstall RoninFlow"; Filename: "{uninstallexe}"
Name: "{userdesktop}\RoninFlow"; Filename: "{sys}\wscript.exe"; Parameters: """{app}\launch.vbs"" open"; IconFilename: "{app}\TradeJournal.ico"; Tasks: desktopicon
Name: "{userstartup}\RoninFlow (background)"; Filename: "{sys}\wscript.exe"; Parameters: """{app}\launch.vbs"""; IconFilename: "{app}\TradeJournal.ico"; Tasks: autostart

[Dirs]
Name: "{localappdata}\TradeJournal\data"; Flags: uninsneveruninstall

[Run]
Filename: "{sys}\wscript.exe"; Parameters: """{app}\launch.vbs"" open"; Description: "Open RoninFlow now"; Flags: postinstall nowait skipifsilent
; silent installs (the in-app "Update now") start RoninFlow again in the background; the open page reconnects
Filename: "{sys}\wscript.exe"; Parameters: """{app}\launch.vbs"""; Flags: nowait runhidden; Check: WizardSilent

[UninstallRun]
Filename: "powershell.exe"; Parameters: "-NoProfile -ExecutionPolicy Bypass -WindowStyle Hidden -File ""{app}\stop.ps1"""; Flags: runhidden; RunOnceId: "StopServer"

[Code]
procedure CurStepChanged(CurStep: TSetupStep);
var R: Integer;
begin
  // Stop a running copy before files are replaced during an update. Runs the new stop.ps1 from a temp copy (the one in
  // {app} is the old version) and matches node.exe by its path inside {app}, wherever the app was installed.
  if CurStep = ssInstall then
  begin
    ExtractTemporaryFile('stop.ps1');
    Exec('powershell.exe', '-NoProfile -ExecutionPolicy Bypass -WindowStyle Hidden -File "' + ExpandConstant('{tmp}\stop.ps1') + '" -AppDir "' + ExpandConstant('{app}') + '"', '', SW_HIDE, ewWaitUntilTerminated, R);
  end;
end;
