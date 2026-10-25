$ErrorActionPreference = 'Stop'
$appRoot = Split-Path -Parent $PSScriptRoot
$compiler = Join-Path $env:WINDIR 'Microsoft.NET/Framework64/v4.0.30319/csc.exe'
$outputPath = Join-Path (Split-Path -Parent $appRoot) 'ThingsBook-1.1.1.exe'
$sourcePath = Join-Path $PSScriptRoot 'Program.cs'
$indexPath = Join-Path $appRoot 'index.html'
$stylePath = Join-Path $appRoot 'style.css'
$scriptPath = Join-Path $appRoot 'app.js'
$iconPath = Join-Path $PSScriptRoot 'icon.ico'
$arguments = @('/nologo','/target:winexe','/platform:anycpu','/optimize+', ('/out:"'+$outputPath+'"'),('/win32icon:"'+$iconPath+'"'),'/reference:System.Windows.Forms.dll','/reference:System.Drawing.dll')
$webFiles = @('index.html','style.css','app.js','reader.js','reader.css','pdf.worker.mjs') | ForEach-Object { Get-Item -LiteralPath (Join-Path $appRoot $_) }
foreach ($folder in @('vendor','cmaps','standard_fonts','wasm')) { $webFiles += Get-ChildItem -LiteralPath (Join-Path $appRoot $folder) -File -Recurse }
foreach ($asset in $webFiles) {
    $relative = $asset.FullName.Substring($appRoot.Length+1).Replace('\','~')
    $arguments += '/resource:"'+$asset.FullName+'",thingsbook~'+$relative
}
$arguments += '"'+$sourcePath+'"'
$responsePath = Join-Path $PSScriptRoot 'compiler.rsp'
[System.IO.File]::WriteAllLines($responsePath,$arguments)
& $compiler ("@"+$responsePath)
Remove-Item -LiteralPath $responsePath
if ($LASTEXITCODE) { throw 'Windows compilation failed.' }
Write-Output "Windows application: $outputPath"
