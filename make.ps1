[CmdletBinding()]
param(
  [Parameter(Position = 0, ValueFromRemainingArguments = $true)]
  [string[]] $MakeArguments
)

$ErrorActionPreference = "Stop"

$repoRoot = $PSScriptRoot
$toolsRoot = Join-Path $repoRoot ".tools"
$localMake = Join-Path $toolsRoot "make-4.4.1\bin\make.exe"
$pathEntries = [System.Collections.Generic.List[string]]::new()

if (Test-Path -LiteralPath $localMake) {
  $makeExecutable = $localMake
  $pathEntries.Add((Split-Path -Parent $localMake))
} else {
  $makeCommand = Get-Command make.exe -ErrorAction SilentlyContinue
  if (-not $makeCommand) {
    throw "GNU Make was not found. Provision .tools\make-4.4.1 or install GNU Make 4.4.1."
  }
  $makeExecutable = $makeCommand.Source
}

$localJavaRoot = Join-Path $toolsRoot "java21"
if (Test-Path -LiteralPath $localJavaRoot) {
  $jdk = Get-ChildItem -LiteralPath $localJavaRoot -Directory |
    Where-Object { Test-Path -LiteralPath (Join-Path $_.FullName "bin\java.exe") } |
    Sort-Object Name -Descending |
    Select-Object -First 1

  if ($jdk) {
    $env:JAVA_HOME = $jdk.FullName
    $pathEntries.Add((Join-Path $jdk.FullName "bin"))
  }
}

$localGitleaks = Join-Path $toolsRoot "gitleaks-8.30.1\gitleaks.exe"
if (Test-Path -LiteralPath $localGitleaks) {
  $pathEntries.Add((Split-Path -Parent $localGitleaks))
}

$gitCommand = Get-Command git.exe -ErrorAction SilentlyContinue
if (-not $gitCommand) {
  throw "Git for Windows was not found."
}

$gitBin = "C:\Program Files\Git\bin"
if (-not (Test-Path -LiteralPath (Join-Path $gitBin "bash.exe"))) {
  $gitRoot = Split-Path -Parent (Split-Path -Parent $gitCommand.Source)
  $gitBin = Join-Path $gitRoot "bin"
}
$gitBash = Join-Path $gitBin "bash.exe"
if (-not (Test-Path -LiteralPath $gitBash)) {
  throw "Git Bash was not found at $gitBash."
}
$gitUsrBin = Join-Path (Split-Path -Parent $gitBin) "usr\bin"
if (-not (Test-Path -LiteralPath (Join-Path $gitUsrBin "dirname.exe"))) {
  throw "Git Bash core utilities were not found at $gitUsrBin."
}
$pathEntries.Add($gitUsrBin)
$pathEntries.Add($gitBin)

$nodeCommand = Get-Command node.exe -ErrorAction SilentlyContinue
if (-not $nodeCommand) {
  throw "Node.js was not found."
}
$nodeBin = Split-Path -Parent $nodeCommand.Source
$pathEntries.Add($nodeBin)

$corepack = Join-Path $nodeBin "corepack"
if (-not (Test-Path -LiteralPath $corepack)) {
  throw "Node Corepack was not found at $corepack."
}

$dockerBin = "C:\Program Files\Docker\Docker\resources\bin"
if (Test-Path -LiteralPath (Join-Path $dockerBin "docker.exe")) {
  $pathEntries.Add($dockerBin)

  $dockerPluginDirectory = Join-Path (Split-Path -Parent $dockerBin) "cli-plugins"
  if (Test-Path -LiteralPath $dockerPluginDirectory) {
    $dockerConfigDirectory = Join-Path $toolsRoot "docker-config"
    New-Item -ItemType Directory -Force -Path $dockerConfigDirectory | Out-Null
    $dockerConfig = @{
      cliPluginsExtraDirs = @($dockerPluginDirectory)
    } | ConvertTo-Json
    [System.IO.File]::WriteAllText(
      (Join-Path $dockerConfigDirectory "config.json"),
      $dockerConfig + "`n",
      [System.Text.UTF8Encoding]::new($false)
    )
    $env:DOCKER_CONFIG = $dockerConfigDirectory
  }
}

$shimBin = Join-Path $toolsRoot "bin"
New-Item -ItemType Directory -Force -Path $shimBin | Out-Null
$pnpmShim = Join-Path $shimBin "pnpm"
$pnpmShimContent = @'
#!/usr/bin/env bash
exec corepack pnpm "$@"
'@
[System.IO.File]::WriteAllText(
  $pnpmShim,
  $pnpmShimContent.Replace("`r`n", "`n") + "`n",
  [System.Text.UTF8Encoding]::new($false)
)
$pathEntries.Insert(0, $shimBin)

$existingPathEntries = @($env:Path -split ";" | Where-Object { $_ })
$orderedPathEntries = [System.Collections.Generic.List[string]]::new()
foreach ($entry in @($pathEntries) + $existingPathEntries) {
  if ($entry -and -not $orderedPathEntries.Contains($entry)) {
    $orderedPathEntries.Add($entry)
  }
}
$env:Path = [string]::Join(";", $orderedPathEntries)

Write-Verbose "GNU Make: $makeExecutable"
Write-Verbose "Git Bash: $gitBash"
Write-Verbose "JAVA_HOME: $env:JAVA_HOME"
Write-Verbose "DOCKER_CONFIG: $env:DOCKER_CONFIG"

if (-not $MakeArguments -or $MakeArguments.Count -eq 0) {
  Write-Host "AutoPay Guard Windows commands:"
  Write-Host "  .\make.ps1 bootstrap"
  Write-Host "  .\make.ps1 up"
  Write-Host "  .\make.ps1 seed"
  Write-Host "  .\make.ps1 m4-live"
  Write-Host "  .\make.ps1 m5-live"
  Write-Host "  .\make.ps1 m5-ui-live"
  Write-Host "  .\make.ps1 m6-live"
  Write-Host "  .\make.ps1 m6-ui-live"
  Write-Host "  .\make.ps1 m6-load"
  Write-Host "  .\make.ps1 m6-restore"
  Write-Host "  .\make.ps1 check"
  Write-Host "  .\make.ps1 down"
  return
}

$makeExitCode = 0
Push-Location $repoRoot
try {
  & $makeExecutable @MakeArguments
  $makeExitCode = $LASTEXITCODE
} finally {
  Pop-Location
}

if ($makeExitCode -ne 0) {
  throw "GNU Make exited with code $makeExitCode."
}
