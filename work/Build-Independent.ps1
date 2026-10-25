$ErrorActionPreference='Stop'
$taskRoot=Split-Path -Parent $PSScriptRoot
$desktopRoot=Join-Path $PSScriptRoot 'thingsbook-desktop'
$nativeCore=Join-Path $taskRoot 'core/target/release/thingsbook-core.exe'
if(!(Test-Path -LiteralPath $nativeCore)){throw 'Build the verified native core before packaging Windows.'}
Copy-Item -LiteralPath $nativeCore -Destination (Join-Path $desktopRoot 'native/thingsbook-core.exe') -Force
python (Join-Path $PSScriptRoot 'prepare-independent.py')
if($LASTEXITCODE){throw 'Preparing the desktop reader failed.'}
$compiler=Join-Path $env:WINDIR 'Microsoft.NET/Framework64/v4.0.30319/csc.exe'
$speechDll=Get-ChildItem (Join-Path $env:WINDIR 'Microsoft.NET/assembly/GAC_MSIL/System.Speech') -Recurse -Filter System.Speech.dll | Select-Object -First 1 -ExpandProperty FullName
& $compiler /nologo /target:exe /optimize+ /reference:System.Web.Extensions.dll ("/reference:"+$speechDll) ("/out:"+(Join-Path $desktopRoot 'native/SpeechBridge.exe')) (Join-Path $desktopRoot 'native/SpeechBridge.cs')
if($LASTEXITCODE){throw 'The Windows voice helper failed to compile.'}
python (Join-Path $PSScriptRoot 'package-independent.py')
if($LASTEXITCODE){throw 'Bundling the independent runtime failed.'}
$version=(Get-Content -LiteralPath (Join-Path $desktopRoot 'package.json') -Raw | ConvertFrom-Json).version
$output=Join-Path $taskRoot "outputs/ThingsBook-Independent-$version.exe"
& $compiler /nologo /target:winexe /platform:anycpu /optimize+ /reference:System.Windows.Forms.dll /reference:System.Drawing.dll /reference:System.IO.Compression.dll /reference:System.IO.Compression.FileSystem.dll ("/out:"+$output) ("/win32icon:"+(Join-Path $desktopRoot 'icon.ico')) ("/resource:"+(Join-Path $PSScriptRoot 'thingsbook-independent-runtime.zip')+",thingsbook.runtime.zip") (Join-Path $desktopRoot 'native/IndependentLauncher.cs')
if($LASTEXITCODE){throw 'The independent Windows EXE failed to compile.'}
Write-Output "Independent Windows EXE: $output"
