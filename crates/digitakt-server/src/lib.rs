//! Axum REST/WebSocket server mirroring `api/server.py`.

mod app;
mod env_file;
mod schemas;

pub use app::{resolve_web_dist, run_server, App, DEFAULT_PORT};
pub use env_file::{env_candidates, load_env_files};
pub use schemas::*;
