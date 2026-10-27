param(
  [string]$ToolsRoot = 'C:\Users\mwali\Documents\Codex\2026-10-03\https-github-com-louis-cfm-coucou\work\android-tools',
  [string]$BuildRoot = '',
  [string]$SigningRoot = '',
  [string]$Version = '1.14.0',
  [int]$VersionCode = 11205
)
$ErrorActionPreference = 'Stop'
$appRoot = Split-Path -Parent $PSScriptRoot
$outputRoot = Split-Path -Parent $appRoot
$workspaceRoot = Split-Path -Parent $outputRoot
if (!$BuildRoot) { $BuildRoot = Join-Path $workspaceRoot 'work/android-build' }
if (!$SigningRoot) { $SigningRoot = Join-Path $workspaceRoot 'work/thingsbook-signing' }
$jdkRoot = (Get-ChildItem -LiteralPath (Join-Path $ToolsRoot 'jdk') -Directory | Select-Object -First 1).FullName
$env:JAVA_HOME = $jdkRoot
$jdkBin = Join-Path $jdkRoot 'bin'
$buildTools = Join-Path $ToolsRoot 'sdk/build-tools/35.0.0'
$platform = Join-Path $ToolsRoot 'sdk/platforms/android-35/android.jar'
$keystore = Join-Path $SigningRoot 'thingsbook-release.jks'
$passwordFile = Join-Path $SigningRoot 'password.txt'
if (!(Test-Path -LiteralPath $keystore)) { throw 'ThingsBook signing key is missing. Use the original key when updating an installed version.' }
function Check-Step([string]$Name) { if ($LASTEXITCODE) { throw "$Name failed ($LASTEXITCODE)." } }
New-Item -ItemType Directory -Force -Path $BuildRoot,(Join-Path $BuildRoot 'assets/web'),(Join-Path $BuildRoot 'classes'),(Join-Path $BuildRoot 'dex') | Out-Null
foreach ($asset in @('index.html','style.css','app.js','reader.js','reader.css','pdf.worker.mjs','vendor','cmaps','standard_fonts','wasm')) { Copy-Item -LiteralPath (Join-Path $appRoot $asset) -Destination (Join-Path $BuildRoot 'assets/web') -Recurse -Force }
& (Join-Path $buildTools 'aapt2.exe') compile --dir (Join-Path $PSScriptRoot 'res') -o (Join-Path $BuildRoot 'resources.zip')
Check-Step 'Android resources'
& (Join-Path $buildTools 'aapt2.exe') link -o (Join-Path $BuildRoot 'unsigned.apk') --manifest (Join-Path $PSScriptRoot 'AndroidManifest.xml') -I $platform --min-sdk-version 26 --target-sdk-version 35 --version-code $VersionCode --version-name $Version --replace-version (Join-Path $BuildRoot 'resources.zip')
Check-Step 'Android package'
& (Join-Path $jdkBin 'jar.exe') uf (Join-Path $BuildRoot 'unsigned.apk') -C $BuildRoot assets
Check-Step 'Android assets'
$sources = @(Get-ChildItem -LiteralPath (Join-Path $PSScriptRoot 'java/com/thingsbook/library') -Filter '*.java' | ForEach-Object FullName)
& (Join-Path $jdkBin 'javac.exe') -encoding UTF-8 --release 8 -classpath $platform -d (Join-Path $BuildRoot 'classes') @sources
Check-Step 'Android Java'
& (Join-Path $jdkBin 'jar.exe') cf (Join-Path $BuildRoot 'classes.jar') -C (Join-Path $BuildRoot 'classes') .
Check-Step 'Android classes'
& (Join-Path $buildTools 'd8.bat') --release --min-api 26 --lib $platform --output (Join-Path $BuildRoot 'dex') (Join-Path $BuildRoot 'classes.jar')
Check-Step 'Android bytecode'
& (Join-Path $jdkBin 'jar.exe') uf (Join-Path $BuildRoot 'unsigned.apk') -C (Join-Path $BuildRoot 'dex') classes.dex
Check-Step 'Android bytecode packaging'
& (Join-Path $buildTools 'zipalign.exe') -f -p 4 (Join-Path $BuildRoot 'unsigned.apk') (Join-Path $BuildRoot 'aligned.apk')
Check-Step 'Android alignment'
$apk = Join-Path $outputRoot "ThingsBook-Android-$Version.apk"
& (Join-Path $buildTools 'apksigner.bat') sign --ks $keystore --ks-key-alias thingsbook --ks-pass "file:$passwordFile" --out $apk (Join-Path $BuildRoot 'aligned.apk')
Check-Step 'Android signing'
& (Join-Path $buildTools 'apksigner.bat') verify --verbose $apk
Check-Step 'Android signature verification'
Write-Output "Android app: $apk"
