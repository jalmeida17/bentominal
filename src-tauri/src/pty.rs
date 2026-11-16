//! Pseudo-terminaux : un shell (PowerShell, cmd ou WSL) par panneau.
//!
//! Le front donne à chaque panneau un identifiant. Les octets produits par le
//! shell partent tels quels vers le front par un `Channel` (pas de conversion
//! UTF-8 ici : xterm.js décode lui-même, y compris les caractères coupés entre
//! deux lectures).

use std::collections::HashMap;
use std::io::{Read, Write};
use std::path::Path;
use std::sync::atomic::{AtomicU64, Ordering};
use std::sync::{Arc, Mutex, MutexGuard};
use std::thread;

use portable_pty::{native_pty_system, ChildKiller, CommandBuilder, MasterPty, PtySize};
use serde::{Deserialize, Serialize};
use tauri::ipc::{Channel, InvokeResponseBody};
use tauri::State;

struct Session {
    /// Distingue deux lancements successifs sous le même identifiant.
    generation: u64,
    master: Mutex<Box<dyn MasterPty + Send>>,
    writer: Mutex<Box<dyn Write + Send>>,
    killer: Mutex<Box<dyn ChildKiller + Send + Sync>>,
}

#[derive(Default)]
pub struct PtyState {
    sessions: Arc<Mutex<HashMap<String, Arc<Session>>>>,
    next_generation: AtomicU64,
}

impl PtyState {
    fn get(&self, id: &str) -> Result<Arc<Session>, String> {
        lock(&self.sessions)
            .get(id)
            .cloned()
            .ok_or_else(|| format!("terminal inconnu : {id}"))
    }
}

/// Un verrou empoisonné (panique dans un autre thread) reste utilisable ici :
/// les données protégées ne peuvent pas être laissées dans un état incohérent.
fn lock<T: ?Sized>(m: &Mutex<T>) -> MutexGuard<'_, T> {
    m.lock().unwrap_or_else(|poisoned| poisoned.into_inner())
}

#[derive(Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct SpawnOptions {
    id: String,
    /// "powershell" (défaut), "pwsh", "cmd" ou "wsl:<distribution>".
    shell: Option<String>,
    cwd: Option<String>,
    cols: u16,
    rows: u16,
}

#[derive(Clone, Serialize)]
pub struct ExitInfo {
    code: Option<u32>,
}

fn pty_size(cols: u16, rows: u16) -> PtySize {
    PtySize {
        rows: rows.max(1),
        cols: cols.max(1),
        pixel_width: 0,
        pixel_height: 0,
    }
}

fn home_dir() -> String {
    std::env::var("USERPROFILE").unwrap_or_else(|_| "C:\\".into())
}

fn build_command(shell: Option<&str>, cwd: Option<&str>) -> CommandBuilder {
    let shell = shell.unwrap_or("powershell");
    let wsl_distro = shell.strip_prefix("wsl:");

    let mut cmd = match (shell, wsl_distro) {
        (_, Some(distro)) => {
            let mut c = CommandBuilder::new("wsl.exe");
            if !distro.is_empty() {
                c.args(["-d", distro]);
            }
            c
        }
        ("cmd", _) => CommandBuilder::new("cmd.exe"),
        ("pwsh", _) => {
            let mut c = CommandBuilder::new("pwsh.exe");
            c.arg("-NoLogo");
            c
        }
        _ => {
            let mut c = CommandBuilder::new("powershell.exe");
            c.arg("-NoLogo");
            c
        }
    };

    match cwd {
        // Chemin Linux : c'est WSL qui s'y place.
        Some(dir) if wsl_distro.is_some() && (dir.starts_with('/') || dir.starts_with('~')) => {
            cmd.args(["--cd", dir]);
            cmd.cwd(home_dir());
        }
        Some(dir) if Path::new(dir).is_dir() => cmd.cwd(dir),
        _ => cmd.cwd(home_dir()),
    }

    cmd.env("TERM", "xterm-256color");
    cmd.env("COLORTERM", "truecolor");
    cmd.env("TERM_PROGRAM", "Bentominal");
    cmd
}

