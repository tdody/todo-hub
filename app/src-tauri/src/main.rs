// TodoHub desktop shell: starts the Python backend on a free local port with a random
// token, hands both to the web UI, and stops the backend when the app quits.
#![cfg_attr(not(debug_assertions), windows_subsystem = "windows")]

use std::fs;
use std::net::TcpListener;
use std::path::PathBuf;
use std::process::{Child, Command, Stdio};
use std::sync::Mutex;

use serde::Serialize;
use tauri::menu::{CheckMenuItemBuilder, Menu, MenuBuilder, MenuItem, MenuItemBuilder, PredefinedMenuItem, SubmenuBuilder};
use tauri::tray::TrayIconBuilder;
use tauri::{Emitter, Manager, RunEvent, WindowEvent};

/// The running backend. It sits behind a lock because View → Reload restarts it.
struct Backend(Mutex<BackendState>);

struct BackendState {
    port: Option<u16>,
    token: String,
    error: Option<String>,
    child: Option<Child>,
}

#[derive(Serialize)]
struct BackendInfo {
    url: String,
    token: String,
    error: Option<String>,
}

#[tauri::command]
fn backend_info(state: tauri::State<Backend>) -> BackendInfo {
    let s = state.0.lock().unwrap();
    BackendInfo {
        url: s.port.map(|p| format!("http://127.0.0.1:{p}")).unwrap_or_default(),
        token: s.token.clone(),
        error: s.error.clone(),
    }
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

/// Start the backend on `port` (a new free one if None), logging to logs/api.log.
fn spawn_backend(port: Option<u16>, token: &str) -> Result<(u16, Child), String> {
    let cmd = backend_command()?;
    let port = match port {
        Some(p) => p,
        None => free_port()?,
    };
    let log_dir = todohub_home().join("logs");
    let _ = fs::create_dir_all(&log_dir);
    let log = fs::File::create(log_dir.join("api.log")).map_err(|e| e.to_string())?;
    let child = Command::new(&cmd[0])
        .args(&cmd[1..])
        .arg("--port")
        .arg(port.to_string())
        .env("TODOHUB_TOKEN", token)
        // The backend exits by itself if this app goes away, even if it's killed outright.
        .env("TODOHUB_EXIT_WITH_PARENT", "1")
        .stdout(Stdio::from(log.try_clone().map_err(|e| e.to_string())?))
        .stderr(Stdio::from(log))
        .spawn()
        .map_err(|e| format!("Couldn't start the backend ({}): {e}", cmd[0]))?;
    Ok((port, child))
}

fn start_backend() -> Backend {
    let token = random_token();
    let state = match spawn_backend(None, &token) {
        Ok((port, child)) => BackendState { port: Some(port), token, error: None, child: Some(child) },
        Err(e) => BackendState { port: None, token, error: Some(e), child: None },
    };
    Backend(Mutex::new(state))
}

fn stop_backend(state: &mut BackendState) {
    if let Some(mut child) = state.child.take() {
        let _ = child.kill();
        let _ = child.wait();
    }
}

/// Stop the backend and start it again from the current code, on the same port and token
/// so the page can keep talking to it.
fn restart_backend(app: &tauri::AppHandle) {
    let backend = app.state::<Backend>();
    let mut s = backend.0.lock().unwrap();
    stop_backend(&mut s);
    let token = s.token.clone();
    match spawn_backend(s.port, &token) {
        Ok((port, child)) => {
            s.port = Some(port);
            s.error = None;
            s.child = Some(child);
        }
        Err(e) => s.error = Some(e),
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
    // Black sunrise glyph drawn as a template image, so macOS tints it for light and dark menu bars.
    let tray = TrayIconBuilder::with_id("main")
        .menu(&menu)
        .tooltip("TodoHub")
        .icon(tauri::include_image!("icons/tray.png"))
        .icon_as_template(true);
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

/// The app's own menu bar. Undo and Reload are ours rather than the stock items:
/// - Edit → Undo (⌘Z) goes to the page, which undoes typing in a text field or else the last
///   TodoHub action. A stock Undo item would take ⌘Z before the page could see it.
/// - View → Reload (⇧⌘R) restarts the backend and reloads the window, so a code change on
///   either side shows up without quitting. (Shift, as in Periscope: a menu shortcut is taken
///   before the page sees the key.)
fn build_app_menu(app: &tauri::App) -> tauri::Result<()> {
    let h = app.handle();
    let mut app_menu = SubmenuBuilder::new(h, "TodoHub").about(None).separator();
    if installed_app() {
        let on = login_item_enabled(h);
        app_menu = app_menu
            .item(&CheckMenuItemBuilder::with_id("app-login", "Open at Login").checked(on).build(h)?)
            .separator();
    }
    let app_menu = app_menu
        .hide()
        .hide_others()
        .show_all()
        .separator()
        .quit()
        .build()?;
    let edit = SubmenuBuilder::new(h, "Edit")
        .item(&MenuItemBuilder::with_id("app-undo", "Undo").accelerator("CmdOrCtrl+Z").build(h)?)
        .redo()
        .separator()
        .cut()
        .copy()
        .paste()
        .select_all()
        .build()?;
    let view = SubmenuBuilder::new(h, "View")
        .item(&MenuItemBuilder::with_id("app-reload", "Reload").accelerator("Shift+CmdOrCtrl+R").build(h)?)
        .item(&MenuItemBuilder::with_id("app-devtools", "Developer Tools").accelerator("Alt+CmdOrCtrl+I").build(h)?)
        .build()?;
    let window = SubmenuBuilder::new(h, "Window").minimize().close_window().build()?;
    let menu = MenuBuilder::new(h).items(&[&app_menu, &edit, &view, &window]).build()?;
    app.set_menu(menu)?;
    Ok(())
}

fn on_app_menu(app: &tauri::AppHandle, id: &str) {
    let Some(window) = app.get_webview_window("main") else { return };
    match id {
        "app-login" => set_login_item(app, !login_item_enabled(app)),
        "app-undo" => {
            let _ = window.eval("window.todohubUndo && window.todohubUndo()");
        }
        "app-reload" => {
            restart_backend(app);
            let _ = window.eval("location.reload()");
        }
        "app-devtools" => {
            #[cfg(debug_assertions)]
            if window.is_devtools_open() {
                window.close_devtools();
            } else {
                window.open_devtools();
            }
        }
        _ => {}
    }
}

/// True when running as the installed TodoHub.app (not `npm run tauri dev`), so the login
/// item always points at the app in /Applications rather than a build folder.
fn installed_app() -> bool {
    std::env::current_exe()
        .map(|p| p.to_string_lossy().contains(".app/Contents/MacOS/"))
        .unwrap_or(false)
}

#[cfg(desktop)]
fn login_item_enabled(app: &tauri::AppHandle) -> bool {
    use tauri_plugin_autostart::ManagerExt;
    app.autolaunch().is_enabled().unwrap_or(false)
}

#[cfg(desktop)]
fn set_login_item(app: &tauri::AppHandle, on: bool) {
    use tauri_plugin_autostart::ManagerExt;
    let result = if on { app.autolaunch().enable() } else { app.autolaunch().disable() };
    if let Err(e) = result {
        eprintln!("TodoHub: couldn't change Open at Login: {e}");
    }
    let now = login_item_enabled(app);
    if let Some(item) = app.menu().and_then(|m| m.get("app-login")) {
        if let Some(check) = item.as_check_menuitem() {
            let _ = check.set_checked(now);
        }
    }
}

/// The first time the installed app runs, it adds itself to the login items. After that it
/// leaves the choice alone, so turning Open at Login off sticks.
#[cfg(desktop)]
fn first_run_login_item(app: &tauri::AppHandle) {
    if !installed_app() {
        return;
    }
    let marker = todohub_home().join("login-item-set");
    if marker.exists() {
        return;
    }
    set_login_item(app, true);
    let _ = fs::create_dir_all(todohub_home());
    let _ = fs::write(marker, "Open at Login was turned on once by the app; change it from the TodoHub menu.\n");
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
        .plugin(tauri_plugin_autostart::init(
            tauri_plugin_autostart::MacosLauncher::LaunchAgent,
            Some(vec!["--hidden"]),
        ))
        .plugin(tauri_plugin_updater::Builder::new().build())
        .plugin(tauri_plugin_process::init())
        .manage(start_backend())
        .invoke_handler(tauri::generate_handler![backend_info, set_tray_count])
        .setup(|app| {
            #[cfg(desktop)]
            first_run_login_item(app.handle());
            build_app_menu(app)?;
            build_tray(app)?;
            #[cfg(desktop)]
            register_capture_shortcut(app)?;
            // Started at login: stay in the menu bar. Otherwise open the window.
            if !std::env::args().any(|a| a == "--hidden") {
                show_main(app.handle());
            }
            Ok(())
        })
        .on_menu_event(|app, event| on_app_menu(app, event.id().as_ref()))
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
        match event {
            RunEvent::Exit => stop_backend(&mut handle.state::<Backend>().0.lock().unwrap()),
            // Opening TodoHub again from Finder or the Dock while it runs in the menu bar.
            #[cfg(target_os = "macos")]
            RunEvent::Reopen { .. } => show_main(handle),
            _ => {}
        }
    });
}
