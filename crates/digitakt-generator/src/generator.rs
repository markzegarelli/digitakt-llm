//! Anthropic pattern generator (parity with `core/generator.py`).

use std::collections::HashMap;
use std::sync::Arc;
use std::thread;

use digitakt_core::{AppState, Pattern, TRACK_NAMES};
use digitakt_engine::EventBus;
use parking_lot::Mutex;
use regex::Regex;
use serde_json::{json, Map, Value};

use crate::coerce::{
    coerce_pattern_dict, compute_generation_summary, detect_target_tracks, normalize_producer_notes,
    opus_max_output_tokens, parse_ask_response, serialize_pattern_for_llm,
};
use crate::prompts::{classify_system_prompt, help_system_prompt, system_prompt_for_steps};
use crate::injectable_profiles::build_injectable_context_prefix;
use crate::tracing::{global_tracer, SpanGuard};

pub trait LlmClient: Send + Sync {
    fn messages_with_tool(
        &self,
        model: &str,
        max_tokens: usize,
        system: &str,
        user: &str,
        tool_name: &str,
        tool_schema: Map<String, Value>,
    ) -> Result<(String, Option<Map<String, Value>>), String>;

    fn messages_text(
        &self,
        model: &str,
        max_tokens: usize,
        system: &str,
        messages: &[(String, String)],
    ) -> Result<String, String>;
}

pub struct AnthropicClient {
    http: reqwest::Client,
    api_key: String,
}

impl AnthropicClient {
    pub fn from_env() -> Result<Self, String> {
        let api_key = std::env::var("ANTHROPIC_API_KEY")
            .map_err(|_| "ANTHROPIC_API_KEY not set".to_string())?;
        Ok(Self {
            http: reqwest::Client::new(),
            api_key,
        })
    }
}

impl LlmClient for AnthropicClient {
    fn messages_with_tool(
        &self,
        model: &str,
        max_tokens: usize,
        system: &str,
        user: &str,
        tool_name: &str,
        tool_schema: Map<String, Value>,
    ) -> Result<(String, Option<Map<String, Value>>), String> {
        let body = json!({
            "model": model,
            "max_tokens": max_tokens,
            "system": [{"type": "text", "text": system, "cache_control": {"type": "ephemeral"}}],
            "messages": [{"role": "user", "content": user}],
            "tools": [tool_schema],
            "tool_choice": {"type": "tool", "name": tool_name}
        });
        let rt = tokio::runtime::Builder::new_current_thread()
            .enable_all()
            .build()
            .map_err(|e| e.to_string())?;
        let resp = rt
            .block_on(
                self.http
                    .post("https://api.anthropic.com/v1/messages")
                    .header("x-api-key", &self.api_key)
                    .header("anthropic-version", "2023-06-01")
                    .json(&body)
                    .send(),
            )
            .map_err(|e| e.to_string())?;
        let data: Value = rt.block_on(resp.json()).map_err(|e| e.to_string())?;
        let mut raw = String::new();
        let mut tool_input: Option<Map<String, Value>> = None;
        if let Some(blocks) = data.get("content").and_then(|v| v.as_array()) {
            for block in blocks {
                if block.get("type").and_then(|v| v.as_str()) == Some("tool_use")
                    && block.get("name").and_then(|v| v.as_str()) == Some(tool_name)
                {
                    if let Some(inp) = block.get("input").and_then(|v| v.as_object()) {
                        tool_input = Some(inp.clone());
                    }
                } else if let Some(text) = block.get("text").and_then(|v| v.as_str()) {
                    raw.push_str(text);
                }
            }
        }
        Ok((raw, tool_input))
    }

