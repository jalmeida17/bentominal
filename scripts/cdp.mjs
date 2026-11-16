// Pilote la fenêtre Bentominal par le protocole de débogage de WebView2.
//
// Lancer l'appli avec le débogage ouvert :
//   $env:WEBVIEW2_ADDITIONAL_BROWSER_ARGUMENTS = "--remote-debugging-port=9333"
//   npm run tauri dev
//
// Puis :
//   node scripts/cdp.mjs eval "<expression JS>"
//   node scripts/cdp.mjs screenshot <fichier.png>
//   node scripts/cdp.mjs wait "<expression JS>" [délai en ms]   (attend qu'elle soit vraie)
//   node scripts/cdp.mjs send <Méthode CDP> '<paramètres JSON>'  (ex. Input.dispatchKeyEvent)

import { writeFileSync } from "node:fs";

const port = process.env.CDP_PORT ?? "9333";
const [command, arg, extra] = process.argv.slice(2);

const targets = await (await fetch(`http://127.0.0.1:${port}/json`)).json();
const page = targets.find((t) => t.type === "page");
if (!page) throw new Error("Aucune page trouvée : l'appli tourne-t-elle avec le débogage ouvert ?");

const ws = new WebSocket(page.webSocketDebuggerUrl);
await new Promise((resolve, reject) => {
  ws.onopen = resolve;
  ws.onerror = reject;
});

let nextId = 0;
const pending = new Map();
ws.onmessage = (event) => {
  const msg = JSON.parse(event.data);
  if (msg.id && pending.has(msg.id)) {
    pending.get(msg.id)(msg);
    pending.delete(msg.id);
  }
};
const send = (method, params = {}) =>
  new Promise((resolve) => {
    const id = ++nextId;
    pending.set(id, resolve);
    ws.send(JSON.stringify({ id, method, params }));
  });

async function evaluate(expression) {
  const res = await send("Runtime.evaluate", { expression, awaitPromise: true, returnByValue: true });
  if (res.result?.exceptionDetails) {
    throw new Error(res.result.exceptionDetails.exception?.description ?? "erreur JS");
  }
  return res.result?.result?.value;
}

try {
  if (command === "eval") {
    const value = await evaluate(arg);
    console.log(typeof value === "string" ? value : JSON.stringify(value, null, 2));
  } else if (command === "wait") {
    const deadline = Date.now() + Number(extra ?? 15000);
    let ok = false;
    while (Date.now() < deadline && !(ok = Boolean(await evaluate(arg)))) {
      await new Promise((r) => setTimeout(r, 200));
    }
    console.log(ok ? "ok" : "délai dépassé");
    process.exitCode = ok ? 0 : 1;
  } else if (command === "send") {
    const res = await send(arg, extra ? JSON.parse(extra) : {});
    if (res.error) throw new Error(res.error.message);
    console.log(JSON.stringify(res.result ?? {}));
  } else if (command === "screenshot") {
    const res = await send("Page.captureScreenshot", { format: "png" });
    writeFileSync(arg, Buffer.from(res.result.data, "base64"));
    console.log(arg);
  } else {
    console.error("Commandes : eval, wait, screenshot");
    process.exitCode = 2;
  }
} finally {
  ws.close();
}
