// TodoHub desktop shell: starts the Python backend on a free local port with a random
// token, hands both to the web UI, and stops the backend when the app quits.
#![cfg_attr(not(debug_assertions), windows_subsystem = "windows")]

use std::fs;
use std::net::TcpListener;
use std::path::PathBuf;
use std::process::{Child, Command, Stdio};
use std::sync::Mutex;

use serde::Serialize;
use tauri::menu::{Menu, MenuItem, PredefinedMenuItem};
use tauri::tray::TrayIconBuilder;
use tauri::{Emitter, Manager, RunEvent, WindowEvent};

struct Backend {
    url: String,
    token: String,
    error: Option<String>,
    child: Mutex<Option<Child>>,
}

#[derive(Serialize)]
struct BackendInfo {
    url: String,
    token: String,
    error: Option<String>,
}

#[tauri::command]
fn backend_info(state: tauri::State<Backend>) -> BackendInfo {
    BackendInfo { url: state.url.clone(), token: state.token.clone(), error: state.error.clone() }
}

/// Same folder the Python side uses: $TODOHUB_HOME, else ~/Library/Application Support/TodoHub.
fn todohub_home() -> PathBuf {
    if let Ok(dir) = std::env::var("TODOHUB_HOME") {
        return PathBuf::from(dir);
    }
    let home = std::env::var("HOME").unwrap_or_else(|_| ".".into());
    if cfg!(target_os = "macos") {
        PathBuf::from(home).join("Library/Application Support/TodoHub")
    } else {
        PathBuf::from(home).join(".todohub")
    }
}

/// The bundled backend binary, next to the app's own executable (Contents/MacOS on macOS).
fn bundled_backend() -> Option<PathBuf> {
    let dir = std::env::current_exe().ok()?.parent()?.to_path_buf();
    let name = if cfg!(windows) { "todohub-backend.exe" } else { "todohub-backend" };
    let path = dir.join(name);
    path.exists().then_some(path)
}

/// How to start the backend: the bundled binary when the app was built with it,
/// otherwise the command `todohub init` wrote to app.json (a checkout with uv).
fn backend_command() -> Result<Vec<String>, String> {
    if let Some(bin) = bundled_backend() {
        return Ok(vec![bin.to_string_lossy().into_owned(), "api".into()]);
    }
    let path = todohub_home().join("app.json");
    let text = fs::read_to_string(&path)
        .map_err(|_| format!("{} not found. Run `todohub init` in the backend folder first.", path.display()))?;
    let value: serde_json::Value =
        serde_json::from_str(&text).map_err(|e| format!("{} is not valid JSON: {e}", path.display()))?;
    let cmd: Vec<String> = value["backend"]
        .as_array()
        .map(|a| a.iter().filter_map(|v| v.as_str().map(String::from)).collect())
        .unwrap_or_default();
    if cmd.is_empty() {
        return Err(format!("{} has no \"backend\" command.", path.display()));
    }
    Ok(cmd)
}

fn free_port() -> Result<u16, String> {
    TcpListener::bind("127.0.0.1:0")
        .and_then(|l| l.local_addr())
        .map(|a| a.port())
        .map_err(|e| format!("No free local port: {e}"))
}

fn random_token() -> String {
    let mut bytes = [0u8; 24];
    getrandom::getrandom(&mut bytes).expect("no OS random source for the API token");
    bytes.iter().map(|b| format!("{b:02x}")).collect()
}

fn start_backend() -> Backend {
    let token = random_token();
    let started = backend_command().and_then(|cmd| {
        let port = free_port()?;
        let log_dir = todohub_home().join("logs");
        let _ = fs::create_dir_all(&log_dir);
        let log = fs::File::create(log_dir.join("api.log")).map_err(|e| e.to_string())?;
        let child = Command::new(&cmd[0])
            .args(&cmd[1..])
            .arg("--port")
            .arg(port.to_string())
            .env("TODOHUB_TOKEN", &token)
            // The backend exits by itself if this app goes away, even if it's killed outright.
            .env("TODOHUB_EXIT_WITH_PARENT", "1")
            .stdout(Stdio::from(log.try_clone().map_err(|e| e.to_string())?))
            .stderr(Stdio::from(log))
            .spawn()
            .map_err(|e| format!("Couldn't start the backend ({}): {e}", cmd[0]))?;
        Ok((port, child))
    });
    match started {
        Ok((port, child)) => Backend {
            url: format!("http://127.0.0.1:{port}"),
            token,
            error: None,
            child: Mutex::new(Some(child)),
        },
        Err(e) => Backend { url: String::new(), token, error: Some(e), child: Mutex::new(None) },
    }
}

