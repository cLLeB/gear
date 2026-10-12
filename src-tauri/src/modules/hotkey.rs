//! A system-wide hotkey that brings the main window forward from any app, or
//! hides it when it is already in front (a drop-down terminal).

use std::str::FromStr;

use tauri::{AppHandle, Manager};
use tauri_plugin_global_shortcut::{GlobalShortcutExt, Shortcut, ShortcutState};

#[derive(Debug, PartialEq, Eq, Clone, Copy)]
pub enum Toggle {
    Hide,
    Show,
}

/// Only a window the user is looking at is hidden; anything else (hidden,
/// minimized, behind another app) is brought forward.
pub fn toggle_for(visible: bool, minimized: bool, focused: bool) -> Toggle {
    if visible && !minimized && focused {
        Toggle::Hide
    } else {
        Toggle::Show
    }
}

/// Accepts what people type ("ctrl + `", "Cmd+Shift+Space") and requires at
/// least one modifier, so a bare letter can't be swallowed system-wide.
pub fn parse_hotkey(input: &str) -> Result<Shortcut, String> {
    let parts: Vec<String> = input
        .split('+')
        .map(|p| p.trim().to_ascii_lowercase())
        .filter(|p| !p.is_empty())
        .map(|p| match p.as_str() {
            "cmd" | "command" | "win" | "windows" | "meta" => "super".to_string(),
            "cmdorctrl" | "commandorcontrol" | "mod" => "commandorcontrol".to_string(),
            "opt" => "alt".to_string(),
            "esc" => "escape".to_string(),
            "`" => "backquote".to_string(),
            _ => p,
        })
        .collect();
    if parts.is_empty() {
        return Err("Enter a key combination such as Ctrl+Alt+Space".into());
    }
    let shortcut = Shortcut::from_str(&parts.join("+")).map_err(|_| {
        format!(
            "\"{}\" is not a key combination Gear can register",
            input.trim()
        )
    })?;
    if shortcut.mods.is_empty() {
        return Err("Add a modifier (Ctrl, Alt, Shift or Cmd/Win) to the key".into());
    }
    Ok(shortcut)
}

fn toggle_main(app: &AppHandle) {
    let Some(window) = app.get_webview_window("main") else {
        return;
    };
    let visible = window.is_visible().unwrap_or(true);
    let minimized = window.is_minimized().unwrap_or(false);
    let focused = window.is_focused().unwrap_or(false);
    match toggle_for(visible, minimized, focused) {
        Toggle::Hide => {
            let _ = window.hide();
        }
        Toggle::Show => {
            let _ = window.show();
            let _ = window.unminimize();
            let _ = window.set_focus();
        }
    }
}

pub fn plugin() -> tauri::plugin::TauriPlugin<tauri::Wry> {
    tauri_plugin_global_shortcut::Builder::new()
        .with_handler(|app, _shortcut, event| {
            if event.state() == ShortcutState::Pressed {
                toggle_main(app);
            }
        })
        .build()
}

/// Replaces the registered hotkey; an empty string clears it.
#[tauri::command]
pub fn window_set_global_hotkey(app: AppHandle, shortcut: String) -> Result<(), String> {
    let manager = app.global_shortcut();
    manager.unregister_all().map_err(|e| e.to_string())?;
    if shortcut.trim().is_empty() {
        return Ok(());
    }
    let parsed = parse_hotkey(&shortcut)?;
    manager.register(parsed).map_err(|e| {
        format!(
            "Could not register {}: another app may already use it ({e})",
            shortcut.trim()
        )
    })
}

#[cfg(test)]
mod tests {
    use super::*;
    use tauri_plugin_global_shortcut::{Code, Modifiers};

    #[test]
    fn only_a_window_in_front_is_hidden() {
        assert_eq!(toggle_for(true, false, true), Toggle::Hide);
        assert_eq!(toggle_for(true, false, false), Toggle::Show);
        assert_eq!(toggle_for(true, true, true), Toggle::Show);
        assert_eq!(toggle_for(false, false, false), Toggle::Show);
        assert_eq!(toggle_for(false, false, true), Toggle::Show);
    }

    #[test]
    fn parses_what_people_type() {
        let s = parse_hotkey("ctrl + `").unwrap();
        assert_eq!(s.key, Code::Backquote);
        assert_eq!(s.mods, Modifiers::CONTROL);

        let s = parse_hotkey("Cmd+Shift+Space").unwrap();
        assert_eq!(s.key, Code::Space);
        assert_eq!(s.mods, Modifiers::SUPER | Modifiers::SHIFT);

        let s = parse_hotkey("Alt+F12").unwrap();
        assert_eq!(s.key, Code::F12);
        assert_eq!(s.mods, Modifiers::ALT);

        assert_eq!(parse_hotkey("opt+esc").unwrap().key, Code::Escape);
    }

    #[test]
    fn rejects_bare_keys_and_nonsense() {
        assert!(parse_hotkey("").is_err());
        assert!(parse_hotkey(" + ").is_err());
        assert!(parse_hotkey("a").unwrap_err().contains("modifier"));
        assert!(parse_hotkey("F12").unwrap_err().contains("modifier"));
        assert!(parse_hotkey("Ctrl+Nope").is_err());
        assert!(parse_hotkey("Ctrl+Shift").is_err());
    }
}
