param(
    [string]$LocalHost = "127.0.0.1",
    [int]$LocalPort = 8010,
    [string]$WorkspaceRoot = "D:\AiFitCoach-main"
)

$ErrorActionPreference = "Stop"

$outputFile = Join-Path $WorkspaceRoot "serveo_public_url.txt"
$sshExe = "ssh"

function Read-AppendedText {
    param(
        [Parameter(Mandatory = $true)]
        [string]$Path,

        [Parameter(Mandatory = $true)]
        [ref]$Position
    )

    if (-not (Test-Path $Path)) {
        return ""
    }

    $stream = $null
    $reader = $null
    try {
        $stream = [System.IO.File]::Open($Path, [System.IO.FileMode]::Open, [System.IO.FileAccess]::Read, [System.IO.FileShare]::ReadWrite)
        $null = $stream.Seek([Math]::Min([long]$Position.Value, $stream.Length), [System.IO.SeekOrigin]::Begin)
        $reader = New-Object System.IO.StreamReader($stream)
        $text = $reader.ReadToEnd()
        $Position.Value = $stream.Position
        return $text
    }
    finally {
        if ($reader) {
            $reader.Dispose()
        }
        elseif ($stream) {
            $stream.Dispose()
        }
    }
}

function Flush-BufferedLines {
    param(
        [AllowEmptyString()]
        [string]$Chunk,

        [Parameter(Mandatory = $true)]
        [ref]$Buffer,

        [scriptblock]$OnLine
    )

    if ([string]::IsNullOrEmpty($Chunk)) {
        return
    }

    $Buffer.Value += $Chunk
    $normalized = $Buffer.Value -replace "`r`n", "`n" -replace "`r", "`n"
    $parts = $normalized -split "`n", -1

    if ($normalized.EndsWith("`n")) {
        $Buffer.Value = ""
    }
    else {
        $Buffer.Value = $parts[-1]
        if ($parts.Length -gt 1) {
            $parts = $parts[0..($parts.Length - 2)]
        }
        else {
            $parts = @()
        }
    }

    foreach ($line in $parts) {
        if ([string]::IsNullOrWhiteSpace($line)) {
            continue
        }
        & $OnLine $line
    }
}

while ($true) {
    Write-Host "Starting Serveo tunnel for $LocalHost`:$LocalPort"
    $stdoutPath = [System.IO.Path]::GetTempFileName()
    $stderrPath = [System.IO.Path]::GetTempFileName()

    $process = Start-Process -FilePath $sshExe `
        -ArgumentList @(
            "-o", "StrictHostKeyChecking=no",
            "-o", "ServerAliveInterval=30",
            "-R", "80:${LocalHost}:${LocalPort}",
            "serveo.net"
        ) `
        -NoNewWindow `
        -RedirectStandardOutput $stdoutPath `
        -RedirectStandardError $stderrPath `
        -PassThru

    $stdoutPosition = 0L
    $stderrPosition = 0L
    $stdoutBuffer = ""
    $stderrBuffer = ""
    $handleLine = {
        param([string]$line)

        Write-Host $line
        if ($line -match 'https://[^\s]*serveousercontent\.com[^\s]*') {
            $url = $Matches[0]
            Set-Content -Path $outputFile -Value $url -Encoding ascii
            Write-Host "Current public URL: $url"
        }
    }

    while ($true) {
        $stdoutChunk = Read-AppendedText -Path $stdoutPath -Position ([ref]$stdoutPosition)
        Flush-BufferedLines -Chunk $stdoutChunk -Buffer ([ref]$stdoutBuffer) -OnLine $handleLine

        $stderrChunk = Read-AppendedText -Path $stderrPath -Position ([ref]$stderrPosition)
        Flush-BufferedLines -Chunk $stderrChunk -Buffer ([ref]$stderrBuffer) -OnLine { param($line) Write-Host $line }

        $process.Refresh()
        if ($process.HasExited) {
            break
        }

        Start-Sleep -Seconds 1
    }

    $stdoutChunk = Read-AppendedText -Path $stdoutPath -Position ([ref]$stdoutPosition)
    Flush-BufferedLines -Chunk $stdoutChunk -Buffer ([ref]$stdoutBuffer) -OnLine $handleLine
    if (-not [string]::IsNullOrWhiteSpace($stdoutBuffer)) {
        & $handleLine $stdoutBuffer
    }

    $stderrChunk = Read-AppendedText -Path $stderrPath -Position ([ref]$stderrPosition)
    Flush-BufferedLines -Chunk $stderrChunk -Buffer ([ref]$stderrBuffer) -OnLine { param($line) Write-Host $line }
    if (-not [string]::IsNullOrWhiteSpace($stderrBuffer)) {
        Write-Host $stderrBuffer
    }

    Write-Host "Serveo tunnel exited with code $($process.ExitCode). Reconnecting..."
    Remove-Item -Path $stdoutPath, $stderrPath -Force -ErrorAction SilentlyContinue
}