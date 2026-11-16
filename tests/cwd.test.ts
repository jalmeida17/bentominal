import { test } from "node:test";
import assert from "node:assert/strict";
import { cwdFromOsc7, cwdFromOsc9, cwdFromPrompt } from "../src/cwd.ts";

test("invite PowerShell", () => {
  assert.equal(cwdFromPrompt("PS C:\\dev\\hermes> npm run dev", "powershell"), "C:\\dev\\hermes");
  assert.equal(cwdFromPrompt("PS C:\\> ", "pwsh"), "C:\\");
  assert.equal(cwdFromPrompt("PS \\\\srv\\partage\\x> ", undefined), "\\\\srv\\partage\\x");
  assert.equal(cwdFromPrompt("Path : C:\\x", "powershell"), undefined);
});

test("invite cmd", () => {
  assert.equal(cwdFromPrompt("C:\\Users\\jo>dir", "cmd"), "C:\\Users\\jo");
  assert.equal(cwdFromPrompt("C:\\>", "cmd"), "C:\\");
  assert.equal(cwdFromPrompt("Microsoft Windows [version 10.0]", "cmd"), undefined);
});

test("invite bash dans WSL", () => {
  assert.equal(cwdFromPrompt("jo@pc:~/dev/hermes$ ls", "wsl:Ubuntu"), "/home/jo/dev/hermes");
  assert.equal(cwdFromPrompt("jo@pc:~$ ", "wsl:Ubuntu"), "/home/jo");
  assert.equal(cwdFromPrompt("root@pc:~# ", "wsl:Ubuntu"), "/root");
  assert.equal(cwdFromPrompt("(venv) jo@pc:/mnt/c/dev$ ", "wsl:Ubuntu"), "/mnt/c/dev");
  assert.equal(cwdFromPrompt("total 12", "wsl:Ubuntu"), undefined);
});

test("séquences OSC 7 et 9;9", () => {
  assert.equal(cwdFromOsc7("file://pc/home/jo/dev"), "/home/jo/dev");
  assert.equal(cwdFromOsc7("file://pc/C:/dev/mon%20projet"), "C:\\dev\\mon projet");
  assert.equal(cwdFromOsc7("pas une url"), undefined);
  assert.equal(cwdFromOsc9('9;"C:\\dev\\x"'), "C:\\dev\\x");
  assert.equal(cwdFromOsc9("4;1;50"), undefined);
});
