//! Integration tests mirroring `tests/test_server.py` (subset).

use std::sync::Arc;

use axum::body::Body;
use axum::http::{Request, StatusCode};
use digitakt_core::{default_pattern, AppState, TRACK_NAMES};
use digitakt_generator::{Generator, LlmClient};
use digitakt_server::App;
use serde_json::{json, Map, Value};
use tower::ServiceExt;

struct MockLlm;

impl LlmClient for MockLlm {
    fn messages_with_tool(
        &self,
        _: &str,
        _: usize,
        _: &str,
        _: &str,
        _: &str,
        _: Map<String, Value>,
    ) -> Result<(String, Option<Map<String, Value>>), String> {
        Ok((String::new(), None))
    }

    fn messages_text(
        &self,
        _: &str,
        _: usize,
        _: &str,
        _: &[(String, String)],
    ) -> Result<String, String> {
        Ok("ok".into())
    }
}

fn test_app() -> Arc<App> {
    let tmp = tempfile::tempdir().unwrap();
    let mut app = App::with_mock_generator(tmp.path(), Arc::new(MockLlm));
    let pat = default_pattern();
    app.state.assign_current_pattern(pat);
    Arc::new(app)
}

#[tokio::test]
async fn get_state_returns_200() {
    let app = test_app();
    let router = app.clone().router();
    let resp = router
        .oneshot(Request::get("/state").body(Body::empty()).unwrap())
        .await
        .unwrap();
    assert_eq!(resp.status(), StatusCode::OK);
}

#[tokio::test]
async fn post_bpm_updates_state() {
    let app = test_app();
    let router = app.clone().router();
    let resp = router
        .oneshot(
            Request::post("/bpm")
                .header("content-type", "application/json")
                .body(Body::from("{\"bpm\":140.0}"))
                .unwrap(),
        )
        .await
        .unwrap();
    assert_eq!(resp.status(), StatusCode::OK);
    assert_eq!(app.state.bpm(), 140.0);
}

#[tokio::test]
async fn post_generate_returns_202() {
    let app = test_app();
    let router = app.router();
    let resp = router
        .oneshot(
            Request::post("/generate")
                .header("content-type", "application/json")
                .body(Body::from(r#"{"prompt":"heavy kick"}"#))
                .unwrap(),
        )
        .await
        .unwrap();
    assert_eq!(resp.status(), StatusCode::ACCEPTED);
}

#[tokio::test]
async fn post_play_and_stop() {
    let app = test_app();
    let router = app.clone().router();
    let play = router
        .clone()
        .oneshot(Request::post("/play").body(Body::empty()).unwrap())
        .await
        .unwrap();
    assert_eq!(play.status(), StatusCode::OK);
    app.player.stop();
    let stop = router
        .oneshot(Request::post("/stop").body(Body::empty()).unwrap())
        .await
        .unwrap();
    assert_eq!(stop.status(), StatusCode::OK);
}
