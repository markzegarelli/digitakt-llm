//! LLM prompt tracing (parity with `core/tracing.py`).

use parking_lot::Mutex;
use serde_json::{json, Map, Value};
use std::env;
use std::fs::OpenOptions;
use std::io::Write;
use std::sync::Arc;
use std::time::{Instant, SystemTime, UNIX_EPOCH};

#[derive(Debug, Clone)]
pub struct TraceSpan {
    pub operation: String,
    pub prompt: String,
    pub response: String,
    pub status: String,
    pub error: Option<String>,
    start: Instant,
    end: Option<Instant>,
    pub metadata: Map<String, Value>,
}

impl TraceSpan {
    pub fn new(operation: impl Into<String>, prompt: impl Into<String>) -> Self {
        Self {
            operation: operation.into(),
            prompt: prompt.into(),
            response: String::new(),
            status: "pending".into(),
            error: None,
            start: Instant::now(),
            end: None,
            metadata: Map::new(),
        }
    }

    pub fn set_response(&mut self, response: &str, max_len: usize) {
        self.response = response.chars().take(max_len).collect();
    }

    pub fn set_status(&mut self, status: impl Into<String>) {
        self.status = status.into();
    }

    pub fn set_error(&mut self, error: impl Into<String>) {
        self.status = "error".into();
        self.error = Some(error.into());
    }

    pub fn finish(&mut self) {
        self.end = Some(Instant::now());
    }

    pub fn latency_ms(&self) -> i64 {
        match self.end {
            Some(e) => ((e - self.start).as_secs_f64() * 1000.0) as i64,
            None => 0,
        }
    }

    pub fn to_dict(&self) -> Map<String, Value> {
        let ts = SystemTime::now()
            .duration_since(UNIX_EPOCH)
            .map(|d| d.as_secs())
            .unwrap_or(0);
        Map::from_iter([
            ("operation".into(), json!(self.operation)),
            (
                "prompt".into(),
                json!(self.prompt.chars().take(500).collect::<String>()),
            ),
            ("response".into(), json!(self.response)),
            ("status".into(), json!(self.status)),
            ("error".into(), self.error.as_ref().map(|e| json!(e)).unwrap_or(Value::Null)),
            ("latency_ms".into(), json!(self.latency_ms())),
            ("timestamp".into(), json!(ts)),
            ("metadata".into(), json!(self.metadata)),
        ])
    }
}

pub struct Tracer {
    traces: Mutex<Vec<Map<String, Value>>>,
    max_traces: usize,
    file_path: Mutex<Option<String>>,
}

impl Tracer {
    pub fn new(max_traces: usize) -> Self {
        let file_path = env::var("DIGITAKT_TRACE_FILE").ok();
        Self {
            traces: Mutex::new(Vec::new()),
            max_traces,
            file_path: Mutex::new(file_path),
        }
    }

    pub fn record(&self, span: &TraceSpan) {
        let entry = span.to_dict();
        {
            let mut traces = self.traces.lock();
            traces.push(entry.clone());
            if traces.len() > self.max_traces {
                let drain = traces.len() - self.max_traces;
                traces.drain(0..drain);
            }
        }
        if let Some(path) = self.file_path.lock().clone() {
            if let Ok(line) = serde_json::to_string(&entry) {
                if let Ok(mut f) = OpenOptions::new().create(true).append(true).open(path) {
                    let _ = writeln!(f, "{line}");
                }
            }
        }
    }

    pub fn traces(&self) -> Vec<Map<String, Value>> {
        self.traces.lock().clone()
    }

    pub fn clear(&self) {
        self.traces.lock().clear();
    }
}

impl Default for Tracer {
    fn default() -> Self {
        Self::new(200)
    }
}

pub struct SpanGuard<'a> {
    span: TraceSpan,
    tracer: &'a Tracer,
}

impl<'a> SpanGuard<'a> {
    pub fn new(tracer: &'a Tracer, operation: impl Into<String>, prompt: impl Into<String>) -> Self {
        Self {
            span: TraceSpan::new(operation, prompt),
            tracer,
        }
    }

    pub fn span(&mut self) -> &mut TraceSpan {
        &mut self.span
    }
}

impl Drop for SpanGuard<'_> {
    fn drop(&mut self) {
        self.span.finish();
        self.tracer.record(&self.span);
    }
}

pub fn global_tracer() -> Arc<Tracer> {
    static TRACER: std::sync::OnceLock<Arc<Tracer>> = std::sync::OnceLock::new();
    TRACER.get_or_init(|| Arc::new(Tracer::default())).clone()
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn records_trace() {
        let t = Tracer::new(10);
        let mut span = TraceSpan::new("generate", "test prompt");
        span.set_status("ok");
        span.finish();
        t.record(&span);
        assert_eq!(t.traces().len(), 1);
    }
}
