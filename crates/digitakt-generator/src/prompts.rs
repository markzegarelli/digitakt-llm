//! Cached system prompts extracted verbatim from Python.

pub fn system_prompt_for_steps(steps: usize) -> String {
    match steps {
        8 => include_str!("../prompts/system_8.txt").to_string(),
        32 => include_str!("../prompts/system_32.txt").to_string(),
        _ => include_str!("../prompts/system_16.txt").to_string(),
    }
}

pub fn help_system_prompt() -> String {
    include_str!("../prompts/help_system.txt").to_string()
}

pub fn classify_system_prompt() -> String {
    include_str!("../prompts/classify_system.txt").to_string()
}