    fn messages_text(
        &self,
        model: &str,
        max_tokens: usize,
        system: &str,
        messages: &[(String, String)],
    ) -> Result<String, String> {
        let msgs: Vec<Value> = messages
            .iter()
            .map(|(role, content)| json!({"role": role, "content": content}))
            .collect();
        let body = json!({
            "model": model,
            "max_tokens": max_tokens,
            "system": system,
            "messages": msgs
        });
        let rt = tokio::runtime::Builder::new_current_thread()
            .enable_all()
            .build()
            .map_err(|e| e.to_string())?;
        let resp = rt
            .block_on(
                self.http
                    .post("https://api.anthropic.com/v1/messages")
                    .header("x-api-key", &self.api_key)
                    .header("anthropic-version", "2023-06-01")
                    .json(&body)
                    .send(),
            )
            .map_err(|e| e.to_string())?;
        let data: Value = rt.block_on(resp.json()).map_err(|e| e.to_string())?;
        let mut out = String::new();
        if let Some(blocks) = data.get("content").and_then(|v| v.as_array()) {
            for block in blocks {
                if let Some(text) = block.get("text").and_then(|v| v.as_str()) {
                    out.push_str(text);
                }
            }
        }
        Ok(out.trim().to_string())
    }
}

const CONVERSATION_HISTORY_MAX: usize = 10;

pub struct Generator {
    state: Arc<AppState>,
    bus: Arc<EventBus>,
    client: Arc<dyn LlmClient>,
    conversation_history: Arc<Mutex<Vec<(String, String)>>>,
}

impl Generator {
    pub fn new(state: Arc<AppState>, bus: Arc<EventBus>, client: Arc<dyn LlmClient>) -> Self {
        Self {
            state,
            bus,
            client,
            conversation_history: Arc::new(Mutex::new(Vec::new())),
        }
    }

    pub fn generate(&self, prompt: &str, variation: bool) {
        let this = Arc::new(GeneratorHandle {
            state: self.state.clone(),
            bus: self.bus.clone(),
            client: self.client.clone(),
            conversation_history: self.conversation_history.clone(),
        });
        let p = prompt.to_string();
        thread::spawn(move || this.run(&p, variation));
    }

    pub fn answer_question_with_classify(&self, question: &str) -> Result<(String, bool), String> {
        let raw = self.ask_llm_raw(question)?;
        let (answer, implementable) = parse_ask_response(&strip_markdown(&raw));
        self.add_to_history("user", question);
        self.add_to_history("assistant", &answer);
        Ok((answer, implementable))
    }

    fn ask_llm_raw(&self, question: &str) -> Result<String, String> {
        let hist = self.conversation_history.lock();
        let start = hist.len().saturating_sub(CONVERSATION_HISTORY_MAX);
        let mut messages: Vec<(String, String)> = hist[start..].to_vec();
        messages.push(("user".into(), question.to_string()));
        drop(hist);
        self.client.messages_text(
            "claude-haiku-4-5-20251001",
            320,
            &help_system_prompt(),
            &messages,
        )
    }

    fn add_to_history(&self, role: &str, content: &str) {
        let mut h = self.conversation_history.lock();
        h.push((role.into(), content.to_string()));
        if h.len() > CONVERSATION_HISTORY_MAX * 2 {
            let drain = h.len() - CONVERSATION_HISTORY_MAX * 2;
            h.drain(0..drain);
        }
    }
}

struct GeneratorHandle {
    state: Arc<AppState>,
    bus: Arc<EventBus>,
    client: Arc<dyn LlmClient>,
    conversation_history: Arc<Mutex<Vec<(String, String)>>>,
}

