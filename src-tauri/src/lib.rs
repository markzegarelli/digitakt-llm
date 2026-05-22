use std::path::PathBuf;
use std::sync::mpsc;
use std::thread;
use std::time::{Duration, SystemTime, UNIX_EPOCH};

use tauri::{Manager, WebviewUrl};

const SERVER_HOST: &str = "127.0.0.1";
/// Ephemeral port so the embedded server never attaches to a stale :8000 dev instance.
const SERVER_PORT: u16 = 0;

fn resolve_web_dist(handle: &tauri::AppHandle) -> Option<PathBuf> {
    if let Ok(dir) = handle.path().resource_dir() {
        let bundled = dir.join("web/dist");
        if bundled.join("index.html").is_file() {
            return Some(bundled);
        }
    }
    digitakt_server::resolve_web_dist()
}

fn fresh_instance_id() -> u64 {
    SystemTime::now()
        .duration_since(UNIX_EPOCH)
        .map(|d| d.as_nanos() as u64)
        .unwrap_or(0)
}

/// Wait until our embedded server has bound and reported its instance id (not a stale listener).
fn wait_for_bound_server(bound_rx: mpsc::Receiver<(u64, u16)>, expected_id: u64) -> Option<u16> {
    match bound_rx.recv_timeout(Duration::from_secs(8)) {
        Ok((id, port)) if id == expected_id => Some(port),
        Ok(_) => {
            eprintln!("digitakt: server reported unexpected instance id");
            None
        }
        Err(mpsc::RecvTimeoutError::Timeout) => {
            eprintln!("digitakt: embedded server did not bind on {SERVER_HOST} (timed out)");
            None
        }
        Err(mpsc::RecvTimeoutError::Disconnected) => {
            eprintln!("digitakt: embedded server exited before binding");
            None
        }
    }
}

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    tauri::Builder::default()
        .plugin(tauri_plugin_shell::init())
        .setup(|app| {
            let handle = app.handle().clone();
            let web_dist = resolve_web_dist(&handle);
            if let Some(ref dist) = web_dist {
                eprintln!("digitakt: serving web UI from {}", dist.display());
            } else {
                eprintln!("digitakt: warning: no web/dist found for embedded server");
            }
            let patterns_dir = handle
                .path()
                .app_data_dir()
                .map(|d| d.join("patterns"))
                .unwrap_or_else(|_| PathBuf::from("patterns"));

            let instance_id = fresh_instance_id();
            let (bound_tx, bound_rx) = mpsc::channel();

            thread::spawn(move || {
                let rt = tokio::runtime::Runtime::new().expect("tokio runtime");
                if let Err(e) = rt.block_on(digitakt_server::run_server(
                    SERVER_HOST,
                    SERVER_PORT,
                    patterns_dir,
                    web_dist,
                    instance_id,
                    Some(bound_tx),
                )) {
                    eprintln!("digitakt: embedded server failed: {e}");
                }
            });

            let Some(server_port) = wait_for_bound_server(bound_rx, instance_id) else {
                return Ok(());
            };

            let url = format!("http://{SERVER_HOST}:{server_port}");
            eprintln!("digitakt: embedded API at {url}");
            tauri::WebviewWindowBuilder::new(
                &handle,
                "main",
                WebviewUrl::External(url.parse().expect("valid server url")),
            )
            .title("Digitakt LLM")
            .inner_size(1280.0, 800.0)
            .resizable(true)
            .build()?;

            Ok(())
        })
        .run(tauri::generate_context!())
        .expect("error while running tauri application");
}
