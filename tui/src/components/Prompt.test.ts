import { describe, expect, test } from "bun:test";
import {
  applyParamSuggestionAndAdvance,
  backspaceAtCursor,
  getFocusedParamSuggestions,
  getParamHintState,
  getPromptSuggestions,
  insertAtCursor,
  isInputAssistDismissedForText,
  moveCursorLeft,
  moveCursorRight,
  nextParamFocusIndex,
} from "./Prompt.js";

describe("prompt slash interaction helpers", () => {
  test("does not show parameter hints for partial command tokens", () => {
    expect(getParamHintState("/lo")).toEqual({ active: false, paramCount: 0 });
  });

  test("shows parameter hints for exact command tokens", () => {
    expect(getParamHintState("/lfo")).toEqual({ active: true, paramCount: 5 });
    expect(getParamHintState("/lfo ")).toEqual({ active: true, paramCount: 5 });
  });

  test("suppresses autocomplete suggestions when exact command is entered", () => {
    expect(getPromptSuggestions("/lo")).toContain("load");
    expect(getPromptSuggestions("/lfo")).toEqual([]);
  });

  test("cycles focused parameter index in strict tab mode", () => {
    expect(nextParamFocusIndex(0, 5, false)).toBe(1);
    expect(nextParamFocusIndex(4, 5, false)).toBe(0);
    expect(nextParamFocusIndex(0, 5, true)).toBe(4);
  });

  test("shows default suggestions for focused parameter", () => {
    const suggestions = getFocusedParamSuggestions("/lfo ", 1);
    expect(suggestions[0]).toBe("sine");
    expect(suggestions).toContain("triangle");
  });

  test("filters focused parameter suggestions by typed value", () => {
    expect(getFocusedParamSuggestions("/lfo target s", 1)).toEqual(["sine", "square", "saw"]);
  });

  test("advances focused field after accepting suggestion", () => {
    expect(applyParamSuggestionAndAdvance("/lfo", 0, 3, "cc:kick:filter_cutoff")).toEqual({
      text: "/lfo cc:kick:filter_cutoff",
      nextFocusIdx: 1,
    });
    expect(applyParamSuggestionAndAdvance("/lfo target shape depth", 2, 3, "50")).toEqual({
      text: "/lfo target shape 50",
      nextFocusIdx: 2,
    });
  });

  test("keeps input assist dismissed until input is cleared", () => {
    expect(isInputAssistDismissedForText("/load")).toBe(true);
    expect(isInputAssistDismissedForText("hello world")).toBe(true);
    expect(isInputAssistDismissedForText("")).toBe(false);
    expect(isInputAssistDismissedForText("   ")).toBe(false);
  });

  test("supports cursor movement and backspace for free-text editing", () => {
    const start = { text: "/load foo", cursor: "/load foo".length };
    const movedLeft = moveCursorLeft(start);
    expect(movedLeft).toEqual({ text: "/load foo", cursor: 8 });

    const afterBackspace = backspaceAtCursor(movedLeft);
    expect(afterBackspace).toEqual({ text: "/load fo", cursor: 7 });

    const afterInsert = insertAtCursor(afterBackspace, "x");
    expect(afterInsert).toEqual({ text: "/load fxo", cursor: 8 });

    const movedRight = moveCursorRight(afterInsert);
    expect(movedRight.cursor).toBe(9);
  });
});