impl GeneratorHandle {
    fn run(&self, prompt: &str, variation: bool) {
        self.bus.emit(
            "generation_started",
            Some(Map::from_iter([("prompt".into(), json!(prompt))])),
        );
        let user_prompt = self.build_user_prompt(prompt, variation);
        let tracer = global_tracer();
        let mut guard = SpanGuard::new(&tracer, "generate", &user_prompt);
        let steps = self.state.pattern_length() as usize;
        let tool_schema = emit_pattern_tool_schema(steps);
        let max_out = opus_max_output_tokens(steps);
        let system = system_prompt_for_steps(steps);

        let result = self.client.messages_with_tool(
            "claude-opus-4-6",
            max_out,
            &system,
            &user_prompt,
            "emit_pattern",
            tool_schema,
        );

        match result {
            Ok((text, tool_input)) => {
                let parsed = if let Some(inp) = tool_input {
                    coerce_pattern_dict(&inp, steps)
                } else {
                    parse_pattern_json(&text, steps)
                };
                guard.span().set_response(&text, 8000);
                guard.span().set_status("ok");
                let latency = guard.span().latency_ms();
                drop(guard);

                match parsed {
                    Some((mut pattern, bpm, cc_changes, producer_notes)) => {
                        self.merge_existing_metadata(&mut pattern);
                        self.state.update_pattern(pattern.clone(), Some(prompt));
                        self.state.queue_pattern(pattern.clone());
                        for (track, params) in &cc_changes {
                            for (param, value) in params {
                                if param == "velocity" {
                                    self.state.update_velocity(track, *value);
                                    self.bus.emit(
                                        "velocity_changed",
                                        Some(Map::from_iter([
                                            ("track".into(), json!(track)),
                                            ("value".into(), json!(value)),
                                        ])),
                                    );
                                } else {
                                    self.state.update_cc(track, param, *value);
                                    self.bus.emit(
                                        "cc_changed",
                                        Some(Map::from_iter([
                                            ("track".into(), json!(track)),
                                            ("param".into(), json!(param)),
                                            ("value".into(), json!(value)),
                                        ])),
                                    );
                                }
                            }
                        }
                        let summary = compute_generation_summary(
                            prompt,
                            &pattern,
                            latency,
                            producer_notes.as_deref(),
                        );
                        self.bus.emit(
                            "generation_complete",
                            Some(Map::from_iter([
                                ("pattern".into(), json!(pattern)),
                                ("prompt".into(), json!(prompt)),
                                ("bpm".into(), json!(bpm)),
                                ("cc_changes".into(), serde_json::to_value(&cc_changes).unwrap_or(Value::Null)),
                                ("summary".into(), json!(summary)),
                                (
                                    "producer_notes".into(),
                                    producer_notes.map(|n| json!(n)).unwrap_or(Value::Null),
                                ),
                            ])),
                        );
                    }
                    None => {
                        self.bus.emit(
                            "generation_failed",
                            Some(Map::from_iter([
                                ("prompt".into(), json!(prompt)),
                                ("error".into(), json!("Invalid JSON after retry")),
                            ])),
                        );
                    }
                }
            }
            Err(e) => {
                guard.span().set_error(&e);
                self.bus.emit(
                    "generation_failed",
                    Some(Map::from_iter([
                        ("prompt".into(), json!(prompt)),
                        ("error".into(), json!(e)),
                    ])),
                );
            }
        }
    }

    fn merge_existing_metadata(&self, pattern: &mut Pattern) {
        let existing = self.state.current_pattern();
        for key in ["seq_mode", "euclid_strip_mode"] {
            if !pattern.contains_key(key) {
                if let Some(v) = existing.get(key) {
                    pattern.insert(key.into(), v.clone());
                }
            }
        }
        if !pattern.contains_key("euclid") {
            if let Some(v) = existing.get("euclid") {
                pattern.insert("euclid".into(), v.clone());
            }
        }
        if !pattern.contains_key("lfo") {
            if let Some(v) = existing.get("lfo") {
                pattern.insert("lfo".into(), v.clone());
            }
        }
    }

    fn build_user_prompt(&self, prompt: &str, variation: bool) -> String {
        let context_prefix = build_injectable_context_prefix(prompt);
        if variation {
            if let (Some(last), pat) = (self.state.last_prompt(), self.state.current_pattern()) {
                if !pat.is_empty() {
                    let steps = self.state.pattern_length() as usize;
                    let pattern_json = serialize_pattern_for_llm(&pat, steps);
                    let targets = detect_target_tracks(prompt);
                    let constraint = if !targets.is_empty() {
                        let preserve: Vec<_> = TRACK_NAMES
                            .iter()
                            .filter(|t| !targets.contains(**t))
                            .copied()
                            .collect();
                        let modify: Vec<_> = TRACK_NAMES
                            .iter()
                            .filter(|t| targets.contains(**t))
                            .copied()
                            .collect();
                        format!(
                            "TARGETED UPDATE — only modify the listed tracks:\n  MODIFY: {}\n  PRESERVE EXACTLY (copy steps verbatim from previous pattern): {}\n\n",
                            modify.join(", "),
                            preserve.join(", ")
                        )
                    } else {
                        String::new()
                    };
                    return format!(
                        "{context_prefix}{constraint}Previous prompt: {last}\nPrevious pattern: {pattern_json}\n\nApply this variation: {prompt}"
                    );
                }
            }
        }
        if context_prefix.is_empty() {
            prompt.to_string()
        } else {
            format!("{context_prefix}{prompt}")
        }
    }
}

