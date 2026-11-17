; Clinic Server for Windows: installer (Inno Setup 6). Built by windows/build.ps1:
;   ISCC.exe /DAppVersion=0.11.0 /DBundle=<bundle folder> installer.iss
;
; Silent install (IT, tests):
;   Clinic-Server-Setup.exe /VERYSILENT /SUPPRESSMSGBOXES /AdminPassword=... [/ServerName=clinic-server]
;     [/AdminUser=admin] [/BackupDir=D:\ClinicBackup] [/DemoData=1]

#ifndef AppVersion
  #define AppVersion "0.0.0"
#endif
#ifndef Bundle
  #define Bundle "out\bundle"
#endif

[Setup]
AppId={{6C1B7F2E-9A51-4E0C-9B7D-1C11A1C5E1A0}
AppName=Clinic Server
AppVersion={#AppVersion}
AppPublisher=Clinic
DefaultDirName={autopf}\Clinic Server
DefaultGroupName=Clinic Server
DisableProgramGroupPage=yes
PrivilegesRequired=admin
ArchitecturesAllowed=x64compatible
ArchitecturesInstallIn64BitMode=x64compatible
MinVersion=10.0
OutputBaseFilename=Clinic-Server-Setup-{#AppVersion}
Compression=lzma2/ultra64
SolidCompression=yes
WizardStyle=modern
SetupIconFile=..\desktop\src-tauri\icons\icon.ico
UninstallDisplayIcon={app}\caddy\caddy.exe
UninstallDisplayName=Clinic Server
CloseApplications=no
SetupLogging=yes

[Languages]
Name: "en"; MessagesFile: "compiler:Default.isl"
#ifexist "compiler:Languages\Arabic.isl"
Name: "ar"; MessagesFile: "compiler:Languages\Arabic.isl"
#endif

[Files]
Source: "{#Bundle}\*"; DestDir: "{app}"; Flags: recursesubdirs createallsubdirs ignoreversion

[INI]
Filename: "{group}\Clinic system.url"; Section: "InternetShortcut"; Key: "URL"; String: "https://localhost/"

[Icons]
Name: "{group}\Clinic Server folder (backups, logs, settings)"; Filename: "{commonappdata}\ClinicServer"
Name: "{group}\Read me (address, backup key)"; Filename: "{commonappdata}\ClinicServer\README.txt"
Name: "{group}\Back up now"; Filename: "{app}\server\clinic-ops.cmd"; Parameters: "backup-now"
Name: "{group}\Reset a password (run as administrator)"; Filename: "{app}\server\reset-password.cmd"
Name: "{group}\Uninstall Clinic Server"; Filename: "{uninstallexe}"

[Run]
Filename: "https://localhost/"; Description: "Open the clinic system"; Flags: postinstall shellexec skipifsilent nowait

[UninstallRun]
Filename: "powershell.exe"; Parameters: "-NoProfile -ExecutionPolicy Bypass -File ""{app}\server\setup.ps1"" -Mode uninstall"; Flags: runhidden waituntilterminated; RunOnceId: "RemoveServices"

[UninstallDelete]
Type: files; Name: "{app}\services\ClinicAPI.exe"
Type: files; Name: "{app}\services\ClinicWeb.exe"
Type: files; Name: "{app}\services\ClinicOps.exe"
Type: filesandordirs; Name: "{app}\services\*.log"

[Code]
var
  SetupFailed: Boolean;
  ServerPage, AdminPage: TInputQueryWizardPage;
  BackupPage: TInputDirWizardPage;
  DemoPage: TInputOptionWizardPage;

function IsUpgrade(): Boolean;
begin
  Result := FileExists(ExpandConstant('{commonappdata}\ClinicServer\config\clinic.env'));
end;

procedure InitializeWizard();
begin
  ServerPage := CreateInputQueryPage(wpSelectDir,
    'Server name', 'The name the clinic''s PCs use to reach this server.',
    'Use this PC''s network name (or a name set up in the router). The PCs open https://<name>.');
  ServerPage.Add('Server name:', False);
  ServerPage.Values[0] := ExpandConstant('{param:ServerName|' + Lowercase(GetComputerNameString()) + '}');

  AdminPage := CreateInputQueryPage(ServerPage.ID,
    'Administrator', 'The first user of the clinic system.',
    'This user can create the other users and set up the clinic. Password: at least 10 characters.');
  AdminPage.Add('Username:', False);
  AdminPage.Add('Full name (Arabic):', False);
  AdminPage.Add('Password:', True);
  AdminPage.Add('Repeat password:', True);
  AdminPage.Values[0] := ExpandConstant('{param:AdminUser|admin}');
  AdminPage.Values[1] := ExpandConstant('{param:AdminName|مدير النظام}');
  AdminPage.Values[2] := ExpandConstant('{param:AdminPassword|}');
  AdminPage.Values[3] := ExpandConstant('{param:AdminPassword|}');

  BackupPage := CreateInputDirPage(AdminPage.ID,
    'Backups', 'Where to keep the encrypted backups.',
    'Choose a second drive, a USB backup drive or a network folder if you can: a backup on the same disk does not survive a disk failure.',
    False, '');
  BackupPage.Add('');
  BackupPage.Values[0] := ExpandConstant('{param:BackupDir|' + ExpandConstant('{commonappdata}') + '\ClinicServer\backups}');

  DemoPage := CreateInputOptionPage(BackupPage.ID,
    'Demo data', 'Only for trying the system.',
    'Adds fake users, doctors, prices, an insurer, about 400 patients and three months of appointments, visits, prescriptions, lab results, images, quotations, treatment plans, invoices and payments. ' +
    'Also offered when updating; it is added only once, and refused on a server that already has real patients. Do not use this on the clinic''s real server.',
    False, False);
  DemoPage.Add('Add demo data (fake patients and activity)');
  DemoPage.Values[0] := ExpandConstant('{param:DemoData|0}') = '1';
end;

function ShouldSkipPage(PageID: Integer): Boolean;
begin
  // Updates skip the first-install questions; demo data can still be added to a test server.
  Result := IsUpgrade() and ((PageID = ServerPage.ID) or (PageID = AdminPage.ID) or
    (PageID = BackupPage.ID));
end;

function NextButtonClick(CurPageID: Integer): Boolean;
begin
  Result := True;
  if CurPageID = ServerPage.ID then begin
    if Trim(ServerPage.Values[0]) = '' then begin
      MsgBox('Enter the server name.', mbError, MB_OK); Result := False;
    end;
  end else if CurPageID = AdminPage.ID then begin
    if Trim(AdminPage.Values[0]) = '' then begin
      MsgBox('Enter a username.', mbError, MB_OK); Result := False;
    end else if Length(AdminPage.Values[2]) < 10 then begin
      MsgBox('The password must have at least 10 characters.', mbError, MB_OK); Result := False;
    end else if AdminPage.Values[2] <> AdminPage.Values[3] then begin
      MsgBox('The two passwords are not the same.', mbError, MB_OK); Result := False;
    end else if Lowercase(AdminPage.Values[2]) = Lowercase(AdminPage.Values[0]) then begin
      MsgBox('The password cannot be the username.', mbError, MB_OK); Result := False;
    end;
  end;
end;

function JsonEscape(S: String): String;
begin
  StringChangeEx(S, '\', '\\', True);
  StringChangeEx(S, '"', '\"', True);
  Result := S;
end;

// Setup leaves a note when the network is marked Public: offer to make it Private, or other PCs
// cannot reach the server (the firewall rule covers private and work networks only).
procedure OfferPrivateNetwork();
var
  Flag, Names: String;
  Lines: TArrayOfString;
  Code: Integer;
begin
  Flag := ExpandConstant('{commonappdata}\ClinicServer\logs\network-public.txt');
  if WizardSilent() or not FileExists(Flag) then Exit;
  if LoadStringsFromFile(Flag, Lines) and (GetArrayLength(Lines) > 0) then Names := Lines[0] else Names := '';
  if MsgBox('This PC''s network "' + Names + '" is set to Public, so the clinic''s other PCs cannot reach this server.' + #13#10#13#10 +
      'Set it to Private now? Only do this on the clinic''s own network, not on public Wi-Fi.', mbConfirmation, MB_YESNO) = IDYES then
  begin
    Exec('powershell.exe', '-NoProfile -Command "Get-NetConnectionProfile | Where-Object NetworkCategory -eq ''Public'' | Set-NetConnectionProfile -NetworkCategory Private"',
      '', SW_HIDE, ewWaitUntilTerminated, Code);
    DeleteFile(Flag);
  end;
end;

// Silent installs (IT, tests) see the failure as exit code 1.
function GetCustomSetupExitCode(): Integer;
begin
  if SetupFailed then Result := 1 else Result := 0;
end;

function PrepareToInstall(var NeedsRestart: Boolean): String;
var
  Code: Integer;
begin
  Result := '';
  // Upgrade: stop the services so their files can be replaced.
  if IsUpgrade() and FileExists(ExpandConstant('{app}\server\setup.ps1')) then
    Exec('powershell.exe', '-NoProfile -ExecutionPolicy Bypass -File "' + ExpandConstant('{app}\server\setup.ps1') + '" -Mode stop',
      '', SW_HIDE, ewWaitUntilTerminated, Code);
end;

procedure CurStepChanged(CurStep: TSetupStep);
var
  Params: TArrayOfString;
  ParamsFile, Demo: String;
  Code: Integer;
begin
  if CurStep <> ssPostInstall then Exit;
  ParamsFile := ExpandConstant('{tmp}\params.json');
  if DemoPage.Values[0] then Demo := 'true' else Demo := 'false';
  if IsUpgrade() then begin
    SetArrayLength(Params, 1);
    Params[0] := '{"demo_data": ' + Demo + '}';
    SaveStringsToUTF8File(ParamsFile, Params, False);
  end else begin
    if (not WizardSilent()) and (Length(AdminPage.Values[2]) < 10) then RaiseException('No administrator password.');
    SetArrayLength(Params, 1);
    Params[0] := '{"server_name": "' + JsonEscape(Trim(ServerPage.Values[0])) + '", ' +
      '"admin_user": "' + JsonEscape(Trim(AdminPage.Values[0])) + '", ' +
      '"admin_name": "' + JsonEscape(Trim(AdminPage.Values[1])) + '", ' +
      '"admin_password": "' + JsonEscape(AdminPage.Values[2]) + '", ' +
      '"backup_dir": "' + JsonEscape(BackupPage.Values[0]) + '", ' +
      '"demo_data": ' + Demo + '}';
    SaveStringsToUTF8File(ParamsFile, Params, False);
  end;
  WizardForm.StatusLabel.Caption := 'Setting up the database and services (a few minutes)...';
  if not Exec('powershell.exe', '-NoProfile -ExecutionPolicy Bypass -File "' + ExpandConstant('{app}\server\setup.ps1') +
      '" -Mode install -ParamsFile "' + ParamsFile + '"', '', SW_HIDE, ewWaitUntilTerminated, Code) or (Code <> 0) then
  begin
    DeleteFile(ParamsFile);
    SuppressibleMsgBox('Setting up the clinic server failed. The details are in ' +
      ExpandConstant('{commonappdata}\ClinicServer\logs') + ' (setup-*.log).', mbError, MB_OK, IDOK);
    SetupFailed := True;
    Exit;
  end;
  DeleteFile(ParamsFile);
  OfferPrivateNetwork();
end;
