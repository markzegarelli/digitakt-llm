//! Injectable beat-generation context (parity with `core/injectable_profiles.py`).

use regex::Regex;
use std::collections::HashMap;
use std::sync::LazyLock;

#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum ProfileCategory {
    Genre,
    DrumMachine,
}

#[derive(Debug, Clone)]
pub struct InjectableProfile {
    pub id: &'static str,
    pub category: ProfileCategory,
    pub aliases: &'static [&'static str],
    pub body: &'static str,
}

const AMBIENT_BODY: &str = include_str!("../prompts/ambient_body.txt");

const _AMBIENT_BODY_INLINE: &str = "AMBIENT MODE CONTEXT (use instead of standard drum conventions):\n\
This is an ambient / drone / downtempo request. The 8 fixed track slots are\n\
named after drums (kick/snare/tom/clap/bell/hihat/openhat/cymbal) but should\n\
be REPURPOSED as atmospheric voices. Do not program a typical beat.\n";

const LINNDRUM_BODY: &str = include_str!("../prompts/linndrum_body.txt");
const CR78_BODY: &str = include_str!("../prompts/cr78_body.txt");

static PROFILES: LazyLock<Vec<InjectableProfile>> = LazyLock::new(|| {
    vec![
        InjectableProfile {
            id: "ambient",
            category: ProfileCategory::Genre,
            aliases: &[
                "dark ambient",
                "deep listening",
                "ambient",
                "drone",
                "downtempo",
                "soundscape",
            ],
            body: AMBIENT_BODY,
        },
        InjectableProfile {
            id: "linndrum",
            category: ProfileCategory::DrumMachine,
            aliases: &[
                "linndrum",
                "linn drum",
                "linn lm-2",
                "lm-2",
                "lm2",
                "lm 2",
            ],
            body: LINNDRUM_BODY,
        },
        InjectableProfile {
            id: "cr78",
            category: ProfileCategory::DrumMachine,
            aliases: &[
                "roland cr-78",
                "roland cr78",
                "compurhythm 78",
                "cr-78",
                "cr78",
            ],
            body: CR78_BODY,
        },
    ]
});

static PROFILES_BY_ID: LazyLock<HashMap<&'static str, InjectableProfile>> = LazyLock::new(|| {
    PROFILES
        .iter()
        .map(|p| (p.id, p.clone()))
        .collect()
});

const NEGATION_WORDS: &[&str] = &["no", "not", "without", "non"];

fn is_negated_match(prompt_lowered: &str, start: usize) -> bool {
    if start > 0 && prompt_lowered.as_bytes().get(start - 1) == Some(&b'-') {
        let prefix = &prompt_lowered[prompt_lowered[..start].chars().count().saturating_sub(4).max(0)..start];
        if prompt_lowered.get(start.saturating_sub(4)..start) == Some("non-") {
            return true;
        }
        let _ = prefix;
    }
    let window = &prompt_lowered[..start];
    let re = Regex::new(r"[a-z]+").unwrap();
    let tokens: Vec<&str> = re.find_iter(window).map(|m| m.as_str()).collect();
    tokens
        .iter()
        .rev()
        .take(4)
        .any(|t| NEGATION_WORDS.contains(t))
}

fn detect_profile_in_category(prompt: &str, category: ProfileCategory) -> Option<String> {
    let lowered = prompt.to_lowercase();
    let mut matches: Vec<(usize, usize, String)> = Vec::new();
    for p in PROFILES.iter() {
        if p.category != category {
            continue;
        }
        for alias in p.aliases {
            let pattern = format!(r"\b{}\b", regex::escape(alias));
            let re = Regex::new(&pattern).unwrap();
            for m in re.find_iter(&lowered) {
                if is_negated_match(&lowered, m.start()) {
                    continue;
                }
                matches.push((m.start(), m.end(), p.id.to_string()));
            }
        }
    }
    if matches.is_empty() {
        return None;
    }
    matches.sort_by(|a, b| a.0.cmp(&b.0).then(b.1.saturating_sub(b.0).cmp(&a.1.saturating_sub(a.0))));
    Some(matches[0].2.clone())
}

pub fn detect_genre_profile(prompt: &str) -> Option<String> {
    detect_profile_in_category(prompt, ProfileCategory::Genre)
}

pub fn detect_drum_machine_profile(prompt: &str) -> Option<String> {
    detect_profile_in_category(prompt, ProfileCategory::DrumMachine)
}

pub fn build_injectable_context_prefix(prompt: &str) -> String {
    let mut parts: Vec<&str> = Vec::new();
    if let Some(gid) = detect_genre_profile(prompt) {
        if let Some(p) = PROFILES_BY_ID.get(gid.as_str()) {
            parts.push(p.body);
        }
    }
    if let Some(mid) = detect_drum_machine_profile(prompt) {
        if let Some(p) = PROFILES_BY_ID.get(mid.as_str()) {
            parts.push(p.body);
        }
    }
    if parts.is_empty() {
        return String::new();
    }
    format!("{}\n", parts.join("\n"))
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn ambient_detected() {
        assert_eq!(detect_genre_profile("make a dark ambient loop"), Some("ambient".into()));
    }

    #[test]
    fn negated_ambient_skipped() {
        assert!(detect_genre_profile("not ambient techno").is_none());
    }

    #[test]
    fn linndrum_detected() {
        assert_eq!(
            detect_drum_machine_profile("linn drum groove"),
            Some("linndrum".into())
        );
    }
}
