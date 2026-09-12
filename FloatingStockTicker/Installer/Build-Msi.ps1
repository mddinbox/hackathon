[CmdletBinding()]
param(
    [ValidatePattern('^\d+\.\d+\.\d+$')]
    [string]$Version = '1.0.6'
)

$ErrorActionPreference = 'Stop'

$installerDirectory = $PSScriptRoot
$projectDirectory = Split-Path -Parent $installerDirectory
$publishDirectory = Join-Path $projectDirectory 'bin\Release\net8.0-windows\win-x64\publish'
$outputDirectory = Join-Path $projectDirectory 'artifacts\installer'
$buildOutputDirectory = Join-Path $outputDirectory '.build'
$installerProject = Join-Path $installerDirectory 'FloatingStockTicker.Installer.wixproj'
$expectedMsi = Join-Path $outputDirectory "FloatingStockTicker-$Version-x64.msi"
$builtMsi = Join-Path $buildOutputDirectory "FloatingStockTicker-$Version-x64.msi"

New-Item -ItemType Directory -Path $outputDirectory -Force | Out-Null
if (Test-Path -LiteralPath $buildOutputDirectory) {
    Remove-Item -LiteralPath $buildOutputDirectory -Recurse -Force
}
New-Item -ItemType Directory -Path $buildOutputDirectory -Force | Out-Null

Write-Host 'Publishing the self-contained win-x64 single-file application...'
dotnet publish (Join-Path $projectDirectory 'FloatingStockTicker.csproj') `
    -c Release `
    -p:PublishProfile=PortableWinX64 `
    -p:Version=$Version `
    --nologo
if ($LASTEXITCODE -ne 0) {
    throw "dotnet publish failed with exit code $LASTEXITCODE."
}

$publishedExe = Join-Path $publishDirectory 'FloatingStockTicker.exe'
if (-not (Test-Path -LiteralPath $publishedExe -PathType Leaf)) {
    throw "Expected publish payload was not found: $publishedExe"
}

$payloadFiles = @(Get-ChildItem -LiteralPath $publishDirectory -File -Recurse)
if ($payloadFiles.Count -ne 1 -or $payloadFiles[0].Name -ne 'FloatingStockTicker.exe') {
    throw "The publish directory must contain only the single-file executable. Found: $($payloadFiles.Name -join ', ')"
}

Write-Host 'Building the WiX v4 MSI...'
dotnet build $installerProject `
    -c Release `
    -t:Rebuild `
    -p:ProductVersion=$Version `
    -p:PublishDir="$publishDirectory\" `
    -p:OutputPath="$buildOutputDirectory\" `
    --nologo
if ($LASTEXITCODE -ne 0) {
    throw "MSI build failed with exit code $LASTEXITCODE."
}

if (-not (Test-Path -LiteralPath $builtMsi -PathType Leaf)) {
    throw "Expected MSI was not produced: $builtMsi"
}

if (Test-Path -LiteralPath $expectedMsi) {
    Remove-Item -LiteralPath $expectedMsi -Force
}

Move-Item -LiteralPath $builtMsi -Destination $expectedMsi -Force
Remove-Item -LiteralPath $buildOutputDirectory -Recurse -Force

$msi = Get-Item -LiteralPath $expectedMsi
Write-Host ("Created {0} ({1:N0} bytes)." -f $msi.FullName, $msi.Length)
