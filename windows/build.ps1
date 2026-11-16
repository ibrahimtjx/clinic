<#
  Builds Clinic-Server-Setup-<version>.exe on Windows (GitHub Actions: .github/workflows/windows-server.yml).

  Needs: Python 3.12 (for pip), Node 22 + pnpm, MSYS2 at C:\msys64 (Pango for PDFs), Inno Setup 6.
  Downloads: PostgreSQL 16 (EnterpriseDB binaries), Python 3.12 embeddable, Caddy, WinSW.
#>
param(
  [string]$Version = '0.11.0',
  [string]$Out = (Join-Path $PSScriptRoot 'out')
)
$ErrorActionPreference = 'Stop'
$ProgressPreference = 'SilentlyContinue'
$Root = Split-Path -Parent $PSScriptRoot
$B = Join-Path $Out 'bundle'
$Dl = Join-Path $Out 'downloads'
$PyVersion = '3.12.10'
$CaddyVersion = '2.10.0'
$WinswVersion = '2.12.0'
$PgCandidates = @('16.10-1', '16.9-1', '16.8-1', '16.6-1', '16.4-1')

function Say($m) { Write-Host "== $m" }
function Get-File($url, $dest) {
  if (-not (Test-Path $dest)) { Say "Downloading $url"; Invoke-WebRequest -UseBasicParsing $url -OutFile $dest }
}

Remove-Item -Recurse -Force $B -ErrorAction SilentlyContinue
New-Item -ItemType Directory -Force -Path $B, $Dl | Out-Null

# ---- PostgreSQL 16 (only what the server needs: bin, lib, share)
$pgZip = $null
foreach ($v in $PgCandidates) {
  $dest = Join-Path $Dl "postgresql-$v.zip"
  try { Get-File "https://get.enterprisedb.com/postgresql/postgresql-$v-windows-x64-binaries.zip" $dest; $pgZip = $dest; Say "PostgreSQL $v"; break }
  catch { Remove-Item $dest -ErrorAction SilentlyContinue; Write-Host "  $v not available" }
}
if (-not $pgZip) { throw 'No PostgreSQL 16 download found' }
$pgTmp = Join-Path $Out 'pgsql-unzip'
Remove-Item -Recurse -Force $pgTmp -ErrorAction SilentlyContinue
Expand-Archive $pgZip $pgTmp
New-Item -ItemType Directory -Force -Path (Join-Path $B 'pgsql') | Out-Null
foreach ($d in 'bin', 'lib', 'share') { Copy-Item -Recurse (Join-Path $pgTmp "pgsql\$d") (Join-Path $B "pgsql\$d") }
Remove-Item -Recurse -Force (Join-Path $B 'pgsql\bin\*.pdb'), (Join-Path $B 'pgsql\lib\*.pdb') -ErrorAction SilentlyContinue
Get-ChildItem (Join-Path $B 'pgsql\bin') -Filter 'stackbuilder*' | Remove-Item -Force
Remove-Item -Recurse -Force $pgTmp

# ---- Python 3.12 embeddable + the API's dependencies
$pyZip = Join-Path $Dl "python-$PyVersion-embed-amd64.zip"
Get-File "https://www.python.org/ftp/python/$PyVersion/python-$PyVersion-embed-amd64.zip" $pyZip
Expand-Archive $pyZip (Join-Path $B 'python')
$pth = Get-ChildItem (Join-Path $B 'python') -Filter 'python*._pth' | Select-Object -First 1
# Embedded Python ignores the current folder: put the API code on its path for every command.
Set-Content -Path $pth.FullName -Encoding ASCII -Value @"
$($pth.BaseName).zip
.
Lib\site-packages
..\api
import site
"@
Say 'Installing the API dependencies'
$deps = python -c "import tomllib,sys; print('\n'.join(tomllib.load(open(sys.argv[1],'rb'))['project']['dependencies']))" (Join-Path $Root 'api\pyproject.toml')
$req = Join-Path $Out 'requirements.txt'
# tzdata: Windows has no time-zone database for zoneinfo ("Asia/Riyadh"). cryptography: backups.
Set-Content -Path $req -Encoding ASCII -Value (($deps -split "`n") + 'cryptography' + 'tzdata')
python -m pip install --disable-pip-version-check --no-warn-script-location --target (Join-Path $B 'python\Lib\site-packages') -r $req
if ($LASTEXITCODE -ne 0) { throw 'pip install failed' }

