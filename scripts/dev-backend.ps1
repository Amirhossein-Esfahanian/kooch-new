#requires -Version 5.1
<#
.SYNOPSIS
Starts the local Development API safely; Ctrl+C shuts it down normally.
.PARAMETER ValidateOnly
Checks prerequisites and prints the runtime command without building, setting
environment variables, or starting the API.
#>
[CmdletBinding()]
param([switch]$ValidateOnly)

Set-StrictMode -Version Latest
$ErrorActionPreference = 'Stop'

function Assert-BackendPortFree {
    $listeners = @(Get-NetTCPConnection -State Listen -ErrorAction Stop |
        Where-Object { $_.LocalPort -eq 5081 })
    if ($listeners.Count -gt 0) {
        $owners = ($listeners.OwningProcess | Sort-Object -Unique) -join ', '
        throw "Port 5081 is occupied (PID: $owners). Use Ctrl+C in its owning console; this script never stops another process."
    }
}

$repoRoot = (Resolve-Path -LiteralPath (Join-Path $PSScriptRoot '..')).Path
if ($repoRoot -ne 'E:\React\kooch') {
    throw 'Repository mismatch: this command must belong to E:\React\kooch.'
}
$gitRoot = & git -C $repoRoot rev-parse --show-toplevel
if ($LASTEXITCODE -ne 0 -or $gitRoot.Trim().Replace('/', '\') -ne $repoRoot) {
    throw 'Canonical Kooch Git root could not be verified.'
}
if ([Security.Principal.WindowsIdentity]::GetCurrent().Name -ne 'COPPER-DESKTOP\Copper') {
    throw 'Use the approved Development Windows account COPPER-DESKTOP\Copper.'
}
Assert-BackendPortFree

$settingsPath = 'C:\Users\Copper\AppData\Local\Kooch\Development\property-direct-context.psd1'
try {
    $settings = Import-PowerShellDataFile -LiteralPath $settingsPath
} catch {
    throw 'Cannot read the controlled Development PSD1. Restore the existing local settings; do not create a new application identity.'
}
$expectedKeys = @(
    'ASPNETCORE_ENVIRONMENT', 'DOTNET_ENVIRONMENT',
    'AutomaticDatabaseMutations__Enabled',
    'PropertyDirectBookingContexts__KeyRingPath',
    'PropertyDirectBookingContexts__ApplicationName',
    'PropertyDirectBookingContexts__KeyEncryptionCertificateThumbprint',
    'PropertyDirectBookingContexts__LifetimeMinutes'
)
if ($settings -isnot [hashtable] -or
    @(Compare-Object ($settings.Keys | Sort-Object) ($expectedKeys | Sort-Object)).Count -ne 0) {
    throw 'Unexpected PSD1 structure: expected the seven existing flat environment-setting keys.'
}
foreach ($name in $expectedKeys) {
    if ([string]::IsNullOrWhiteSpace([string]$settings[$name])) {
        throw "Required controlled setting is empty: $name."
    }
}
if ($settings.ASPNETCORE_ENVIRONMENT -cne 'Development' -or
    $settings.DOTNET_ENVIRONMENT -cne 'Development' -or
    [string]$settings.AutomaticDatabaseMutations__Enabled -ine 'false') {
    throw 'Controlled settings must specify Development and AutomaticDatabaseMutations__Enabled=false.'
}

$ringPath = [string]$settings.PropertyDirectBookingContexts__KeyRingPath
$applicationName = [string]$settings.PropertyDirectBookingContexts__ApplicationName
$thumbprint = [string]$settings.PropertyDirectBookingContexts__KeyEncryptionCertificateThumbprint
if ($ringPath -ne 'C:\Users\Copper\AppData\Local\Kooch\Development\DataProtectionKeys' -or
    $applicationName -cne 'Kooch.Development.PropertyDirectBookingContexts.v1' -or
    $thumbprint -ne 'BDB9920131D595BAA054BE92D9D56B195120236E') {
    throw 'Data Protection identity differs from the existing approved Development ring/application/certificate. No replacement will be created.'
}
$lifetime = 0
if (-not [int]::TryParse([string]$settings.PropertyDirectBookingContexts__LifetimeMinutes, [ref]$lifetime) -or
    $lifetime -lt 1 -or $lifetime -gt 60) {
    throw 'Context lifetime must be an integer between 1 and 60 minutes.'
}
if (-not (Test-Path -LiteralPath $ringPath -PathType Container)) {
    throw 'The existing persistent Key Ring directory is missing. Startup refused.'
}
$keyFiles = @(Get-ChildItem -LiteralPath $ringPath -Filter 'key-*.xml' -File)
if ($keyFiles.Count -eq 0) {
    throw 'The persistent Key Ring has no existing key files. Startup refused.'
}
foreach ($keyFile in $keyFiles) {
    try {
        $xml = New-Object System.Xml.XmlDocument
        $xml.XmlResolver = $null
        $xml.Load($keyFile.FullName)
        $encrypted = $xml.SelectNodes("//*[local-name()='encryptedSecret']").Count
        $plaintext = $xml.SelectNodes("//*[local-name()='masterKey']/*[local-name()='value']").Count
    } catch {
        throw 'An existing Key Ring file cannot be inspected. Key contents are not displayed.'
    }
    if ($encrypted -eq 0 -or $plaintext -ne 0) {
        throw 'An existing Key Ring file is not encrypted as expected. Startup refused; no keys were changed.'
    }
}

$store = [Security.Cryptography.X509Certificates.X509Store]::new('My', 'CurrentUser')
try {
    $store.Open([Security.Cryptography.X509Certificates.OpenFlags]::ReadOnly)
    $certificates = $store.Certificates.Find(
        [Security.Cryptography.X509Certificates.X509FindType]::FindByThumbprint, $thumbprint, $true)
    if ($certificates.Count -ne 1 -or -not $certificates[0].HasPrivateKey) {
        throw 'The configured CurrentUser certificate must pass validOnly=true and have its existing private key.'
    }
} finally {
    $store.Close()
}

$dotnet = (Get-Command dotnet -CommandType Application -ErrorAction Stop).Source
$project = Join-Path $repoRoot 'backend\Kooch.Api\Kooch.Api.csproj'
$runArguments = @(
    'run', '--project', $project, '-c', 'Release', '--no-build', '--no-launch-profile', '--',
    '--urls', 'http://localhost:5081', '--environment', 'Development',
    '--AutomaticDatabaseMutations:Enabled=false',
    "--PropertyDirectBookingContexts:KeyRingPath=$ringPath",
    "--PropertyDirectBookingContexts:ApplicationName=$applicationName",
    "--PropertyDirectBookingContexts:KeyEncryptionCertificateThumbprint=$thumbprint",
    "--PropertyDirectBookingContexts:LifetimeMinutes=$lifetime"
)
Write-Host 'Preflight passed: Development; database mutations OFF; existing encrypted ring and valid certificate.'
Write-Host ('Runtime command: dotnet ' + (($runArguments | ForEach-Object { '"' + $_ + '"' }) -join ' '))
if ($ValidateOnly) {
    Write-Host 'Validation only: no build, environment changes or server startup performed.'
    return
}

$previousEnvironment = @{}
Push-Location -LiteralPath $repoRoot
try {
    Write-Host 'Building current Backend source in Release (incremental; no package restore)...'
    & $dotnet build $project -c Release --no-restore
    if ($LASTEXITCODE -ne 0) { throw 'Release build failed. The API was not started.' }
    Assert-BackendPortFree
    foreach ($name in $expectedKeys) {
        $previousEnvironment[$name] = [Environment]::GetEnvironmentVariable($name, 'Process')
        [Environment]::SetEnvironmentVariable($name, [string]$settings[$name], 'Process')
    }
    Write-Host 'Starting Release API at http://localhost:5081. Use Ctrl+C for graceful shutdown.'
    Write-Host 'Confirm Startup reports: Automatic database migrations, seed operations, and background database writers are disabled.'
    & $dotnet @runArguments
    if ($LASTEXITCODE -notin @(0, 130, -1073741510)) {
        throw "Backend exited with code $LASTEXITCODE. Inspect the Startup log; no automatic retry or restart was attempted."
    }
} finally {
    foreach ($name in $previousEnvironment.Keys) {
        [Environment]::SetEnvironmentVariable($name, $previousEnvironment[$name], 'Process')
    }
    Pop-Location
}
