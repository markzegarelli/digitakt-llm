import { describe, it, expect, vi } from "vitest";
import { handlePaneKeys } from "../src/hooks/useKeyboard.js";
import { defaultUiState } from "../src/lib/viewModel.js";
import type { WorkbenchView } from "../src/lib/viewModel.js";

function minimalView(mode: WorkbenchView["ui"]["mode"]): WorkbenchView {
  const ui = { ...defaultUiState(), mode, lastWorkbench: "MIX" as const };
  return {
    ui,
    playing: false,
    bpm: 120,
    swing: 0,
    bar: 1,
    stepLen: 16,
    globalStep: null,
    playhead: 0,
    midiPort: "—",
    midiConnected: false,
    seqMode: "standard",
    chainLabel: null,
    version: "test",
    tracks: [],
  };
}

describe("handlePaneKeys", () => {
  it("Tab cycles CHAT forward to SEQ", () => {
    const dispatch = vi.fn();
    const handlers = { playStop: vi.fn() } as never;
    const e = {
      key: "Tab",
      shiftKey: false,
      preventDefault: vi.fn(),
      stopPropagation: vi.fn(),
      stopImmediatePropagation: vi.fn(),
    };
    const handled = handlePaneKeys(e, minimalView("CHAT"), dispatch, handlers, undefined);
    expect(handled).toBe(true);
    expect(dispatch).toHaveBeenCalledWith({ type: "MODE", value: "SEQ" });
    expect(e.preventDefault).toHaveBeenCalled();
  });

  it("Space calls playStop in SEQ mode", () => {
    const dispatch = vi.fn();
    const playStop = vi.fn();
    const handlers = { playStop } as never;
    const e = {
      key: " ",
      shiftKey: false,
      preventDefault: vi.fn(),
      stopPropagation: vi.fn(),
    };
    handlePaneKeys(e, minimalView("SEQ"), dispatch, handlers);
    expect(playStop).toHaveBeenCalled();
    expect(e.preventDefault).toHaveBeenCalled();
  });

  it("Space does not call playStop in CHAT mode when chat input is focused", () => {
    const prevDoc = globalThis.document;
    globalThis.document = {
      activeElement: { tagName: "INPUT" },
    } as Document;

    const dispatch = vi.fn();
    const playStop = vi.fn();
    const handlers = { playStop } as never;
    const e = {
      key: " ",
      shiftKey: false,
      preventDefault: vi.fn(),
      stopPropagation: vi.fn(),
    };
    const handled = handlePaneKeys(e, minimalView("CHAT"), dispatch, handlers);
    expect(handled).toBe(false);
    expect(playStop).not.toHaveBeenCalled();
    expect(e.preventDefault).not.toHaveBeenCalled();
    globalThis.document = prevDoc;
  });

  it("Space calls playStop in CHAT mode when input is not focused", () => {
    const playStop = vi.fn();
    const handlers = { playStop } as never;
    const e = {
      key: " ",
      shiftKey: false,
      preventDefault: vi.fn(),
      stopPropagation: vi.fn(),
    };
    handlePaneKeys(e, minimalView("CHAT"), vi.fn(), handlers);
    expect(playStop).toHaveBeenCalled();
  });

  it("Space does not call playStop in CMD mode", () => {
    const playStop = vi.fn();
    const handlers = { playStop } as never;
    const e = {
      key: " ",
      shiftKey: false,
      preventDefault: vi.fn(),
      stopPropagation: vi.fn(),
    };
    handlePaneKeys(e, minimalView("CMD"), vi.fn(), handlers);
    expect(playStop).not.toHaveBeenCalled();
  });
});
