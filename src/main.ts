import "@xterm/xterm/css/xterm.css";
import "./styles.css";
import { invoke } from "@tauri-apps/api/core";
import { TerminalPane } from "./terminal-pane";

async function main(): Promise<void> {
  // Après un rechargement de la page, les anciens shells n'ont plus d'affichage.
  await invoke("pty_kill_all").catch(() => {});

  const app = document.getElementById("app")!;
  const pane = new TerminalPane({ id: crypto.randomUUID() });
  pane.attach(app);
  pane.focus();

  // Accès pour les tests pilotés par scripts/cdp.mjs (développement seulement).
  if (import.meta.env.DEV) {
    (window as unknown as { __bento: unknown }).__bento = { pane };
  }
}

void main();
