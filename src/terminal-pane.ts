import { Terminal } from "@xterm/xterm";
import { FitAddon } from "@xterm/addon-fit";
import { WebglAddon } from "@xterm/addon-webgl";
import { Channel, invoke } from "@tauri-apps/api/core";

export interface PaneOptions {
  id: string;
  /** "powershell" (défaut), "pwsh", "cmd" ou "wsl:<distribution>". */
  shell?: string;
  cwd?: string;
}

const theme = {
  background: "#16161e",
  foreground: "#c0caf5",
  cursor: "#c0caf5",
  selectionBackground: "#33467c",
  black: "#15161e",
  red: "#f7768e",
  green: "#9ece6a",
  yellow: "#e0af68",
  blue: "#7aa2f7",
  magenta: "#bb9af7",
  cyan: "#7dcfff",
  white: "#a9b1d6",
  brightBlack: "#414868",
  brightRed: "#f7768e",
  brightGreen: "#9ece6a",
  brightYellow: "#e0af68",
  brightBlue: "#7aa2f7",
  brightMagenta: "#bb9af7",
  brightCyan: "#7dcfff",
  brightWhite: "#c0caf5",
};

/**
 * Un panneau : un terminal xterm.js relié à un shell côté Rust.
 *
 * L'élément `element` est créé une fois et peut être déplacé dans le DOM
 * (découpe, changement d'onglet) sans recréer le terminal ni le shell.
 */
export class TerminalPane {
  readonly id: string;
  readonly element: HTMLDivElement;

  private readonly term: Terminal;
  private readonly fit = new FitAddon();
  private readonly resizeObserver: ResizeObserver;
  private opened = false;
  private state: "idle" | "starting" | "running" | "exited" = "idle";
  /** Change à chaque lancement : les messages d'un ancien shell sont ignorés. */
  private launch = 0;

  // File d'écriture : les frappes partent dans l'ordre, une requête à la fois.
  private pendingInput = "";
  private writing = false;

  constructor(private readonly opts: PaneOptions) {
    this.id = opts.id;
    this.element = document.createElement("div");
    this.element.className = "pane-term";

    this.term = new Terminal({
      fontFamily: '"Cascadia Mono", "Cascadia Code", Consolas, monospace',
      fontSize: 14,
      cursorBlink: true,
      scrollback: 10000,
      theme,
      windowsPty: { backend: "conpty", buildNumber: 22000 },
    });
    this.term.loadAddon(this.fit);

    this.term.onData((data) => this.onInput(data));
    this.term.onResize(({ cols, rows }) => {
      if (this.state === "running") {
        invoke("pty_resize", { id: this.id, cols, rows }).catch(() => {});
      }
    });
    this.term.attachCustomKeyEventHandler((e) => this.onKey(e));
    this.element.addEventListener("contextmenu", (e) => {
      e.preventDefault();
      void this.copyOrPaste();
    });

    this.resizeObserver = new ResizeObserver(() => this.refit());
  }

  /** Place le panneau dans `container` ; au premier appel, ouvre le terminal et lance le shell. */
  attach(container: HTMLElement): void {
    container.appendChild(this.element);
    if (!this.opened) {
      this.opened = true;
      this.term.open(this.element);
      this.loadWebgl();
      this.resizeObserver.observe(this.element);
      this.refit();
      void this.start();
    } else {
      this.refit();
    }
  }

  focus(): void {
    this.term.focus();
  }

  /** Envoie du texte au shell comme si on le tapait. */
  input(data: string): void {
    this.onInput(data);
  }

  /** Texte visible à l'écran, ligne par ligne (tests et sauvegarde). */
  screenText(): string {
    const buffer = this.term.buffer.active;
    const lines: string[] = [];
    for (let y = 0; y < this.term.rows; y++) {
      lines.push(buffer.getLine(buffer.viewportY + y)?.translateToString(true) ?? "");
    }
    return lines.join("\n").trimEnd();
  }

  dispose(): void {
    this.resizeObserver.disconnect();
    if (this.state === "starting" || this.state === "running") {
      invoke("pty_kill", { id: this.id }).catch(() => {});
    }
    this.state = "exited";
    this.launch++;
    this.term.dispose();
    this.element.remove();
  }

