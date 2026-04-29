import React from "react";
import { render } from "ink";
import { LfoPanel } from "./LfoPanel.js";

const MOCK_WIDTH = 36;
const GRAPH_ROWS = 4;

const mockLfo = {
  "cc:attack": {
    shape: "sine" as const,
    depth: 50,
    rate: { num: 1, den: 1 },
    phase: 0,
    target: "cc:kick:attack",
  },
};

const mockLfoOut = {
  "cc:attack": { value: 64, base: 50 },
};

// --- OFF state (no waveform) ---
const { waitUntilExit: w1, unmount: u1 } = render(
  <LfoPanel
    width={MOCK_WIDTH}
    graphBrailleRows={GRAPH_ROWS}
    targetKey="cc:attack"
    lfo={mockLfo}
    lfoOut={mockLfoOut}
    patternLength={16}
    currentStep={4}
    globalStep={4}
    isFocused
    isEditing
    editField={0}
    editDraft={{ shape: "off", depth: 50, num: 1, den: 1, phase: 0 }}
  />,
  { exitOnCtrlC: false },
);
setTimeout(() => u1(), 80);
await w1();

process.stdout.write("\n--- with sine waveform ---\n\n");

// --- SINE state (with waveform) ---
const { waitUntilExit: w2, unmount: u2 } = render(
  <LfoPanel
    width={MOCK_WIDTH}
    graphBrailleRows={GRAPH_ROWS}
    targetKey="cc:attack"
    lfo={mockLfo}
    lfoOut={mockLfoOut}
    patternLength={16}
    currentStep={4}
    globalStep={4}
    isFocused
    isEditing
    editField={0}
    editDraft={{ shape: "sine", depth: 50, num: 1, den: 1, phase: 0 }}
  />,
  { exitOnCtrlC: false },
);
setTimeout(() => u2(), 80);
await w2();

process.stdout.write("\n--- display: no def ---\n\n");

const { waitUntilExit: w3, unmount: u3 } = render(
  <LfoPanel
    width={MOCK_WIDTH}
    graphBrailleRows={GRAPH_ROWS}
    targetKey="cc:filter"
    lfo={{}}
    lfoOut={{}}
    patternLength={16}
    currentStep={4}
    globalStep={4}
    isFocused={false}
    isEditing={false}
    editField={0}
    editDraft={{ shape: "off", depth: 50, num: 1, den: 1, phase: 0 }}
  />,
  { exitOnCtrlC: false },
);
setTimeout(() => u3(), 80);
await w3();

process.stdout.write("\n--- display: has def ---\n\n");

const { waitUntilExit: w4, unmount: u4 } = render(
  <LfoPanel
    width={MOCK_WIDTH}
    graphBrailleRows={GRAPH_ROWS}
    targetKey="cc:attack"
    lfo={mockLfo}
    lfoOut={mockLfoOut}
    patternLength={16}
    currentStep={4}
    globalStep={4}
    isFocused={false}
    isEditing={false}
    editField={0}
    editDraft={{ shape: "off", depth: 50, num: 1, den: 1, phase: 0 }}
  />,
  { exitOnCtrlC: false },
);
setTimeout(() => u4(), 80);
await w4();
