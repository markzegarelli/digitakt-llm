/**
 * TRIG rows that support track-wide ("ALL") editing.
 * 0=prob, 1=vel, 2=note, 3=gate, 4=cond
 */
export function canFieldUseTrackWide(field: number): boolean {
  return field === 0 || field === 1 || field === 3;
}

/**
 * For note row, Enter with an empty numeric buffer should restore inheritance
 * from track pitch by clearing the per-step override.
 */
export function shouldClearNoteOverrideOnCommit(field: number, inputBuffer: string): boolean {
  return field === 2 && inputBuffer.trim().length === 0;
}

/**
 * For note row, Backspace/Delete with an empty numeric buffer clears the
 * per-step note override.
 */
export function shouldClearNoteOverrideOnDelete(field: number, inputBuffer: string): boolean {
  return field === 2 && inputBuffer.length === 0;
}
