pub mod modules;

use fs::to_canon;
use modules::{
    agent, chronicle, fs, git, lsp, net, pty, secrets, shell, workspace,
};
use std::sync::Mutex;
use tauri::State;
use tauri_plugin_window_state::StateFlags;

/// Drained on first read so HMR / re-mounts can't replay the launch dir.
#[derive(Default)]
struct LaunchDir(Mutex<Option<String>>);

#[tauri::command]
fn get_launch_dir(state: State<'_, LaunchDir>) -> Option<String> {
    state.0.lock().expect("LaunchDir mutex poisoned").take()
}

fn parse_launch_dir() -> Option<String> {
    for arg in std::env::args().skip(1) {
        if arg.starts_with('-') {
            continue;
        }
        let Ok(canon) = std::fs::canonicalize(&arg) else {
            continue;
        };
        if !canon.is_dir() {
            continue;
        }
        return Some(to_canon(canon));
    }
    None
}

#[tauri::command]
fn is_store_build() -> bool {
    cfg!(feature = "store-build")
}

#[tauri::command]
fn toggle_devtools(window: tauri::WebviewWindow, open: bool) {
    if open {
        window.open_devtools();
    } else {
        window.close_devtools();
    }
}

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    workspace::init_launch_cwd(parse_launch_dir().as_deref());

    // For Microsoft Store builds this binary is compiled with --no-default-features
    // which drops the `updater` feature. The Store manages updates itself.
    #[allow(unused_mut)]
    let mut builder = tauri::Builder::default().plugin(tauri_plugin_process::init());

    #[cfg(not(feature = "store-build"))]
    {
        builder = builder.plugin(tauri_plugin_updater::Builder::new().build());
    }

    builder
        // Skip restoring VISIBLE — frontend calls window.show() after first
        // paint so the user never sees a transparent window-shadow flash on
        // Windows/Linux.
        .plugin(
            tauri_plugin_window_state::Builder::new()
                .with_state_flags(StateFlags::all() & !StateFlags::VISIBLE)
                .build(),
        )
        .plugin(tauri_plugin_autostart::Builder::new().build())
        .plugin(tauri_plugin_store::Builder::new().build())
        .plugin(tauri_plugin_os::init())
        .plugin(
            tauri_plugin_log::Builder::new()
                .level(tauri_plugin_log::log::LevelFilter::Info)
                .build(),
        )
        .plugin(tauri_plugin_notification::init())
        .plugin(tauri_plugin_opener::init())
        .manage(pty::PtyState::default())
        .manage(chronicle::ChronicleState::default())
        .manage(lsp::LspState::default())
        .manage(shell::ShellState::default())
        .manage(secrets::SecretsState::default())
        .manage(fs::watch::FsWatchState::default())
        .manage({
            let registry = workspace::WorkspaceRegistry::default();
            workspace::bootstrap_registry(&registry);
            if let Some(launch_dir) = parse_launch_dir() {
                let _ = registry.authorize(&launch_dir);
            }
            registry
        })
        .manage(LaunchDir(Mutex::new(parse_launch_dir())))
        .invoke_handler(tauri::generate_handler![
            pty::pty_open,
            pty::pty_write,
            pty::pty_resize,
            pty::pty_close,
            pty::pty_close_all,
            pty::pty_has_foreground_process,
            pty::pty_has_foreground_job,
            pty::pty_authorize_cwd,
            pty::pty_list_shells,
            lsp::lsp_detect,
            lsp::lsp_host_pid,
            lsp::lsp_resolve_root,
            lsp::lsp_spawn,
            lsp::lsp_send,
            lsp::lsp_kill,
            fs::tree::list_subdirs,
            fs::tree::fs_read_dir,
            fs::file::fs_read_file,
            fs::file::fs_write_file,
            fs::file::fs_stat,
            fs::file::fs_canonicalize,
            fs::mutate::fs_create_file,
            fs::mutate::fs_create_dir,
            fs::mutate::fs_rename,
            fs::mutate::fs_delete,
            fs::watch::fs_watch_add,
            fs::watch::fs_watch_remove,
            fs::search::fs_search,
            fs::search::fs_list_files,
            fs::grep::fs_grep,
            fs::grep::fs_glob,
            git::commands::git_resolve_repo,
            git::commands::git_panel_snapshot,
            git::commands::git_status,
            git::commands::git_diff,
            git::commands::git_diff_content,
            git::commands::git_stage,
            git::commands::git_unstage,
            git::commands::git_discard,
            git::commands::git_commit,
            git::commands::git_fetch,
            git::commands::git_pull_ff_only,
            git::commands::git_push,
            git::commands::git_log,
            git::commands::git_show_commit,
            git::commands::git_commit_files,
            git::commands::git_commit_file_diff,
            git::commands::git_remote_url,
            git::commands::git_list_branches,
            git::commands::git_checkout_branch,
            git::commands::git_create_branch,
            git::commands::git_list_stash,
            git::commands::git_push_stash,
            git::commands::git_pop_stash,
            git::commands::git_drop_stash,
            shell::shell_run_command,
            shell::shell_session_open,
            shell::shell_session_run,
            shell::shell_session_close,
            shell::shell_bg_spawn,
            shell::shell_bg_logs,
            shell::shell_bg_kill,
            shell::shell_bg_list,
            workspace::wsl_list_distros,
            workspace::wsl_default_distro,
            workspace::wsl_home,
            workspace::workspace_authorize,
            workspace::workspace_current_dir,
            get_launch_dir,
            toggle_devtools,
            is_store_build,
            secrets::secrets_get,
            secrets::secrets_set,
            secrets::secrets_delete,
            secrets::secrets_get_all,
            net::lm_ping,
            net::ai_http_request,
            net::ai_http_stream,
            agent::agent_enable_claude_hooks,
            agent::agent_claude_hooks_status,
            chronicle::chronicle_range,
            chronicle::chronicle_restore_file,
            chronicle::chronicle_record_command,
            chronicle::chronicle_record_agent,
            chronicle::chronicle_file_history,
            chronicle::chronicle_checkout_sandbox,
            chronicle::chronicle_search,
            chronicle::chronicle_prune,
        ])
        .run(tauri::generate_context!())
        .expect("error while running tauri application");
}
