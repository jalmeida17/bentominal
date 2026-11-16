//! Sauvegarde sur disque : l'état de l'interface (projets, onglets, panneaux)
//! dans `state.json`, et le contenu affiché de chaque panneau dans
//! `scrollback/<id>.txt`.
//!
//! Dossier : `%APPDATA%\<identifiant>`, ou `BENTOMINAL_DATA_DIR` s'il est
//! défini (tests).

use std::fs;
use std::io::Write;
use std::path::{Path, PathBuf};

use tauri::{AppHandle, Manager};

const STATE_FILE: &str = "state.json";
const SCROLLBACK_DIR: &str = "scrollback";

fn data_dir(app: &AppHandle) -> Result<PathBuf, String> {
    let dir = match std::env::var_os("BENTOMINAL_DATA_DIR") {
        Some(dir) => PathBuf::from(dir),
        None => app.path().app_data_dir().map_err(|e| e.to_string())?,
    };
    fs::create_dir_all(&dir).map_err(|e| e.to_string())?;
    Ok(dir)
}

/// Les identifiants viennent du front : on n'accepte que [A-Za-z0-9_-].
fn check_id(id: &str) -> Result<(), String> {
    let ok = !id.is_empty()
        && id.len() <= 64
        && id.chars().all(|c| c.is_ascii_alphanumeric() || c == '-' || c == '_');
    if ok { Ok(()) } else { Err(format!("identifiant invalide : {id:?}")) }
}

/// Écrit dans un fichier temporaire puis le renomme : un arrêt brutal ne
/// laisse jamais un fichier à moitié écrit.
fn write_atomic(path: &Path, data: &[u8]) -> std::io::Result<()> {
    let tmp = path.with_extension("tmp");
    {
        let mut file = fs::File::create(&tmp)?;
        file.write_all(data)?;
        file.sync_all()?;
    }
    fs::rename(&tmp, path)
}

fn read_optional(path: &Path) -> Result<Option<String>, String> {
    match fs::read_to_string(path) {
        Ok(text) => Ok(Some(text)),
        Err(e) if e.kind() == std::io::ErrorKind::NotFound => Ok(None),
        Err(e) => Err(e.to_string()),
    }
}

fn scrollback_path(dir: &Path, id: &str) -> PathBuf {
    dir.join(SCROLLBACK_DIR).join(format!("{id}.txt"))
}

fn save_state_in(dir: &Path, json: &str) -> Result<(), String> {
    let path = dir.join(STATE_FILE);
    // Garde la version précédente : si l'état courant est illisible, le front
    // peut repartir de celle-ci.
    if path.exists() {
        let _ = fs::copy(&path, dir.join("state.prev.json"));
    }
    write_atomic(&path, json.as_bytes()).map_err(|e| e.to_string())
}

fn prune_scrollbacks_in(dir: &Path, keep: &[String]) -> Result<(), String> {
    let Ok(entries) = fs::read_dir(dir.join(SCROLLBACK_DIR)) else {
        return Ok(());
    };
    for entry in entries.flatten() {
        let path = entry.path();
        let stem = path.file_stem().and_then(|s| s.to_str()).unwrap_or_default();
        if path.extension().is_some_and(|ext| ext == "txt") && !keep.iter().any(|k| k == stem) {
            let _ = fs::remove_file(&path);
        }
    }
    Ok(())
}

#[tauri::command]
pub async fn storage_load_state(app: AppHandle) -> Result<Option<String>, String> {
    read_optional(&data_dir(&app)?.join(STATE_FILE))
}

#[tauri::command]
pub async fn storage_load_previous_state(app: AppHandle) -> Result<Option<String>, String> {
    read_optional(&data_dir(&app)?.join("state.prev.json"))
}

#[tauri::command]
pub async fn storage_save_state(app: AppHandle, json: String) -> Result<(), String> {
    save_state_in(&data_dir(&app)?, &json)
}

#[tauri::command]
pub async fn storage_load_scrollback(app: AppHandle, id: String) -> Result<Option<String>, String> {
    check_id(&id)?;
    read_optional(&scrollback_path(&data_dir(&app)?, &id))
}

#[tauri::command]
pub async fn storage_save_scrollback(app: AppHandle, id: String, data: String) -> Result<(), String> {
    check_id(&id)?;
    let dir = data_dir(&app)?;
    fs::create_dir_all(dir.join(SCROLLBACK_DIR)).map_err(|e| e.to_string())?;
    write_atomic(&scrollback_path(&dir, &id), data.as_bytes()).map_err(|e| e.to_string())
}

/// Supprime le contenu sauvegardé des panneaux qui n'existent plus.
#[tauri::command]
pub async fn storage_prune_scrollbacks(app: AppHandle, keep: Vec<String>) -> Result<(), String> {
    prune_scrollbacks_in(&data_dir(&app)?, &keep)
}

#[cfg(test)]
mod tests {
    use super::*;

    fn temp_dir(name: &str) -> PathBuf {
        let dir = std::env::temp_dir().join(format!("bentominal-test-{name}-{}", std::process::id()));
        let _ = fs::remove_dir_all(&dir);
        fs::create_dir_all(&dir).unwrap();
        dir
    }

    #[test]
    fn rejects_path_traversal_ids() {
        assert!(check_id("pane-1_A").is_ok());
        assert!(check_id("../state").is_err());
        assert!(check_id("a\\b").is_err());
        assert!(check_id("").is_err());
    }

    #[test]
    fn state_save_keeps_previous_version() {
        let dir = temp_dir("state");
        save_state_in(&dir, "{\"v\":1}").unwrap();
        save_state_in(&dir, "{\"v\":2}").unwrap();
        assert_eq!(fs::read_to_string(dir.join(STATE_FILE)).unwrap(), "{\"v\":2}");
        assert_eq!(fs::read_to_string(dir.join("state.prev.json")).unwrap(), "{\"v\":1}");
        assert!(!dir.join("state.tmp").exists());
        let _ = fs::remove_dir_all(&dir);
    }

    #[test]
    fn prune_removes_only_unknown_panes() {
        let dir = temp_dir("prune");
        fs::create_dir_all(dir.join(SCROLLBACK_DIR)).unwrap();
        for id in ["keep", "drop"] {
            fs::write(scrollback_path(&dir, id), "x").unwrap();
        }
        prune_scrollbacks_in(&dir, &["keep".to_string()]).unwrap();
        assert!(scrollback_path(&dir, "keep").exists());
        assert!(!scrollback_path(&dir, "drop").exists());
        let _ = fs::remove_dir_all(&dir);
    }
}
