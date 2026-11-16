# Arrête l'appli lancée par dev-bg.ps1 : quand l'appli se ferme, `tauri dev`
# s'arrête et coupe Vite. Vite est aussi arrêté ici au cas où il resterait seul.
Get-Process bentominal -ErrorAction SilentlyContinue | Stop-Process -Force
Get-NetTCPConnection -LocalPort 1420 -State Listen -ErrorAction SilentlyContinue |
  ForEach-Object { Stop-Process -Id $_.OwningProcess -Force -ErrorAction SilentlyContinue }
Write-Output "Arrêté."
