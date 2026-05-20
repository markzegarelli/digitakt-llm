use std::net::TcpStream;
use std::path::PathBuf;
use std::thread;
use std::time::Duration;

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

fn wait_for_server(host: &str, port: u16) -> bool {
    let addr = format!("{host}:{port}");
    for _ in 0..100 {
        if TcpStream::connect(&addr).is_ok() {
            return true;
        }
        thread::sleep(Duration::from_millis(50));
    }
    false
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

            thread::spawn(move || {
                let rt = tokio::runtime::Runtime::new().expect("tokio runtime");
                let _ = rt.block_on(digitakt_server::run_server(
                    SERVER_HOST,
                    SERVER_PORT,
                    patterns_dir,
                    web_dist,
                ));
            });

            if !wait_for_server(SERVER_HOST, SERVER_PORT) {
                eprintln!("digitakt: embedded server did not start on {SERVER_HOST}:{SERVER_PORT}");
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
