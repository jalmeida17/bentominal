# Bentominal

Terminal organisé par projets : chaque projet a ses onglets, découpés en panneaux (PowerShell, cmd ou WSL), et tout est retrouvé à la réouverture.

Tauri 2 (cœur Rust, affichage WebView2), xterm.js pour le terminal, portable-pty pour les shells (ConPTY).

## Lancer en développement

```powershell
npm install
npm run tauri dev
```

## Tests

```powershell
cd src-tauri
cargo test --lib
```

Le test lance un vrai PowerShell dans une pseudo-console.

## Organisation

- `src-tauri/src/pty.rs` : un shell par panneau (lancement, écriture, redimensionnement, arrêt). Les octets du shell partent tels quels vers le front par un `Channel`.
- `src/terminal-pane.ts` : un panneau xterm.js relié à son shell. Son élément peut être déplacé dans la page sans recréer le terminal.

## À savoir

ConPTY demande la position du curseur (`ESC[6n`) au démarrage du shell et n'affiche rien avant la réponse. xterm.js répond tout seul ; le panneau garde donc les frappes pendant le lancement et les envoie dès que le shell est prêt.
