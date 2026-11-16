// Lancer : node --test tests/
import { test } from "node:test";
import assert from "node:assert/strict";
import {
  pane,
  paneIds,
  removePane,
  sanitizeLayout,
  splitPane,
  type LayoutNode,
} from "../src/layout-tree.ts";

test("couper un panneau seul crée une découpe moitié-moitié", () => {
  const tree = splitPane(pane("a"), "a", "b", "row");
  assert.deepEqual(tree, { kind: "split", dir: "row", children: [pane("a"), pane("b")], sizes: [0.5, 0.5] });
});

test("couper dans la même direction partage la place de la cible", () => {
  let tree = splitPane(pane("a"), "a", "b", "row");
  tree = splitPane(tree, "a", "c", "row");
  assert.deepEqual(paneIds(tree), ["a", "c", "b"]);
  assert.deepEqual((tree as Extract<LayoutNode, { kind: "split" }>).sizes, [0.25, 0.25, 0.5]);
});

test("couper dans l'autre direction imbrique une découpe", () => {
  let tree = splitPane(pane("a"), "a", "b", "row");
  tree = splitPane(tree, "b", "c", "column");
  assert.deepEqual(tree, {
    kind: "split",
    dir: "row",
    sizes: [0.5, 0.5],
    children: [pane("a"), { kind: "split", dir: "column", children: [pane("b"), pane("c")], sizes: [0.5, 0.5] }],
  });
});

test("retirer un panneau rend sa place et supprime les découpes à un enfant", () => {
  let tree = splitPane(pane("a"), "a", "b", "row");
  tree = splitPane(tree, "b", "c", "column");
  const after = removePane(tree, "c");
  assert.deepEqual(after, { kind: "split", dir: "row", children: [pane("a"), pane("b")], sizes: [0.5, 0.5] });
  assert.deepEqual(removePane(after!, "a"), pane("b"));
  assert.equal(removePane(pane("x"), "x"), null);
});

test("retirer un panneau au milieu renormalise les tailles", () => {
  const tree: LayoutNode = {
    kind: "split",
    dir: "row",
    children: [pane("a"), pane("b"), pane("c")],
    sizes: [0.5, 0.25, 0.25],
  };
  const after = removePane(tree, "b") as Extract<LayoutNode, { kind: "split" }>;
  assert.deepEqual(paneIds(after), ["a", "c"]);
  assert.ok(Math.abs(after.sizes[0] - 2 / 3) < 1e-9);
  assert.ok(Math.abs(after.sizes[1] - 1 / 3) < 1e-9);
});

test("un arbre abîmé lu sur disque est réparé", () => {
  const raw = {
    kind: "split",
    dir: "sideways",
    sizes: [3],
    children: [
      { kind: "pane", id: "a" },
      { kind: "split", dir: "column", children: [], sizes: [] },
      { kind: "pane", id: "a" },
      { kind: "pane", id: "b" },
      "n'importe quoi",
    ],
  };
  const clean = sanitizeLayout(raw) as Extract<LayoutNode, { kind: "split" }>;
  assert.equal(clean.dir, "row");
  assert.deepEqual(paneIds(clean), ["a", "b"]);
  assert.ok(Math.abs(clean.sizes.reduce((x, y) => x + y, 0) - 1) < 1e-9);
  assert.equal(sanitizeLayout(null), null);
  assert.equal(sanitizeLayout({ kind: "split", children: [] }), null);
});
