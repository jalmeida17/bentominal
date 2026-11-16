// Dossier courant d'un shell, sans modifier le shell : on lit son invite
// (« PS C:\x> », « C:\x> », « user@host:~/x$ »), ou les séquences OSC 7 /
// OSC 9;9 qu'émettent certains prompts (oh-my-posh, starship…).
// Fonctions pures, testées par tests/cwd.test.ts.

const PS_PROMPT = /^PS ((?:[A-Za-z]:|\\\\)[^>]*)>/;
const CMD_PROMPT = /^((?:[A-Za-z]:\\|\\\\)[^>]*)>/;
// Invite bash par défaut d'Ubuntu, éventuellement précédée de « (venv) ».
const BASH_PROMPT = /^(?:\([^)]*\) )?([\w.-]+)@[\w.-]+:([~/][^$#]*)[$#]/;

/** Dossier lu dans une ligne d'invite, ou `undefined` si la ligne n'en est pas une. */
export function cwdFromPrompt(line: string, shell: string | undefined): string | undefined {
  if (shell?.startsWith("wsl:")) {
    const m = line.match(BASH_PROMPT);
    if (!m) return undefined;
    const [, user, path] = m;
    const home = user === "root" ? "/root" : `/home/${user}`;
    return path === "~" ? home : path.startsWith("~/") ? home + path.slice(1) : path;
  }
  return line.match(shell === "cmd" ? CMD_PROMPT : PS_PROMPT)?.[1];
}

/** OSC 7 : « file://hôte/chemin » ; sous Windows « file://hôte/C:/chemin ». */
export function cwdFromOsc7(data: string): string | undefined {
  const m = data.trim().match(/^file:\/\/[^/]*(\/.*)$/);
  if (!m) return undefined;
  let path: string;
  try {
    path = decodeURIComponent(m[1]);
  } catch {
    return undefined;
  }
  return /^\/[A-Za-z]:/.test(path) ? path.slice(1).replace(/\//g, "\\") : path;
}

/** OSC 9;9 (convention de Windows Terminal) : « 9;"C:\chemin" ». */
export function cwdFromOsc9(data: string): string | undefined {
  if (!data.startsWith("9;")) return undefined;
  const path = data.slice(2).replace(/^"(.*)"$/, "$1");
  return path || undefined;
}
