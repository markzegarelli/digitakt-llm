//! Axum REST/WebSocket server mirroring `api/server.py`.

mod app;
mod schemas;

pub use app::{run_server, App, DEFAULT_PORT};
pub use schemas::*;
