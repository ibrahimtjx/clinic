<#
  Clinic Server for Windows: configures the server after the installer copied its files.
  Run by the installer (as Administrator). Can be run again by hand:

    setup.ps1 -Mode install -ParamsFile params.json   first install: database, services, admin user
    setup.ps1 -Mode install                           upgrade: refresh services, start everything
    setup.ps1 -Mode stop                              stop all services (before files are replaced)
    setup.ps1 -Mode uninstall                         remove the services (data is kept)

  Layout:
    <install folder>   pgsql\ python\ api\ web\ caddy\ gtk\ server\ services\
    %ProgramData%\ClinicServer   config\ pgdata\ wal-staging\ backups\ caddy\ desktop\ logs\
#>
param(
  [ValidateSet('install', 'stop', 'uninstall')][string]$Mode = 'install',
  [string]$ParamsFile = ''
)
$ErrorActionPreference = 'Stop'
# Windows PowerShell's own modules only (a PowerShell 7 parent can hand over an incompatible path).
$env:PSModulePath = "$env:ProgramFiles\WindowsPowerShell\Modules;$env:SystemRoot\system32\WindowsPowerShell\v1.0\Modules"
$App = Split-Path -Parent $PSScriptRoot
$Data = Join-Path $env:ProgramData 'ClinicServer'
$Config = Join-Path $Data 'config'
$EnvFile = Join-Path $Config 'clinic.env'
$PgBin = Join-Path $App 'pgsql\bin'
$Python = Join-Path $App 'python\python.exe'
$Services = Join-Path $App 'services'
$Winsw = @('ClinicAPI', 'ClinicWeb', 'ClinicOps')

New-Item -ItemType Directory -Force -Path (Join-Path $Data 'logs') | Out-Null
Start-Transcript -Path (Join-Path $Data "logs\setup-$(Get-Date -Format yyyyMMdd-HHmmss).log") | Out-Null

function Say($msg) { Write-Host "== $msg" }

function Stop-All {
  foreach ($s in @('ClinicWeb', 'ClinicOps', 'ClinicAPI', 'ClinicDB')) {
    if (Get-Service $s -ErrorAction SilentlyContinue) {
      Say "Stopping $s"
      Stop-Service $s -Force -ErrorAction SilentlyContinue
    }
  }
}

function Read-Env {
  $vars = @{}
  foreach ($line in Get-Content $EnvFile -Encoding UTF8) {
    if ($line -match '^\s*([A-Z_]+)\s*=\s*(.*)$') { $vars[$Matches[1]] = $Matches[2].Trim() }
  }
  return $vars
}

function New-Secret([int]$bytes) {
  $buf = New-Object byte[] $bytes
  [System.Security.Cryptography.RandomNumberGenerator]::Create().GetBytes($buf)
  return -join ($buf | ForEach-Object { $_.ToString('x2') })
}

# Runs a program and shows all its output (stderr too) in the log; throws if it fails.
function Invoke-Native([string]$exe, [string[]]$argList, [string]$what) {
  $old = $ErrorActionPreference
  $ErrorActionPreference = 'Continue'
  try { & $exe @argList 2>&1 | ForEach-Object { "$_" } | Out-Host } finally { $ErrorActionPreference = $old }
  if ($LASTEXITCODE -ne 0) { throw "$what failed (exit code $LASTEXITCODE)" }
}

function Test-PortFree([int]$port) {
  try {
    $l = [System.Net.Sockets.TcpListener]::new([System.Net.IPAddress]::Any, $port)
    $l.Start(); $l.Stop(); return $true
  } catch { return $false }
}

function Free-Port([int]$from) {
  for ($p = $from; $p -lt $from + 20; $p++) { if (Test-PortFree $p) { return $p } }
  throw "No free port near $from"
}

function Wait-Until([scriptblock]$check, [int]$seconds, [string]$what) {
  for ($i = 0; $i -lt $seconds; $i += 2) {
    try { if (& $check) { return } } catch {}
    Start-Sleep -Seconds 2
  }
  throw "$what did not start in $seconds seconds. See $Data\logs."
}

function Install-WinswServices {
  foreach ($s in $Winsw) {
    $exe = Join-Path $Services "$s.exe"
    Copy-Item (Join-Path $Services 'WinSW-x64.exe') $exe -Force
    if (Get-Service $s -ErrorAction SilentlyContinue) {
      & $exe stop 2>$null | Out-Null
      & $exe uninstall | Out-Null
      Start-Sleep -Seconds 1
    }
    & $exe install | Out-Null
    if ($LASTEXITCODE -ne 0) { throw "Could not install the $s service" }
  }
}