fn parse_pattern_json(text: &str, steps: usize) -> Option<(Pattern, Option<i64>, HashMap<String, HashMap<String, i64>>, Option<String>)> {
    let mut stripped = text.trim();
    if stripped.starts_with("```") {
        stripped = stripped.split('\n').nth(1).unwrap_or(stripped);
        stripped = stripped.rsplit("```").nth(1).unwrap_or(stripped).trim();
    }
    let data: Map<String, Value> = serde_json::from_str(stripped).ok()?;
    coerce_pattern_dict(&data, steps)
}

fn strip_markdown(text: &str) -> String {
    let mut t = text.to_string();
    for (pat, rep) in [
        (r"\*\*(.+?)\*\*", "$1"),
        (r"__(.+?)__", "$1"),
        (r"\*(.+?)\*", "$1"),
        (r"`(.+?)`", "$1"),
    ] {
        t = Regex::new(pat).unwrap().replace_all(&t, rep).into_owned();
    }
    t.trim().to_string()
}

fn emit_pattern_tool_schema(steps: usize) -> Map<String, Value> {
    let step_arr = json!({"type":"array","minItems":steps,"maxItems":steps,"items":{"type":"integer","minimum":0,"maximum":127}});
    let mut props = Map::new();
    for t in TRACK_NAMES {
        props.insert(t.to_string(), step_arr.clone());
    }
    Map::from_iter([
        ("name".into(), json!("emit_pattern")),
        ("description".into(), json!("Submit the complete drum pattern as structured data.")),
        ("input_schema".into(), json!({"type":"object","properties": props, "required": TRACK_NAMES})),
    ])
}

#[cfg(test)]
mod tests {
    use super::*;
    use digitakt_engine::EventBus;
    use std::sync::atomic::{AtomicUsize, Ordering};

    struct MockClient {
        tool: Map<String, Value>,
    }

    impl LlmClient for MockClient {
        fn messages_with_tool(
            &self,
            _model: &str,
            _max_tokens: usize,
            _system: &str,
            _user: &str,
            _tool_name: &str,
            _tool_schema: Map<String, Value>,
        ) -> Result<(String, Option<Map<String, Value>>), String> {
            Ok((String::new(), Some(self.tool.clone())))
        }

        fn messages_text(
            &self,
            _model: &str,
            _max_tokens: usize,
            _system: &str,
            _messages: &[(String, String)],
        ) -> Result<String, String> {
            Ok("help\nIMPLEMENTABLE: NO".into())
        }
    }

    #[test]
    fn tool_use_emits_generation_complete() {
        let state = Arc::new(AppState::new());
        let bus = Arc::new(EventBus::new());
        let n = Arc::new(AtomicUsize::new(0));
        let c = n.clone();
        bus.subscribe(
            "generation_complete",
            Arc::new(move |_| {
                c.fetch_add(1, Ordering::SeqCst);
            }),
        );
        let mut tool = Map::new();
        for t in TRACK_NAMES {
            tool.insert(t.to_string(), json!(vec![0_i64; 16]));
        }
        tool.insert("kick".into(), json!([100, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0]));
        tool.insert("bpm".into(), json!(135));
        let gen = Generator::new(state, bus.clone(), Arc::new(MockClient { tool }));
        gen.generate("heavy kick", false);
        std::thread::sleep(std::time::Duration::from_millis(50));
        assert_eq!(n.load(Ordering::SeqCst), 1);
    }
}
