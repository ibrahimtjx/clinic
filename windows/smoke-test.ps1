<#
  Installs Clinic-Server-Setup.exe silently on this Windows machine and checks it works end to end.
  Used by .github/workflows/windows-server.yml; safe to run on a spare Windows PC too.
#>
param([Parameter(Mandatory)][string]$Installer)
$ErrorActionPreference = 'Stop'
$ProgressPreference = 'SilentlyContinue'
$App = Join-Path $env:ProgramFiles 'Clinic Server'
$Data = Join-Path $env:ProgramData 'ClinicServer'
$Password = 'Smoke-Test-2026!'
function Say($m) { Write-Host "== $m" }
function Check($ok, $what) { if (-not $ok) { throw "FAILED: $what" }; Write-Host "  ok: $what" }
function Api($method, $path, $body = $null) {
  $args = @{ Method = $method; Uri = "https://localhost/api$path"; Headers = $script:H; UseBasicParsing = $true }
  if ($body) { $args.Body = ($body | ConvertTo-Json -Depth 5); $args.ContentType = 'application/json; charset=utf-8' }
  Invoke-RestMethod @args
}
function Install($extra) {
  $p = Start-Process -FilePath $Installer -ArgumentList (@('/VERYSILENT', '/SUPPRESSMSGBOXES', '/NORESTART', "/LOG=$PWD\install.log") + $extra) -Wait -PassThru
  Check ($p.ExitCode -eq 0) "installer exit code 0 (was $($p.ExitCode))"
}

Say 'Fresh install with demo data'
$t = Get-Date
Install @("/AdminPassword=$Password", '/DemoData=1', '/ServerName=clinic-server')
Say "Installed in $([int]((Get-Date) - $t).TotalSeconds) s"
Get-Service Clinic* | Format-Table Name, Status, StartType | Out-Host
foreach ($s in 'ClinicDB', 'ClinicAPI', 'ClinicWeb', 'ClinicOps') { Check ((Get-Service $s).Status -eq 'Running') "$s running" }

Say 'HTTPS with the clinic certificate (installed in the machine store)'
$health = Invoke-RestMethod https://localhost/api/health
Check ($health.status -eq 'ok' -and $health.timezone -eq 'Asia/Riyadh') 'API health over HTTPS, clinic time zone'
Check ((Invoke-WebRequest -UseBasicParsing https://localhost/patients).Content -match 'id="root"') 'web app with deep links'
Check ((Invoke-WebRequest -UseBasicParsing http://localhost/ca.crt).Content.Length -gt 300) 'clinic CA served over HTTP'

Say 'Sign in, write data, PDF'
$login = Invoke-RestMethod -Method Post https://localhost/api/auth/login -ContentType 'application/json' -Body (@{ username = 'admin'; password = $Password } | ConvertTo-Json)
$script:H = @{ Authorization = "Bearer $($login.access_token)" }
$p = Api Post '/patients' @{ name_ar = 'مريض اختبار ويندوز'; mobile = '0551234567'; allow_duplicate = $true }
Check ($p.file_no -ge 1) "patient created (file $($p.file_no))"
$today = (Get-Date).ToString('yyyy-MM-dd')
Invoke-WebRequest -UseBasicParsing -Headers $script:H "https://localhost/api/reports/new_patients/pdf?date_from=$today&date_to=$today" -OutFile report.pdf
$head = [System.Text.Encoding]::ASCII.GetString((Get-Content report.pdf -Encoding Byte -TotalCount 4))
Check ($head -eq '%PDF' -and (Get-Item report.pdf).Length -gt 5000) 'report PDF rendered on the server (WeasyPrint + Pango)'

Say 'Backups'
for ($i = 0; $i -lt 90 -and -not (Get-ChildItem "$Data\backups\base\base-*.tar.enc" -ErrorAction SilentlyContinue); $i++) { Start-Sleep 2 }
Check (Get-ChildItem "$Data\backups\base\base-*.tar.enc" -ErrorAction SilentlyContinue) 'first base backup (encrypted)'
& "$App\server\clinic-ops.cmd" backup-now | Out-Host
$dump = Get-ChildItem "$Data\backups\dumps\daily\*.dump.enc" | Sort-Object LastWriteTime | Select-Object -Last 1
Check $dump 'nightly backup written'
$hl = Api Get '/system/health'
Check ($hl.nodes.Count -ge 1 -and $hl.nodes[0].last_dump_at) 'health page shows the server and the last backup'

Say 'Restore the nightly backup'
Api Post '/patients' @{ name_ar = 'بعد النسخة'; allow_duplicate = $true } | Out-Null
& "$App\server\clinic-ops.cmd" restore-dump $dump.Name | Out-Host
for ($i = 0; $i -lt 60; $i++) { try { if ((Invoke-RestMethod https://localhost/api/health).status -eq 'ok') { break } } catch {}; Start-Sleep 2 }
$login = Invoke-RestMethod -Method Post https://localhost/api/auth/login -ContentType 'application/json' -Body (@{ username = 'admin'; password = $Password } | ConvertTo-Json)
$script:H = @{ Authorization = "Bearer $($login.access_token)" }
$found = Api Get "/patients?q=$([uri]::EscapeDataString('مريض اختبار ويندوز'))"
$after = Api Get "/patients?q=$([uri]::EscapeDataString('بعد النسخة'))"
Check (@($found.items).Count -ge 1 -and @($after.items).Count -eq 0) 'restored to the backup (later patient gone)'

Say 'Upgrade (run the installer again)'
Install @()
Check ((Invoke-RestMethod https://localhost/api/health).status -eq 'ok') 'healthy after upgrade, data kept'
Check (Test-Path "$Data\config\clinic.env") 'settings kept'

Say 'Uninstall'
$p = Start-Process -FilePath "$App\unins000.exe" -ArgumentList '/VERYSILENT', '/SUPPRESSMSGBOXES', '/NORESTART' -Wait -PassThru
Check ($p.ExitCode -eq 0) 'uninstaller exit code 0'
Check (-not (Get-Service ClinicAPI -ErrorAction SilentlyContinue)) 'services removed'
Check (Test-Path "$Data\pgdata") 'clinic data kept after uninstall'
Say 'All checks passed'
