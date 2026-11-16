mod pty;
mod shells;
mod storage;

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    tauri::Builder::default()
        .manage(pty::PtyState::default())
        .invoke_handler(tauri::generate_handler![
            pty::pty_spawn,
            pty::pty_write,
            pty::pty_resize,
            pty::pty_kill,
            pty::pty_kill_all,
            shells::list_shells,
            storage::storage_load_state,
            storage::storage_load_previous_state,
            storage::storage_save_state,
            storage::storage_load_scrollback,
            storage::storage_save_scrollback,
            storage::storage_prune_scrollbacks,
        ])
        .run(tauri::generate_context!())
        .expect("error while running tauri application");
}
