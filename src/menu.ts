export interface MenuItem {
  label: string;
  action?: () => void;
  checked?: boolean;
  hint?: string;
}

export type MenuEntry = MenuItem | "separator";

let current: HTMLElement | undefined;

function span(className: string, text: string): HTMLSpanElement {
  const s = document.createElement("span");
  s.className = className;
  s.textContent = text;
  return s;
}

export function closeMenu(): void {
  current?.remove();
  current = undefined;
}

/**
 * Menu contextuel simple, placé sous `anchor` (élément) ou au point donné.
 * Se ferme au clic ailleurs, sur Échap ou après un choix.
 */
export function showMenu(anchor: HTMLElement | { x: number; y: number }, entries: MenuEntry[]): void {
  closeMenu();
  const menu = document.createElement("div");
  menu.className = "menu";
  menu.setAttribute("role", "menu");

  for (const entry of entries) {
    if (entry === "separator") {
      const sep = document.createElement("div");
      sep.className = "menu-sep";
      menu.appendChild(sep);
      continue;
    }
    const item = document.createElement("button");
    item.type = "button";
    item.className = "menu-item";
    item.setAttribute("role", "menuitem");
    item.disabled = !entry.action;
    item.append(
      span("menu-check", entry.checked ? "✓" : ""),
      span("menu-label", entry.label),
      span("menu-hint", entry.hint ?? ""),
    );
    item.addEventListener("click", () => {
      closeMenu();
      entry.action?.();
    });
    menu.appendChild(item);
  }

  document.body.appendChild(menu);
  current = menu;

  const rect =
    anchor instanceof HTMLElement
      ? anchor.getBoundingClientRect()
      : { left: anchor.x, bottom: anchor.y, top: anchor.y };
  const { width, height } = menu.getBoundingClientRect();
  const left = Math.min(rect.left, window.innerWidth - width - 4);
  const top = rect.bottom + height > window.innerHeight ? Math.max(4, rect.top - height) : rect.bottom;
  menu.style.left = `${Math.max(4, left)}px`;
  menu.style.top = `${top}px`;
  (menu.querySelector(".menu-item:not(:disabled)") as HTMLElement | null)?.focus();
}

window.addEventListener(
  "mousedown",
  (e) => {
    if (current && !current.contains(e.target as Node)) closeMenu();
  },
  true,
);
window.addEventListener("keydown", (e) => {
  if (!current) return;
  if (e.key === "Escape") {
    closeMenu();
    e.preventDefault();
  } else if (e.key === "ArrowDown" || e.key === "ArrowUp") {
    const items = [...current.querySelectorAll<HTMLElement>(".menu-item:not(:disabled)")];
    const i = items.indexOf(document.activeElement as HTMLElement);
    const next = e.key === "ArrowDown" ? (i + 1) % items.length : (i - 1 + items.length) % items.length;
    items[next]?.focus();
    e.preventDefault();
  }
});
window.addEventListener("blur", closeMenu);