# ---- Pango and friends for WeasyPrint (from MSYS2), with fontconfig settings
Say 'Collecting Pango for PDFs'
$bash = 'C:\msys64\usr\bin\bash.exe'
& $bash -lc 'pacman -S --noconfirm --needed mingw-w64-ucrt-x86_64-pango mingw-w64-ucrt-x86_64-ntldd' | Out-Host
$ucrt = 'C:\msys64\ucrt64'
$gtkBin = Join-Path $B 'gtk\bin'
New-Item -ItemType Directory -Force -Path $gtkBin | Out-Null
$roots = 'libgobject-2.0-0.dll', 'libpango-1.0-0.dll', 'libpangoft2-1.0-0.dll', 'libharfbuzz-0.dll', 'libharfbuzz-subset-0.dll', 'libfontconfig-1.dll'
$dlls = New-Object System.Collections.Generic.HashSet[string]
foreach ($r in $roots) {
  [void]$dlls.Add((Join-Path "$ucrt\bin" $r))
  $lines = & "$ucrt\bin\ntldd.exe" -R (Join-Path "$ucrt\bin" $r)
  foreach ($l in $lines) { if ($l -match '=>\s+(\S*msys64\S*\.dll)') { [void]$dlls.Add($Matches[1].Replace('/', '\')) } }
}
foreach ($d in $dlls) { Copy-Item $d $gtkBin -Force }
Copy-Item -Recurse "$ucrt\etc\fonts" (Join-Path $B 'gtk\etc\fonts')
Say "  $($dlls.Count) libraries"

# ---- Caddy and WinSW
$caddyZip = Join-Path $Dl "caddy-$CaddyVersion.zip"
Get-File "https://github.com/caddyserver/caddy/releases/download/v$CaddyVersion/caddy_${CaddyVersion}_windows_amd64.zip" $caddyZip
Expand-Archive $caddyZip (Join-Path $B 'caddy')
New-Item -ItemType Directory -Force -Path (Join-Path $B 'services') | Out-Null
Get-File "https://github.com/winsw/winsw/releases/download/v$WinswVersion/WinSW-x64.exe" (Join-Path $Dl 'WinSW-x64.exe')
Copy-Item (Join-Path $Dl 'WinSW-x64.exe') (Join-Path $B 'services\WinSW-x64.exe')
Copy-Item (Join-Path $PSScriptRoot 'server\services\*.xml') (Join-Path $B 'services')

# ---- The clinic system: web build, API code, server scripts
Say 'Building the web app'
Push-Location (Join-Path $Root 'web')
pnpm install --frozen-lockfile
if ($LASTEXITCODE -ne 0) { throw 'pnpm install failed' }
pnpm build
if ($LASTEXITCODE -ne 0) { throw 'web build failed' }
Pop-Location
Copy-Item -Recurse (Join-Path $Root 'web\dist') (Join-Path $B 'web')

New-Item -ItemType Directory -Force -Path (Join-Path $B 'api') | Out-Null
Copy-Item -Recurse (Join-Path $Root 'api\app'), (Join-Path $Root 'api\migrations') (Join-Path $B 'api')
Copy-Item (Join-Path $Root 'api\alembic.ini') (Join-Path $B 'api')
Get-ChildItem (Join-Path $B 'api') -Recurse -Directory -Filter '__pycache__' | Remove-Item -Recurse -Force

New-Item -ItemType Directory -Force -Path (Join-Path $B 'server') | Out-Null
foreach ($f in 'setup.ps1', 'run_api.py', 'ops_win.py', 'Caddyfile.template', 'clinic-ops.cmd') {
  Copy-Item (Join-Path $PSScriptRoot "server\$f") (Join-Path $B 'server')
}
Copy-Item (Join-Path $Root 'docs\windows-server.md') (Join-Path $B 'GUIDE.md')

# ---- Installer
Say 'Building the installer'
$iscc = 'C:\Program Files (x86)\Inno Setup 6\ISCC.exe'
if (-not (Test-Path $iscc)) { choco install innosetup -y --no-progress | Out-Host }
& $iscc "/DAppVersion=$Version" "/DBundle=$B" "/O$Out" (Join-Path $PSScriptRoot 'installer.iss')
if ($LASTEXITCODE -ne 0) { throw 'ISCC failed' }
Get-ChildItem $Out -Filter 'Clinic-Server-Setup-*.exe' | ForEach-Object { Say "Built $($_.FullName) ($([math]::Round($_.Length / 1MB)) MB)" }
