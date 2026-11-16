// Disposition des panneaux d'un onglet : un arbre de découpes.
// Fonctions pures (aucun accès au DOM), testées par tests/layout-tree.test.ts.

/** "row" : côte à côte ; "column" : l'un au-dessus de l'autre. */
export type Direction = "row" | "column";

export type LayoutNode =
  | { kind: "pane"; id: string }
  | { kind: "split"; dir: Direction; children: LayoutNode[]; sizes: number[] };

export function pane(id: string): LayoutNode {
  return { kind: "pane", id };
}

/** Identifiants des panneaux, dans l'ordre de lecture (gauche à droite, haut en bas). */
export function paneIds(node: LayoutNode): string[] {
  return node.kind === "pane" ? [node.id] : node.children.flatMap(paneIds);
}

function normalizeSizes(sizes: number[]): number[] {
  const clean = sizes.map((s) => (Number.isFinite(s) && s > 0 ? s : 1));
  const total = clean.reduce((a, b) => a + b, 0);
  return clean.map((s) => s / total);
}

/**
 * Coupe le panneau `targetId` en deux et place `newId` après lui (à droite
 * pour "row", en dessous pour "column"). Renvoie un nouvel arbre.
 */
export function splitPane(root: LayoutNode, targetId: string, newId: string, dir: Direction): LayoutNode {
  if (root.kind === "pane") {
    return root.id === targetId
      ? { kind: "split", dir, children: [root, pane(newId)], sizes: [0.5, 0.5] }
      : root;
  }
  const index = root.children.findIndex((c) => c.kind === "pane" && c.id === targetId);
  if (index >= 0 && root.dir === dir) {
    // Même direction : le nouveau panneau prend la moitié de la place de la cible.
    const half = root.sizes[index] / 2;
    const children = [...root.children];
    const sizes = [...root.sizes];
    children.splice(index + 1, 0, pane(newId));
    sizes.splice(index, 1, half, half);
    return { ...root, children, sizes };
  }
  return { ...root, children: root.children.map((c) => splitPane(c, targetId, newId, dir)) };
}

/**
 * Retire un panneau. Sa place va à ses voisins ; une découpe qui ne garde
 * qu'un enfant disparaît. Renvoie `null` si l'arbre devient vide.
 */
export function removePane(root: LayoutNode, targetId: string): LayoutNode | null {
  if (root.kind === "pane") return root.id === targetId ? null : root;

  const children: LayoutNode[] = [];
  const sizes: number[] = [];
  root.children.forEach((child, i) => {
    const kept = removePane(child, targetId);
    if (kept) {
      children.push(kept);
      sizes.push(root.sizes[i]);
    }
  });
  if (children.length === 0) return null;
  if (children.length === 1) return children[0];
  return { ...root, children, sizes: normalizeSizes(sizes) };
}

/**
 * Vérifie et répare un arbre lu sur disque : découpes vides ou à un enfant,
 * tailles manquantes, doublons. Renvoie `null` s'il n'en reste rien.
 */
export function sanitizeLayout(value: unknown, seen: Set<string> = new Set()): LayoutNode | null {
  if (!value || typeof value !== "object") return null;
  const node = value as Record<string, unknown>;

  if (node.kind === "pane") {
    if (typeof node.id !== "string" || !node.id || seen.has(node.id)) return null;
    seen.add(node.id);
    return pane(node.id);
  }
  if (node.kind === "split" && Array.isArray(node.children)) {
    const dir: Direction = node.dir === "column" ? "column" : "row";
    const rawSizes = Array.isArray(node.sizes) ? (node.sizes as unknown[]) : [];
    const children: LayoutNode[] = [];
    const sizes: number[] = [];
    node.children.forEach((child, i) => {
      const clean = sanitizeLayout(child, seen);
      if (clean) {
        children.push(clean);
        sizes.push(typeof rawSizes[i] === "number" ? (rawSizes[i] as number) : 1);
      }
    });
    if (children.length === 0) return null;
    if (children.length === 1) return children[0];
    return { kind: "split", dir, children, sizes: normalizeSizes(sizes) };
  }
  return null;
}
