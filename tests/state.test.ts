import { test } from "node:test";
import assert from "node:assert/strict";
import { allPaneIds, COLORS, defaultState, nextColor, sanitizeState } from "../src/state.ts";

let n = 0;
const newId = () => `id${++n}`;

test("l'état par défaut a un projet, un onglet et un panneau", () => {
  const s = defaultState(newId);
  assert.equal(s.projects.length, 1);
  const p = s.projects[0];
  assert.equal(s.activeProjectId, p.id);
  assert.equal(p.tabs.length, 1);
  assert.equal(p.activeTabId, p.tabs[0].id);
  assert.equal(allPaneIds(s).length, 1);
  assert.equal(p.tabs[0].activePaneId, allPaneIds(s)[0]);
});

test("un état sauvegardé puis relu est identique", () => {
  const s = defaultState(newId);
  s.projects[0].folder = "C:\\dev\\x";
  s.projects[0].tabs[0].color = "#9ece6a";
  assert.deepEqual(sanitizeState(JSON.parse(JSON.stringify(s))), s);
});

test("un état abîmé est réparé", () => {
  const raw = {
    projects: [
      { id: "p1", name: "", color: "rouge", tabs: [] },
      {
        id: "p2",
        name: "Hermes",
        color: "#f7768e",
        activeTabId: "absent",
        tabs: [
          { id: "t1", name: "API", layout: { kind: "pane", id: "x" }, panes: { x: { shell: 42, cwd: "C:\\" } } },
          { id: "t2", layout: { kind: "pane", id: "x" } },
        ],
      },
    ],
    activeProjectId: "p1",
  };
  const s = sanitizeState(raw)!;
  assert.equal(s.projects.length, 1, "le projet sans onglet est écarté");
  const p = s.projects[0];
  assert.equal(s.activeProjectId, "p2");
  assert.equal(p.activeTabId, "t1");
  assert.equal(p.tabs.length, 1, "l'onglet qui réutilise un panneau existant est écarté");
  assert.deepEqual(p.tabs[0].panes.x, { id: "x", cwd: "C:\\" });
  assert.equal(p.tabs[0].activePaneId, "x");
});

test("rien de récupérable donne null", () => {
  assert.equal(sanitizeState(null), null);
  assert.equal(sanitizeState({ projects: [] }), null);
  assert.equal(sanitizeState("{}"), null);
});

test("la couleur suivante évite celles déjà prises", () => {
  assert.equal(nextColor([]), COLORS[0].value);
  assert.equal(nextColor([COLORS[0].value]), COLORS[1].value);
  assert.ok(nextColor(COLORS.map((c) => c.value)));
});