  private loadWebgl(): void {
    try {
      const webgl = new WebglAddon();
      webgl.onContextLoss(() => webgl.dispose());
      this.term.loadAddon(webgl);
    } catch {
      // Pas de WebGL : xterm garde son rendu DOM.
    }
  }

  private refit(): void {
    // Panneau caché (onglet inactif) : rien à mesurer.
    if (!this.opened || this.element.clientWidth === 0 || this.element.clientHeight === 0) return;
    this.fit.fit();
  }

  private async start(): Promise<void> {
    const launch = ++this.launch;
    this.state = "starting";
    this.pendingInput = "";

    const onData = new Channel<ArrayBuffer>();
    onData.onmessage = (chunk) => {
      if (launch === this.launch) this.term.write(new Uint8Array(chunk));
    };

    const onExit = new Channel<{ code: number | null }>();
    onExit.onmessage = ({ code }) => {
      if (launch !== this.launch) return;
      this.state = "exited";
      this.term.write(
        `\r\n\x1b[90m[processus terminé, code ${code ?? "?"}] Entrée pour relancer\x1b[0m\r\n`,
      );
    };

    const { cols, rows } = this.term;
    try {
      await invoke("pty_spawn", {
        opts: { id: this.id, shell: this.opts.shell, cwd: this.opts.cwd, cols, rows },
        onData,
        onExit,
      });
      // Le shell a pu se terminer (ou être relancé) pendant l'attente.
      if (launch !== this.launch || this.state !== "starting") return;
      this.state = "running";
      if (this.term.cols !== cols || this.term.rows !== rows) {
        invoke("pty_resize", { id: this.id, cols: this.term.cols, rows: this.term.rows }).catch(
          () => {},
        );
      }
      // Envoie ce qui a été tapé pendant le lancement, dont la réponse
      // d'xterm à la demande de position du curseur faite par ConPTY.
      void this.flushInput();
    } catch (err) {
      if (launch !== this.launch) return;
      this.state = "exited";
      this.term.write(
        `\x1b[31mImpossible de lancer le shell : ${err}\x1b[0m\r\n` +
          `\x1b[90mEntrée pour réessayer\x1b[0m\r\n`,
      );
    }
  }

  private onInput(data: string): void {
    if (this.state === "exited") {
      if (data === "\r") void this.start();
      return;
    }
    if (this.state === "idle") return;
    // "starting" : on garde, "running" : on envoie.
    this.pendingInput += data;
    void this.flushInput();
  }

  private async flushInput(): Promise<void> {
    if (this.writing || this.state !== "running") return;
    this.writing = true;
    try {
      while (this.pendingInput && this.state === "running") {
        const data = this.pendingInput;
        this.pendingInput = "";
        await invoke("pty_write", { id: this.id, data }).catch(() => {});
      }
    } finally {
      this.writing = false;
    }
  }

  /** Raccourcis presse-papiers, comme dans Windows Terminal. */
  private onKey(e: KeyboardEvent): boolean {
    if (e.type !== "keydown" || !e.ctrlKey || e.altKey) return true;
    const key = e.key.toLowerCase();

    // Ctrl+C copie s'il y a une sélection, sinon il interrompt (^C).
    if (key === "c" && (e.shiftKey || this.term.hasSelection())) {
      this.copySelection();
      return false;
    }
    // Ctrl+V : on laisse le navigateur coller (le collage passe par xterm).
    if (key === "v") return false;
    return true;
  }

  private copySelection(): void {
    const text = this.term.getSelection();
    if (text) void navigator.clipboard.writeText(text);
    this.term.clearSelection();
  }

  /** Clic droit : copie la sélection, ou colle s'il n'y en a pas. */
  private async copyOrPaste(): Promise<void> {
    if (this.term.hasSelection()) {
      this.copySelection();
    } else {
      try {
        const text = await navigator.clipboard.readText();
        if (text) this.term.paste(text);
      } catch {
        // Lecture du presse-papiers refusée : Ctrl+V reste disponible.
      }
    }
    this.term.focus();
  }
}
