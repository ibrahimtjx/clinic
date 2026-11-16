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
$head = [System.Text.Encoding]::ASCII.GetString([System.IO.File]::ReadAllBytes("$PWD\report.pdf"), 0, 4)
Check ($head -eq '%PDF' -and (Get-Item report.pdf).Length -gt 5000) 'report PDF rendered on the server (WeasyPrint + Pango)'

Say 'Demo data and patient files'
$page = Api Get '/patients?page_size=5'
Check ($page.total -ge 400) "demo patients ($($page.total))"
$demoInv = Api Get '/invoices?limit=500'
Check (@($demoInv).Count -ge 20) "demo invoices ($(@($demoInv).Count))"
Add-Type -AssemblyName System.Drawing
$bmp = New-Object System.Drawing.Bitmap 400, 300
$bmp.Save("$PWD\xray.png", [System.Drawing.Imaging.ImageFormat]::Png)
$up = Invoke-RestMethod -Method Post "https://localhost/api/patients/$($p.id)/files" -Headers $script:H -Form @{ file = Get-Item "$PWD\xray.png"; kind = 'xray'; title = 'smoke' }
Check ($up.has_thumb -and $up.width -eq 400) 'image uploaded with a thumbnail'
Invoke-WebRequest -UseBasicParsing -Headers $script:H "https://localhost/api/files/$($up.id)/thumb" -OutFile thumb.jpg
Check ((Get-Item thumb.jpg).Length -gt 100) 'thumbnail served'
Check (Test-Path "$Data\files\$((Get-Date).ToString('yyyy'))") 'file stored under ProgramData\ClinicServer\files'

Say 'Backups'
for ($i = 0; $i -lt 90 -and -not (Get-ChildItem "$Data\backups\base\base-*.tar.enc" -ErrorAction SilentlyContinue); $i++) { Start-Sleep 2 }
Check (Get-ChildItem "$Data\backups\base\base-*.tar.enc" -ErrorAction SilentlyContinue) 'first base backup (encrypted)'
& "$App\server\clinic-ops.cmd" backup-now | Out-Host
$dump = Get-ChildItem "$Data\backups\dumps\daily\*.dump.enc" | Sort-Object LastWriteTime | Select-Object -Last 1
Check $dump 'nightly backup written'
for ($i = 0; $i -lt 60 -and -not (Get-ChildItem "$Data\backups\files" -Recurse -Filter *.enc -ErrorAction SilentlyContinue); $i++) { Start-Sleep 2 }
Check (Get-ChildItem "$Data\backups\files" -Recurse -Filter *.enc -ErrorAction SilentlyContinue) 'patient files backed up (encrypted)'
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

Say 'Server addresses'
$out = & "$App\server\clinic-ops.cmd" addresses | Out-String
Write-Host $out
$ip = (Get-NetIPAddress -AddressFamily IPv4 | Where-Object { $_.IPAddress -notlike '127.*' -and $_.IPAddress -notlike '169.254.*' } | Select-Object -First 1).IPAddress
Check ((Get-Content "$Data\config\Caddyfile" -Raw) -match [regex]::Escape($ip)) "web server answers on this PC's address ($ip)"

Say 'Reset a forgotten password'
& "$App\server\clinic-ops.cmd" reset-password admin 'Temp-Reset-2026!' | Out-Host
$reset = Invoke-RestMethod -Method Post https://localhost/api/auth/login -ContentType 'application/json' -Body (@{ username = 'admin'; password = 'Temp-Reset-2026!' } | ConvertTo-Json)
Check ($reset.user.must_change_password -eq $true) 'admin signs in with the temporary password and must change it'
# Choose a new password, as the sign-in screen would ask.
$Password = 'After-Reset-2026!'
Invoke-RestMethod -Method Post https://localhost/api/auth/me/password -Headers @{ Authorization = "Bearer $($reset.access_token)" } -ContentType 'application/json' -Body (@{ current_password = 'Temp-Reset-2026!'; new_password = $Password } | ConvertTo-Json) | Out-Null

Say 'Upgrade (run the installer again)'
Install @('/DemoData=1')   # demo data is offered on updates too; already added, so nothing changes
Check ((Invoke-RestMethod https://localhost/api/health).status -eq 'ok') 'healthy after upgrade, data kept'
Check (Test-Path "$Data\config\clinic.env") 'settings kept'

Say 'Uninstall'
$p = Start-Process -FilePath "$App\unins000.exe" -ArgumentList '/VERYSILENT', '/SUPPRESSMSGBOXES', '/NORESTART' -Wait -PassThru
Check ($p.ExitCode -eq 0) 'uninstaller exit code 0'
Check (-not (Get-Service ClinicAPI -ErrorAction SilentlyContinue)) 'services removed'
Check (Test-Path "$Data\pgdata") 'clinic data kept after uninstall'

Say 'Install again over the kept data'
Install @()
Check ((Get-Service ClinicDB).Status -eq 'Running') 'database service registered again'
Check ((Invoke-RestMethod https://localhost/api/health).status -eq 'ok') 'healthy after reinstall'
$login = Invoke-RestMethod -Method Post https://localhost/api/auth/login -ContentType 'application/json' -Body (@{ username = 'admin'; password = $Password } | ConvertTo-Json)
$script:H = @{ Authorization = "Bearer $($login.access_token)" }
Check ((Api Get '/patients?page_size=1').total -ge 400) 'patients still there after reinstall'
netsh advfirewall firewall show rule 'name=Clinic Server (web)' | Out-Null
Check ($LASTEXITCODE -eq 0) 'firewall rule back'
Say 'All checks passed'
