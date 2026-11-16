// État de l'interface, sauvegardé dans state.json.
// Fonctions pures, testées par tests/state.test.ts.
import { pane, sanitizeLayout, paneIds, type LayoutNode } from "./layout-tree.ts";

export interface PaneConfig {
  id: string;
  /** "pwsh", "powershell", "cmd" ou "wsl:<distribution>" ; absent : shell par défaut. */
  shell?: string;
  /** Dernier dossier connu du shell. */
  cwd?: string;
}

export interface TabState {
  id: string;
  name: string;
  /** Absente : couleur du projet. */
  color?: string;
  layout: LayoutNode;
  panes: Record<string, PaneConfig>;
  activePaneId: string;
}

export interface ProjectState {
  id: string;
  name: string;
  color: string;
  /** Dossier de départ des nouveaux onglets. */
  folder?: string;
  tabs: TabState[];
  activeTabId: string;
}

export interface AppState {
  version: 1;
  projects: ProjectState[];
  activeProjectId: string;
}

export const COLORS: { name: string; value: string }[] = [
  { name: "Bleu", value: "#7aa2f7" },
  { name: "Vert", value: "#9ece6a" },
  { name: "Jaune", value: "#e0af68" },
  { name: "Orange", value: "#ff9e64" },
  { name: "Rouge", value: "#f7768e" },
  { name: "Rose", value: "#f5a3d6" },
  { name: "Violet", value: "#bb9af7" },
  { name: "Cyan", value: "#7dcfff" },
  { name: "Gris", value: "#a9b1d6" },
];

export type IdFactory = () => string;

export function newTab(newId: IdFactory, name: string, config: Omit<PaneConfig, "id"> = {}): TabState {
  const paneId = newId();
  return {
    id: newId(),
    name,
    layout: pane(paneId),
    panes: { [paneId]: { id: paneId, ...config } },
    activePaneId: paneId,
  };
}

export function newProject(newId: IdFactory, name: string, color: string, folder?: string): ProjectState {
  const tab = newTab(newId, "Terminal", folder ? { cwd: folder } : {});
  return compact({ id: newId(), name, color, folder: folder || undefined, tabs: [tab], activeTabId: tab.id });
}

export function defaultState(newId: IdFactory): AppState {
  const project = newProject(newId, "Mon projet", COLORS[0].value);
  return { version: 1, projects: [project], activeProjectId: project.id };
}

/** Couleur suivante dans la palette, en évitant celles déjà prises si possible. */
export function nextColor(used: string[]): string {
  return COLORS.find((c) => !used.includes(c.value))?.value ?? COLORS[used.length % COLORS.length].value;
}

/** Retire les clés valant `undefined` (un état relu doit être identique à l'original). */
function compact<T extends object>(obj: T): T {
  for (const key of Object.keys(obj) as (keyof T)[]) {
    if (obj[key] === undefined) delete obj[key];
  }
  return obj;
}

const str = (v: unknown): string | undefined => (typeof v === "string" && v.trim() ? v : undefined);
const color = (v: unknown): string | undefined =>
  typeof v === "string" && /^#[0-9a-f]{6}$/i.test(v) ? v : undefined;

function sanitizeTab(raw: unknown, seenPanes: Set<string>): TabState | null {
  if (!raw || typeof raw !== "object") return null;
  const t = raw as Record<string, unknown>;
  const id = str(t.id);
  const layout = sanitizeLayout(t.layout, seenPanes);
  if (!id || !layout) return null;

  const rawPanes = (t.panes && typeof t.panes === "object" ? t.panes : {}) as Record<string, unknown>;
  const panes: Record<string, PaneConfig> = {};
  for (const paneId of paneIds(layout)) {
    const p = (rawPanes[paneId] ?? {}) as Record<string, unknown>;
    panes[paneId] = compact({ id: paneId, shell: str(p.shell), cwd: str(p.cwd) });
  }
  const ids = Object.keys(panes);
  const activePaneId = ids.includes(t.activePaneId as string) ? (t.activePaneId as string) : ids[0];
  return compact({ id, name: str(t.name) ?? "Terminal", color: color(t.color), layout, panes, activePaneId });
}

/**
 * Vérifie un état lu sur disque et répare ce qui peut l'être.
 * Renvoie `null` si rien n'est récupérable.
 */
export function sanitizeState(raw: unknown): AppState | null {
  if (!raw || typeof raw !== "object") return null;
  const s = raw as Record<string, unknown>;
  if (!Array.isArray(s.projects)) return null;

  const seenPanes = new Set<string>();
  const projects: ProjectState[] = [];
  for (const rp of s.projects) {
    if (!rp || typeof rp !== "object") continue;
    const p = rp as Record<string, unknown>;
    const id = str(p.id);
    const tabs = (Array.isArray(p.tabs) ? p.tabs : [])
      .map((t) => sanitizeTab(t, seenPanes))
      .filter((t): t is TabState => t !== null);
    if (!id || tabs.length === 0) continue;
    const activeTabId = tabs.some((t) => t.id === p.activeTabId) ? (p.activeTabId as string) : tabs[0].id;
    projects.push(
      compact({
        id,
        name: str(p.name) ?? "Projet",
        color: color(p.color) ?? COLORS[0].value,
        folder: str(p.folder),
        tabs,
        activeTabId,
      }),
    );
  }
  if (projects.length === 0) return null;
  const activeProjectId = projects.some((p) => p.id === s.activeProjectId)
    ? (s.activeProjectId as string)
    : projects[0].id;
  return { version: 1, projects, activeProjectId };
}

/** Tous les identifiants de panneaux de l'état (pour nettoyer les sauvegardes orphelines). */
export function allPaneIds(state: AppState): string[] {
  return state.projects.flatMap((p) => p.tabs.flatMap((t) => paneIds(t.layout)));
}