/// Inbox count next to the menu-bar icon (macOS shows the title; elsewhere it's the tooltip).
#[tauri::command]
fn set_tray_count(app: tauri::AppHandle, count: u32) {
    if let Some(tray) = app.tray_by_id("main") {
        let _ = tray.set_title(if count > 0 { Some(count.to_string()) } else { None });
        let _ = tray.set_tooltip(Some(format!("TodoHub: {count} to review")));
    }
}

fn show_main(app: &tauri::AppHandle) {
    if let Some(window) = app.get_webview_window("main") {
        let _ = window.show();
        let _ = window.unminimize();
        let _ = window.set_focus();
    }
}

/// Menu-bar item: Open, Capture…, Run sweep now, Quit.
fn build_tray(app: &tauri::App) -> tauri::Result<()> {
    let open = MenuItem::with_id(app, "open", "Open TodoHub", true, None::<&str>)?;
    let capture = MenuItem::with_id(app, "capture", "Capture…  (⌥⌘T)", true, None::<&str>)?;
    let run = MenuItem::with_id(app, "run", "Run sweep now", true, None::<&str>)?;
    let quit = MenuItem::with_id(app, "quit", "Quit TodoHub", true, None::<&str>)?;
    let menu = Menu::with_items(app, &[&open, &capture, &run, &PredefinedMenuItem::separator(app)?, &quit])?;
    let mut tray = TrayIconBuilder::with_id("main").menu(&menu).tooltip("TodoHub");
    if let Some(icon) = app.default_window_icon() {
        tray = tray.icon(icon.clone());
    }
    tray.on_menu_event(|app, event| match event.id.as_ref() {
        "open" => show_main(app),
        "capture" => {
            show_main(app);
            let _ = app.emit("capture", ());
        }
        "run" => {
            let _ = app.emit("run-now", ());
        }
        "quit" => app.exit(0),
        _ => {}
    })
    .build(app)?;
    Ok(())
}

/// ⌥⌘T anywhere: bring TodoHub forward with the capture box focused.
#[cfg(desktop)]
fn register_capture_shortcut(app: &tauri::App) -> Result<(), Box<dyn std::error::Error>> {
    use tauri_plugin_global_shortcut::{Code, GlobalShortcutExt, Modifiers, Shortcut, ShortcutState};
    let capture = Shortcut::new(Some(Modifiers::SUPER | Modifiers::ALT), Code::KeyT);
    app.handle().plugin(
        tauri_plugin_global_shortcut::Builder::new()
            .with_handler(move |app, shortcut, event| {
                if shortcut == &capture && event.state() == ShortcutState::Pressed {
                    show_main(app);
                    let _ = app.emit("capture", ());
                }
            })
            .build(),
    )?;
    // Another app may own the shortcut already; TodoHub still works without it.
    if let Err(e) = app.global_shortcut().register(capture) {
        eprintln!("TodoHub: couldn't register ⌥⌘T: {e}");
    }
    Ok(())
}

fn main() {
    let app = tauri::Builder::default()
        .plugin(tauri_plugin_opener::init())
        .plugin(tauri_plugin_notification::init())
        .manage(start_backend())
        .invoke_handler(tauri::generate_handler![backend_info, set_tray_count])
        .setup(|app| {
            build_tray(app)?;
            #[cfg(desktop)]
            register_capture_shortcut(app)?;
            Ok(())
        })
        // Closing the window keeps TodoHub in the menu bar; quit from its menu or with ⌘Q.
        .on_window_event(|window, event| {
            if let WindowEvent::CloseRequested { api, .. } = event {
                api.prevent_close();
                let _ = window.hide();
            }
        })
        .build(tauri::generate_context!())
        .expect("error while building TodoHub");

    app.run(|handle, event| {
        if let RunEvent::Exit = event {
            if let Some(mut child) = handle.state::<Backend>().child.lock().unwrap().take() {
                let _ = child.kill();
                let _ = child.wait();
            }
        }
    });
}
