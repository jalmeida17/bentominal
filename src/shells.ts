import { invoke } from "@tauri-apps/api/core";

export interface ShellInfo {
  /** "pwsh", "powershell", "cmd" ou "wsl:<distribution>". */
  id: string;
  label: string;
}

let cache: Promise<ShellInfo[]> | undefined;

/** Shells disponibles sur ce poste ; le premier est le shell par défaut. */
export function listShells(): Promise<ShellInfo[]> {
  cache ??= invoke<ShellInfo[]>("list_shells").catch(() => [
    { id: "powershell", label: "Windows PowerShell" },
  ]);
  return cache;
}

export async function shellLabel(id: string | undefined): Promise<string> {
  const shells = await listShells();
  const shell = shells.find((s) => s.id === id) ?? (id ? undefined : shells[0]);
  return shell?.label ?? id ?? "Shell";
}
