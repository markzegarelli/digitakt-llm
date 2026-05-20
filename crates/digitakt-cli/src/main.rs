//! digitakt serve — headless Axum server for Ink / web dev.

use digitakt_server::{run_server, DEFAULT_PORT};

#[tokio::main]
async fn main() {
    let host = std::env::var("DIGITAKT_HOST").unwrap_or_else(|_| "127.0.0.1".into());
    let port = std::env::var("PORT")
        .ok()
        .and_then(|p| p.parse().ok())
        .unwrap_or(DEFAULT_PORT);
    let patterns_dir = std::env::var("DIGITAKT_PATTERNS_DIR").unwrap_or_else(|_| "patterns".into());
    let instance_id = std::time::SystemTime::now()
        .duration_since(std::time::UNIX_EPOCH)
        .map(|d| d.as_nanos() as u64)
        .unwrap_or(0);
    if let Err(e) = run_server(&host, port, patterns_dir, None, instance_id, None).await {
        eprintln!("digitakt serve failed: {e}");
        std::process::exit(1);
    }
}