function Write-Caddyfile($vars) {
  $hosts = @($vars['SERVER_NAME'], 'localhost')
  # The PCs may use the server's IP address instead of its name: the certificate covers both.
  $ips = [System.Net.NetworkInformation.NetworkInterface]::GetAllNetworkInterfaces() |
    Where-Object { $_.OperationalStatus -eq 'Up' } |
    ForEach-Object { $_.GetIPProperties().UnicastAddresses } |
    Where-Object { $_.Address.AddressFamily -eq 'InterNetwork' } |
    ForEach-Object { $_.Address.ToString() } |
    Where-Object { $_ -notlike '127.*' -and $_ -notlike '169.254.*' }
  $hosts += $ips
  $hosts = $hosts | Where-Object { $_ } | Select-Object -Unique
  $text = Get-Content (Join-Path $App 'server\Caddyfile.template') -Raw -Encoding UTF8
  $text = $text.Replace('http://__SERVER_NAME__', (($hosts | ForEach-Object { "http://$_" }) -join ', '))
  $text = $text.Replace('__SERVER_NAME__, localhost', ($hosts -join ', '))
  $text = $text.Replace('__DATA__', ($Data -replace '\\', '/')).Replace('__APP__', ($App -replace '\\', '/'))
  $text = $text.Replace('__API_PORT__', $vars['CLINIC_API_PORT'])
  [System.IO.File]::WriteAllText((Join-Path $Config 'Caddyfile'), $text, (New-Object System.Text.UTF8Encoding $false))
}

function Start-All($vars) {
  Say 'Starting the database'
  Start-Service ClinicDB
  Wait-Until { & (Join-Path $PgBin 'pg_isready.exe') -q -h 127.0.0.1 -p $vars['PGPORT']; $LASTEXITCODE -eq 0 } 120 'The database'
  Say 'Starting the application'
  Start-Service ClinicAPI
  Wait-Until { (Invoke-WebRequest -UseBasicParsing "http://127.0.0.1:$($vars['CLINIC_API_PORT'])/health" -TimeoutSec 5).StatusCode -eq 200 } 180 'The application'
  Start-Service ClinicOps
  Write-Caddyfile $vars
  Start-Service ClinicWeb
}

# ------------------------------------------------------------------ stop / uninstall
if ($Mode -eq 'stop') { Stop-All; Stop-Transcript | Out-Null; exit 0 }
if ($Mode -eq 'uninstall') {
  Stop-All
  foreach ($s in $Winsw) {
    $exe = Join-Path $Services "$s.exe"
    if ((Get-Service $s -ErrorAction SilentlyContinue) -and (Test-Path $exe)) { & $exe uninstall | Out-Null }
  }
  if (Get-Service ClinicDB -ErrorAction SilentlyContinue) { & (Join-Path $PgBin 'pg_ctl.exe') unregister -N ClinicDB }
  netsh advfirewall firewall delete rule 'name=Clinic Server (web)' | Out-Null
  Say "Services removed. The clinic data stays in $Data."
  Stop-Transcript | Out-Null
  exit 0
}

# Fake users, patients and three months of activity, for trying the system only. Added once; the
# application refuses when the database already has real patients.
function Add-DemoData($vars) {
  Say 'Adding demo data (a few minutes)'
  foreach ($k in $vars.Keys) { Set-Item -Path "Env:\$k" -Value $vars[$k] }
  Push-Location (Join-Path $App 'api')
  try {
    & $Python -m app.cli seed-demo | Out-Host
    if ($LASTEXITCODE -ne 0) { Say 'Demo data was not added (see above).' }
  } finally { Pop-Location }
}

# Reinstalling after an uninstall (the data was kept) takes the upgrade path, but the uninstall removed
# the database service and the firewall rule: put back whatever is missing.
function Restore-Missing {
  if (-not (Get-Service ClinicDB -ErrorAction SilentlyContinue)) {
    Say 'Registering the database service again'
    $pgdata = Join-Path $Data 'pgdata'
    foreach ($d in $pgdata, (Join-Path $Data 'wal-staging')) {
      if (Test-Path $d) { icacls $d /grant '*S-1-5-20:(OI)(CI)F' /T /Q | Out-Null }
    }
    Invoke-Native (Join-Path $PgBin 'pg_ctl.exe') @('register', '-N', 'ClinicDB', '-U', 'NT AUTHORITY\NetworkService', '-D', $pgdata, '-S', 'auto', '-w') 'registering the database service'
  }
  netsh advfirewall firewall show rule 'name=Clinic Server (web)' | Out-Null
  if ($LASTEXITCODE -ne 0) {
    Invoke-Native 'netsh.exe' @('advfirewall', 'firewall', 'add', 'rule', 'name=Clinic Server (web)', 'dir=in', 'action=allow', 'protocol=TCP', 'localport=80,443', 'profile=private,domain') 'opening the firewall'
  }
}

