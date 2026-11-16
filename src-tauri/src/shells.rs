//! Shells proposés à l'utilisateur : PowerShell, cmd et distributions WSL.

use std::process::Command;

use serde::Serialize;

#[derive(Debug, Clone, Serialize, PartialEq)]
pub struct ShellInfo {
    /// Valeur passée à `pty_spawn` : "pwsh", "powershell", "cmd" ou "wsl:<distribution>".
    pub id: String,
    pub label: String,
}

impl ShellInfo {
    fn new(id: impl Into<String>, label: impl Into<String>) -> Self {
        Self {
            id: id.into(),
            label: label.into(),
        }
    }
}

/// Le premier de la liste sert de shell par défaut.
#[tauri::command]
pub async fn list_shells() -> Vec<ShellInfo> {
    let mut shells = Vec::new();
    if in_path("pwsh.exe") {
        shells.push(ShellInfo::new("pwsh", "PowerShell 7"));
    }
    shells.push(ShellInfo::new("powershell", "Windows PowerShell"));
    shells.push(ShellInfo::new("cmd", "Invite de commandes"));
    for distro in wsl_distros() {
        shells.push(ShellInfo::new(format!("wsl:{distro}"), format!("WSL · {distro}")));
    }
    shells
}

fn in_path(exe: &str) -> bool {
    std::env::var_os("PATH")
        .map(|path| std::env::split_paths(&path).any(|dir| dir.join(exe).is_file()))
        .unwrap_or(false)
}

fn wsl_distros() -> Vec<String> {
    let mut cmd = Command::new("wsl.exe");
    cmd.args(["--list", "--quiet"]).env("WSL_UTF8", "1");
    #[cfg(windows)]
    {
        use std::os::windows::process::CommandExt;
        const CREATE_NO_WINDOW: u32 = 0x0800_0000;
        cmd.creation_flags(CREATE_NO_WINDOW);
    }
    match cmd.output() {
        Ok(out) if out.status.success() => parse_distros(&out.stdout),
        _ => Vec::new(),
    }
}

/// `wsl.exe` écrit en UTF-16LE, sauf les versions récentes quand `WSL_UTF8=1`.
fn decode_wsl_output(bytes: &[u8]) -> String {
    let text = if bytes.contains(&0) {
        let units: Vec<u16> = bytes
            .chunks_exact(2)
            .map(|pair| u16::from_le_bytes([pair[0], pair[1]]))
            .collect();
        String::from_utf16_lossy(&units)
    } else {
        String::from_utf8_lossy(bytes).into_owned()
    };
    text.trim_start_matches('\u{feff}').to_string()
}

/// Les distributions internes de Docker Desktop ne sont pas des shells utilisables.
fn parse_distros(bytes: &[u8]) -> Vec<String> {
    decode_wsl_output(bytes)
        .lines()
        .map(str::trim)
        .filter(|name| !name.is_empty() && !name.starts_with("docker-desktop"))
        .map(str::to_string)
        .collect()
}

#[cfg(test)]
mod tests {
    use super::*;

    fn utf16(text: &str) -> Vec<u8> {
        text.encode_utf16().flat_map(u16::to_le_bytes).collect()
    }

    #[test]
    fn parses_utf16_output_and_skips_docker() {
        let bytes = utf16("\u{feff}Ubuntu\r\nUbuntu2\r\ndocker-desktop\r\n\r\n");
        assert_eq!(parse_distros(&bytes), vec!["Ubuntu", "Ubuntu2"]);
    }

    #[test]
    fn parses_utf8_output() {
        assert_eq!(parse_distros(b"Debian\nUbuntu-24.04\n"), vec!["Debian", "Ubuntu-24.04"]);
    }

    #[test]
    fn no_wsl_means_no_distro() {
        assert!(parse_distros(b"").is_empty());
    }
}
