; Inno Setup script for the PostAdmin Windows installer.
; Build with `npm run build:installer`, which passes AppVersion from package.json.

#ifndef AppVersion
  #define AppVersion "0.0.0"
#endif

#define AppName "PostAdmin"
#define AppExe "postadmin.exe"
#define AppUrl "https://github.com/haseebkhan4321/postgres-sql-ui"

[Setup]
AppId={{6F1C2B7E-3D4A-4E8B-9A51-2C7D8E0F4B13}
AppName={#AppName}
AppVersion={#AppVersion}
AppVerName={#AppName} {#AppVersion}
AppPublisher={#AppName}
AppPublisherURL={#AppUrl}
AppSupportURL={#AppUrl}/issues
VersionInfoVersion={#AppVersion}
DefaultDirName={autopf}\{#AppName}
DefaultGroupName={#AppName}
DisableProgramGroupPage=yes
; Installs for the current user without admin rights; the user can still pick "all users".
PrivilegesRequired=lowest
PrivilegesRequiredOverridesAllowed=dialog
ArchitecturesAllowed=x64compatible
ArchitecturesInstallIn64BitMode=x64compatible
LicenseFile=..\LICENSE
OutputDir=..\dist
OutputBaseFilename=PostAdmin-Setup-{#AppVersion}
UninstallDisplayIcon={app}\{#AppExe}
UninstallDisplayName={#AppName} {#AppVersion}
Compression=lzma2/max
SolidCompression=yes
WizardStyle=modern
; Stop a running PostAdmin before files are replaced or removed.
CloseApplications=force

[Languages]
Name: "english"; MessagesFile: "compiler:Default.isl"

[Tasks]
Name: "desktopicon"; Description: "{cm:CreateDesktopIcon}"; GroupDescription: "{cm:AdditionalIcons}"

[Files]
Source: "..\dist\{#AppExe}"; DestDir: "{app}"; Flags: ignoreversion
Source: "..\README.md"; DestDir: "{app}"; Flags: ignoreversion isreadme
Source: "..\CHANGELOG.md"; DestDir: "{app}"; Flags: ignoreversion
Source: "..\LICENSE"; DestDir: "{app}"; Flags: ignoreversion

[Icons]
Name: "{group}\{#AppName}"; Filename: "{app}\{#AppExe}"; Comment: "Start PostAdmin and open it in your browser"
Name: "{group}\{cm:UninstallProgram,{#AppName}}"; Filename: "{uninstallexe}"
Name: "{autodesktop}\{#AppName}"; Filename: "{app}\{#AppExe}"; Tasks: desktopicon

[Run]
Filename: "{app}\{#AppExe}"; Description: "{cm:LaunchProgram,{#AppName}}"; Flags: nowait postinstall skipifsilent

[UninstallRun]
Filename: "{sys}\taskkill.exe"; Parameters: "/F /IM {#AppExe}"; Flags: runhidden; RunOnceId: "StopPostAdmin"

; Saved connections and history in %APPDATA%\PostAdmin are left in place on uninstall.
