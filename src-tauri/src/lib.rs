use std::net::TcpStream;
use std::path::PathBuf;
use std::sync::mpsc;
use std::thread;
use std::time::{Duration, SystemTime, UNIX_EPOCH};

use tauri::{Manager, WebviewUrl};

const SERVER_HOST: &str = "127.0.0.1";
const SERVER_PORT: u16 = 8000;

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
fn wait_for_bound_server(bound_rx: mpsc::Receiver<u64>, expected_id: u64) -> bool {
    match bound_rx.recv_timeout(Duration::from_secs(8)) {
        Ok(id) if id == expected_id => true,
        Ok(_) => {
            eprintln!("digitakt: server reported unexpected instance id");
            false
        }
        Err(mpsc::RecvTimeoutError::Timeout) => {
            eprintln!(
                "digitakt: embedded server did not bind on {SERVER_HOST}:{SERVER_PORT} \
                 (port may be in use — stop any other digitakt serve process and retry)"
            );
            false
        }
        Err(mpsc::RecvTimeoutError::Disconnected) => {
            eprintln!("digitakt: embedded server exited before binding");
            false
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

            if !wait_for_bound_server(bound_rx, instance_id) {
                return Ok(());
            }

            let url = format!("http://{SERVER_HOST}:{SERVER_PORT}");
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
