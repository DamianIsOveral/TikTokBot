param([switch]$NoBrowser)

$ErrorActionPreference = 'Stop'
$projectRoot = Split-Path -Parent $PSScriptRoot
$lock = $null
$locked = $false
try {
    Set-Location -LiteralPath $projectRoot
    $nodePath = (Get-Command node -ErrorAction Stop).Source
    $dashboardUrl = & $nodePath --env-file-if-exists=.env scripts/dashboard-url.ts
    if ($LASTEXITCODE -ne 0) { throw 'Controleer de instellingen in .env.' }
    $dashboardUrl = ($dashboardUrl | Select-Object -Last 1).Trim()
    $portNumber = ([Uri]$dashboardUrl).Port
    $lock = New-Object Threading.Mutex($false, "Local\FaynominaalDashboard-$portNumber")
    $locked = $lock.WaitOne(30000)
    if (-not $locked) { throw 'Een andere snelkoppeling is nog bezig. Probeer opnieuw.' }

    function Test-Dashboard {
        try {
            $health = Invoke-RestMethod -Uri "$dashboardUrl/health" -TimeoutSec 1
            return ($health.ok -eq $true -and $health.app -eq 'faynominaal-live')
        } catch { return $false }
    }

    if (-not (Test-Dashboard)) {
        if (-not (Test-Path -LiteralPath 'node_modules/tiktok-live-connector')) {
            throw 'Dependencies ontbreken. Voer eerst npm ci uit in de projectmap.'
        }
        $npmPath = (Get-Command npm.cmd -ErrorAction Stop).Source
        & $npmPath run build
        if ($LASTEXITCODE -ne 0) { throw 'Dashboard compileren mislukt. Controleer de TypeScript-installatie met npm ci.' }
        $logDirectory = Join-Path $projectRoot '.local-archive/launcher'
        New-Item -ItemType Directory -Force -Path $logDirectory | Out-Null
        $serverProcess = Start-Process -FilePath $nodePath -ArgumentList @('--env-file-if-exists=.env', 'src/server/main.ts') -WorkingDirectory $projectRoot -WindowStyle Hidden -PassThru -RedirectStandardOutput (Join-Path $logDirectory 'server.log') -RedirectStandardError (Join-Path $logDirectory 'server-error.log')
        $ready = $false
        for ($attempt = 0; $attempt -lt 60; $attempt++) {
            if (Test-Dashboard) { $ready = $true; break }
            if ($serverProcess.HasExited) { break }
            Start-Sleep -Milliseconds 250
        }
        if (-not $ready) {
            throw "Server kon niet starten. Mogelijk is poort $portNumber bezet. Zie .local-archive/launcher/server-error.log."
        }
        Write-Output 'Server gestart.'
    } else {
        Write-Output 'Server draait al.'
    }
    if (-not $NoBrowser) { Start-Process $dashboardUrl }
    Write-Output "Dashboard: $dashboardUrl"
} catch {
    if ($NoBrowser) { throw }
    Add-Type -AssemblyName System.Windows.Forms
    [System.Windows.Forms.MessageBox]::Show($_.Exception.Message, 'Faynominaal Dashboard', 'OK', 'Error') | Out-Null
    exit 1
} finally {
    if ($locked) { $lock.ReleaseMutex() }
    if ($lock) { $lock.Dispose() }
}