#[tauri::command]
pub async fn pty_spawn(
    state: State<'_, PtyState>,
    opts: SpawnOptions,
    on_data: Channel<InvokeResponseBody>,
    on_exit: Channel<ExitInfo>,
) -> Result<(), String> {
    let pair = native_pty_system()
        .openpty(pty_size(opts.cols, opts.rows))
        .map_err(|e| e.to_string())?;

    let cmd = build_command(opts.shell.as_deref(), opts.cwd.as_deref());
    let mut child = pair.slave.spawn_command(cmd).map_err(|e| e.to_string())?;
    // Sans ce drop, la lecture ne verrait jamais la fin du flux.
    drop(pair.slave);

    let mut reader = pair.master.try_clone_reader().map_err(|e| e.to_string())?;
    let writer = pair.master.take_writer().map_err(|e| e.to_string())?;
    let generation = state.next_generation.fetch_add(1, Ordering::Relaxed);
    let session = Arc::new(Session {
        generation,
        master: Mutex::new(pair.master),
        writer: Mutex::new(writer),
        killer: Mutex::new(child.clone_killer()),
    });

    let previous = lock(&state.sessions).insert(opts.id.clone(), session);
    if let Some(previous) = previous {
        let _ = lock(&previous.killer).kill();
    }

    thread::Builder::new()
        .name(format!("pty-read-{}", opts.id))
        .spawn(move || {
            let mut buf = vec![0u8; 64 * 1024];
            loop {
                match reader.read(&mut buf) {
                    Ok(0) | Err(_) => break,
                    Ok(n) => {
                        if on_data
                            .send(InvokeResponseBody::Raw(buf[..n].to_vec()))
                            .is_err()
                        {
                            break;
                        }
                    }
                }
            }
        })
        .map_err(|e| e.to_string())?;

    let sessions = state.sessions.clone();
    let id = opts.id;
    thread::Builder::new()
        .name(format!("pty-wait-{id}"))
        .spawn(move || {
            let code = child.wait().ok().map(|status| status.exit_code());
            // Retirer la session ferme la pseudo-console, ce qui termine la lecture.
            {
                let mut map = lock(&sessions);
                if map.get(&id).is_some_and(|s| s.generation == generation) {
                    map.remove(&id);
                }
            }
            let _ = on_exit.send(ExitInfo { code });
        })
        .map_err(|e| e.to_string())?;

    Ok(())
}

#[tauri::command]
pub async fn pty_write(state: State<'_, PtyState>, id: String, data: String) -> Result<(), String> {
    let session = state.get(&id)?;
    let mut writer = lock(&session.writer);
    writer
        .write_all(data.as_bytes())
        .and_then(|_| writer.flush())
        .map_err(|e| e.to_string())
}

#[tauri::command]
pub async fn pty_resize(
    state: State<'_, PtyState>,
    id: String,
    cols: u16,
    rows: u16,
) -> Result<(), String> {
    let session = state.get(&id)?;
    let master = lock(&session.master);
    master.resize(pty_size(cols, rows)).map_err(|e| e.to_string())
}

#[tauri::command]
pub async fn pty_kill(state: State<'_, PtyState>, id: String) -> Result<(), String> {
    if let Ok(session) = state.get(&id) {
        let _ = lock(&session.killer).kill();
    }
    Ok(())
}

#[cfg(test)]
mod tests {
    use super::*;
    use std::sync::mpsc;
    use std::time::{Duration, Instant};

    /// Lance PowerShell dans une vraie pseudo-console et vérifie qu'il exécute
    /// une commande. ConPTY demande d'abord la position du curseur (ESC[6n) et
    /// attend la réponse, comme le ferait xterm.js.
    #[test]
    fn powershell_runs_in_a_pty() {
        let pair = native_pty_system().openpty(pty_size(120, 30)).unwrap();
        let mut child = pair
            .slave
            .spawn_command(build_command(Some("powershell"), None))
            .unwrap();
        drop(pair.slave);

        let mut reader = pair.master.try_clone_reader().unwrap();
        let mut writer = pair.master.take_writer().unwrap();
        let (tx, rx) = mpsc::channel::<Vec<u8>>();
        thread::spawn(move || {
            let mut buf = [0u8; 4096];
            while let Ok(n) = reader.read(&mut buf) {
                if n == 0 || tx.send(buf[..n].to_vec()).is_err() {
                    break;
                }
            }
        });

        let mut output = String::new();
        let mut answered_dsr = false;
        let mut sent_command = false;
        let deadline = Instant::now() + Duration::from_secs(60);
        while Instant::now() < deadline && !output.contains("bentominal-ok") {
            if let Ok(chunk) = rx.recv_timeout(Duration::from_millis(200)) {
                output.push_str(&String::from_utf8_lossy(&chunk));
            }
            if !answered_dsr && output.contains("\x1b[6n") {
                writer.write_all(b"\x1b[1;1R").unwrap();
                answered_dsr = true;
            }
            // Le marqueur est construit par PowerShell : on ne lit pas l'écho de la frappe.
            if !sent_command && output.contains("PS ") {
                writer
                    .write_all(b"Write-Output ('bento' + 'minal-ok'); exit 3\r")
                    .unwrap();
                sent_command = true;
            }
        }
        assert!(output.contains("bentominal-ok"), "sortie : {output:?}");

        let status = child.wait().unwrap();
        assert_eq!(status.exit_code(), 3);
        drop(pair.master);
    }
}

/// Appelé au chargement du front : après un rechargement de la page, les
/// shells lancés avant n'ont plus personne pour les afficher.
#[tauri::command]
pub async fn pty_kill_all(state: State<'_, PtyState>) -> Result<(), String> {
    let sessions: Vec<Arc<Session>> = lock(&state.sessions).values().cloned().collect();
    for session in sessions {
        let _ = lock(&session.killer).kill();
    }
    Ok(())
}