# ------------------------------------------------------------------ upgrade
if (Test-Path $EnvFile) {
  Say 'Existing clinic data found: upgrading'
  Stop-All
  $vars = Read-Env
  Install-WinswServices
  Restore-Missing
  Start-All $vars
  if ($ParamsFile -and (Test-Path $ParamsFile)) {
    $up = Get-Content $ParamsFile -Raw -Encoding UTF8 | ConvertFrom-Json
    Remove-Item $ParamsFile -Force -ErrorAction SilentlyContinue
    if ($up.demo_data) { Add-DemoData $vars }
  }
  Say 'Upgrade done.'
  Stop-Transcript | Out-Null
  exit 0
}

# ------------------------------------------------------------------ first install
if (-not $ParamsFile -or -not (Test-Path $ParamsFile)) { throw 'First install needs -ParamsFile (server name, admin, backup folder).' }
$p = Get-Content $ParamsFile -Raw -Encoding UTF8 | ConvertFrom-Json
Remove-Item $ParamsFile -Force -ErrorAction SilentlyContinue   # it holds the admin password

foreach ($port in 80, 443) {
  if (-not (Test-PortFree $port)) {
    $owner = Get-NetTCPConnection -LocalPort $port -State Listen -ErrorAction SilentlyContinue | Select-Object -First 1
    $name = if ($owner -and $owner.OwningProcess -eq 4) { 'Windows HTTP service (IIS: stop "World Wide Web Publishing Service")' }
            elseif ($owner) { (Get-Process -Id $owner.OwningProcess -ErrorAction SilentlyContinue).ProcessName } else { 'another program' }
    throw "Port $port is used by $name. Stop it (and set it to not start), then run the installer again."
  }
}

foreach ($d in 'config', 'pgdata', 'wal-staging', 'wal-staging\restore', 'caddy', 'caddy-config', 'desktop', 'logs') {
  New-Item -ItemType Directory -Force -Path (Join-Path $Data $d) | Out-Null
}
$backupDir = if ($p.backup_dir) { $p.backup_dir } else { Join-Path $Data 'backups' }
New-Item -ItemType Directory -Force -Path $backupDir | Out-Null

# Settings and secrets: readable by Administrators and SYSTEM only.
icacls $Config /inheritance:r /grant:r '*S-1-5-32-544:(OI)(CI)F' '*S-1-5-18:(OI)(CI)F' | Out-Null
$pgPort = Free-Port 5432
$apiPort = Free-Port 8000
$pgPassword = New-Secret 24
$serverName = if ($p.server_name) { $p.server_name } else { $env:COMPUTERNAME.ToLower() }
$vars = [ordered]@{
  SERVER_NAME           = $serverName
  NODE_NAME             = $env:COMPUTERNAME.ToLower()
  POSTGRES_USER         = 'clinic'
  POSTGRES_DB           = 'clinic'
  POSTGRES_PASSWORD     = $pgPassword
  PGPORT                = "$pgPort"
  CLINIC_DATABASE_URL   = "postgresql+psycopg://clinic:$pgPassword@127.0.0.1:$pgPort/clinic"
  CLINIC_JWT_SECRET     = (New-Secret 32)
  CLINIC_API_PORT       = "$apiPort"
  BACKUP_DIR            = $backupDir
  BACKUP_KEY_FILE       = (Join-Path $Config 'backup.key')
  BACKUP_TIME           = '0200'
}
$envText = "# Clinic Server settings (made by setup.ps1). Keep secret.`r`n" + (($vars.GetEnumerator() | ForEach-Object { "$($_.Key)=$($_.Value)" }) -join "`r`n") + "`r`n"
[System.IO.File]::WriteAllText($EnvFile, $envText, (New-Object System.Text.UTF8Encoding $false))
[System.IO.File]::WriteAllText($vars['BACKUP_KEY_FILE'], (New-Secret 48), (New-Object System.Text.UTF8Encoding $false))

Say 'Creating the database'
$pw = Join-Path $Config 'pg.pw'
[System.IO.File]::WriteAllText($pw, $pgPassword, (New-Object System.Text.ASCIIEncoding))
$pgdata = Join-Path $Data 'pgdata'
# initdb drops administrator rights (a restricted token) before it runs, so the installing user needs
# its own rights on the folder; Administrators-group rights alone are not enough.
$me = [System.Security.Principal.WindowsIdentity]::GetCurrent().User.Value
icacls $pgdata /grant "*$($me):(OI)(CI)F" | Out-Null
icacls $Config /grant "*$($me):(OI)(CI)F" | Out-Null
Invoke-Native (Join-Path $PgBin 'initdb.exe') @('-D', $pgdata, '-U', 'clinic', "--pwfile=$pw", '-E', 'UTF8', '--locale=C', '--auth=scram-sha-256') 'initdb'
Remove-Item $pw -Force
$staging = (Join-Path $Data 'wal-staging') -replace '\\', '\\'
Add-Content -Path (Join-Path $pgdata 'postgresql.conf') -Encoding ASCII -Value @"

