# Lance l'appli en développement dans un processus détaché, console cachée,
# avec le débogage WebView2 ouvert sur le port 9333 (voir scripts/cdp.mjs)
# et un journal sans couleurs dans dev.log.
#
# Pourquoi détaché : lancée depuis un autre terminal (par exemple une session
# Claude Code), l'appli partagerait sa console.
#
# Arrêter : fermer la fenêtre de l'appli, ou scripts/dev-stop.ps1.
$root = Resolve-Path (Join-Path $PSScriptRoot "..")
$log = Join-Path $root "dev.log"

Get-Process bentominal -ErrorAction SilentlyContinue | Stop-Process -Force

$command = @"
`$env:WEBVIEW2_ADDITIONAL_BROWSER_ARGUMENTS = '--remote-debugging-port=9333'
`$env:CARGO_TERM_COLOR = 'never'
`$env:NO_COLOR = '1'
Set-Location '$root'
npm run tauri dev *> '$log'
"@

Start-Process powershell.exe -ArgumentList "-NoProfile", "-Command", $command -WindowStyle Hidden
Write-Output "Lancé. Journal : $log"
