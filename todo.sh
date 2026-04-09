# Add to ~/.zshrc:
#   source /Users/markzegarelli/projects/digitakt_llm/todo.sh

todo() {
  local file="/Users/markzegarelli/projects/digitakt_llm/TODO.md"
  if [[ -z "$1" ]]; then
    cat "$file"
    return
  fi
  local date
  date=$(date "+%Y-%m-%d")
  printf "- [ ] %s (%s)\n" "$*" "$date" >> "$file"
  echo "Added: $*"
}
