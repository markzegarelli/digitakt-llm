//! Load `.env` for the Rust server (parity with Python `load_dotenv()`).

use std::path::{Path, PathBuf};

fn push_ancestor_envs(start: &Path, out: &mut Vec<PathBuf>, max_depth: usize) {
    let mut cur = Some(start);
    for _ in 0..max_depth {
        let Some(dir) = cur else { break };
        out.push(dir.join(".env"));
        cur = dir.parent();
    }
}

fn app_data_env_path() -> Option<PathBuf> {
    let home = std::env::var_os("HOME")?;
    #[cfg(target_os = "macos")]
    let path = PathBuf::from(home).join("Library/Application Support/com.digitakt.llm/.env");
    #[cfg(target_os = "windows")]
    let path = PathBuf::from(std::env::var_os("APPDATA")?)
        .join("com.digitakt.llm")
        .join(".env");
    #[cfg(all(not(target_os = "macos"), not(target_os = "windows")))]
    let path = PathBuf::from(home).join(".local/share/com.digitakt.llm/.env");
    Some(path)
}

/// Collect `.env` paths from least to most specific (later entries override earlier).
pub fn env_candidates(patterns_dir: &Path) -> Vec<PathBuf> {
    let mut paths: Vec<PathBuf> = Vec::new();

    if let Ok(cwd) = std::env::current_dir() {
        push_ancestor_envs(&cwd, &mut paths, 8);
    }
    if let Ok(abs) = patterns_dir.canonicalize() {
        if let Some(parent) = abs.parent() {
            paths.push(parent.join(".env"));
        }
    } else if let Some(parent) = patterns_dir.parent() {
        paths.push(parent.join(".env"));
    }
    if let Some(p) = app_data_env_path() {
        paths.push(p);
    }
    if let Ok(explicit) = std::env::var("DIGITAKT_ENV_FILE") {
        paths.push(PathBuf::from(explicit));
    }

    let mut unique = Vec::new();
    for p in paths {
        if !unique.iter().any(|u| u == &p) {
            unique.push(p);
        }
    }
    unique
}

/// Load `.env` files; more specific paths override earlier ones.
pub fn load_env_files(patterns_dir: &Path) {
    for path in env_candidates(patterns_dir) {
        if path.is_file() {
            let _ = dotenvy::from_path_override(path);
        }
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use std::fs;
    use tempfile::tempdir;

    #[test]
    fn explicit_env_file_wins_over_earlier() {
        let dir = tempdir().unwrap();
        let patterns = dir.path().join("patterns");
        fs::create_dir_all(&patterns).unwrap();
        let low = dir.path().join(".env");
        let high = dir.path().join("override.env");
        fs::write(&low, "ANTHROPIC_API_KEY=from-low\n").unwrap();
        fs::write(&high, "ANTHROPIC_API_KEY=from-high\n").unwrap();

        std::env::set_var("DIGITAKT_ENV_FILE", high.to_str().unwrap());
        load_env_files(&patterns);
        assert_eq!(
            std::env::var("ANTHROPIC_API_KEY").unwrap(),
            "from-high"
        );
        std::env::remove_var("DIGITAKT_ENV_FILE");
        std::env::remove_var("ANTHROPIC_API_KEY");
    }

    #[test]
    fn patterns_parent_env_is_a_candidate() {
        let dir = tempdir().unwrap();
        let patterns = dir.path().join("patterns");
        fs::create_dir_all(&patterns).unwrap();
        fs::write(dir.path().join(".env"), "TEST_ENV_MARKER=patterns-parent\n").unwrap();

        let candidates = env_candidates(&patterns);
        let parent_env = dir.path().canonicalize().unwrap().join(".env");
        assert!(
            candidates.iter().any(|p| p.canonicalize().ok().as_ref() == Some(&parent_env)),
            "expected patterns parent .env in candidates: {candidates:?}"
        );
    }
}