# ---- Clinic Server (setup.ps1)
listen_addresses = 'localhost'
port = $pgPort
timezone = 'Asia/Riyadh'
log_timezone = 'Asia/Riyadh'
wal_level = replica
archive_mode = on
archive_timeout = 300
archive_command = 'copy "%p" "$staging\\%f"'
restore_command = 'copy "$staging\\restore\\%f" "%p"'
"@
# PostgreSQL runs as Network Service; it needs its data and the WAL staging folder.
foreach ($d in $pgdata, (Join-Path $Data 'wal-staging')) {
  icacls $d /grant '*S-1-5-20:(OI)(CI)F' /T /Q | Out-Null
}
Invoke-Native (Join-Path $PgBin 'pg_ctl.exe') @('register', '-N', 'ClinicDB', '-U', 'NT AUTHORITY\NetworkService', '-D', $pgdata, '-S', 'auto', '-w') 'registering the database service'
Start-Service ClinicDB
Wait-Until { & (Join-Path $PgBin 'pg_isready.exe') -q -h 127.0.0.1 -p $pgPort; $LASTEXITCODE -eq 0 } 120 'The database'
$env:PGPASSWORD = $pgPassword
Invoke-Native (Join-Path $PgBin 'createdb.exe') @('-h', '127.0.0.1', '-p', "$pgPort", '-U', 'clinic', 'clinic') 'createdb'
Remove-Item Env:\PGPASSWORD

Say 'Installing the services'
Install-WinswServices
Start-All $vars

Say 'Creating the administrator'
foreach ($k in $vars.Keys) { Set-Item -Path "Env:\$k" -Value $vars[$k] }
Push-Location (Join-Path $App 'api')
try {
  & $Python -m app.cli create-admin --username $p.admin_user --name-ar $p.admin_name --password $p.admin_password
  if ($LASTEXITCODE -ne 0) { throw 'Could not create the administrator (password at least 10 characters, not the username).' }
} finally { Pop-Location }
if ($p.demo_data) { Add-DemoData $vars }

Say 'Trusting the clinic certificate on this PC'
Wait-Until { Test-Path (Join-Path $Data 'caddy\caddy\pki\authorities\local\root.crt') } 60 'The clinic certificate'
$ca = Join-Path $Data 'caddy\caddy\pki\authorities\local\root.crt'
Invoke-Native 'certutil.exe' @('-f', '-addstore', 'Root', $ca) 'trusting the clinic certificate'
Copy-Item $ca (Join-Path $Data 'clinic-ca.crt') -Force

Invoke-Native 'netsh.exe' @('advfirewall', 'firewall', 'add', 'rule', 'name=Clinic Server (web)', 'dir=in', 'action=allow', 'protocol=TCP', 'localport=80,443', 'profile=private,domain') 'opening the firewall'

$fp = (Get-FileHash -Algorithm SHA256 -InputStream ([IO.MemoryStream]::new(([Security.Cryptography.X509Certificates.X509Certificate2]::new($ca)).RawData))).Hash -replace '(..)(?!$)', '$1:'
$readme = @"
Clinic Server
=============
Open:              https://$serverName   (also https://localhost on this PC)
Administrator:     $($p.admin_user)
Clinic CA:         $Data\clinic-ca.crt
CA fingerprint:    $fp   (compare it in the desktop app's first-launch screen)
Backups:           $backupDir   (encrypted; nightly at 02:00, WAL every few minutes)
Backup key:        $($vars['BACKUP_KEY_FILE'])
                   PRINT THIS KEY AND KEEP IT IN THE SAFE. Without it backups cannot be restored.
Logs:              $Data\logs
Settings:          $EnvFile
Backups/restore:   "$App\server\clinic-ops.cmd" backup-now | restore-dump FILE | restore-pitr BASE [TIME]
Forgot a password: Start menu > Clinic Server > Reset a password (right-click, Run as administrator)
"@
[System.IO.File]::WriteAllText((Join-Path $Data 'README.txt'), $readme, (New-Object System.Text.UTF8Encoding $true))
Say "Done. Open https://$serverName"
Stop-Transcript | Out-Null
exit 0
