//! Axum REST/WebSocket server mirroring `api/server.py`.

mod app;
mod schemas;

pub use app::{resolve_web_dist, run_server, App, DEFAULT_PORT};
pub use schemas::*;
