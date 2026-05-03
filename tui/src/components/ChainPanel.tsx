import React from "react";
import { Box, Text } from "ink";
import { theme } from "../theme.js";

/** Width budget: outer panel width termCols; paddingX=1 → inner strip ≈ termCols-2 (border eats 2). */
function trunc(s: string, max: number): string {
  if (max <= 0) return "";
  if (s.length <= max) return s;
  if (max <= 1) return "\u2026";
  return `${s.slice(0, max - 1)}\u2026`;
}

/** Parse chain-slot fill cue from optimistic/API `fill_queued` (`#2`, `#2:name`). */
function parseFillQueuedChainSlot(fillQueued: string | false): number | null {
  if (fillQueued === false) return null;
  const m = /^#(\d+)/.exec(fillQueued);
  if (!m) return null;
  const n = parseInt(m[1], 10);
  return Number.isFinite(n) && n >= 1 ? n - 1 : null;
}

function fillCueIndex(chain: string[], fillQueued: string | false): number | null {
  const bySlot = parseFillQueuedChainSlot(fillQueued);
  if (bySlot !== null) return bySlot;
  if (fillQueued === false) return null;
  const idx = chain.indexOf(fillQueued);
  return idx >= 0 ? idx : null;
}

interface ChainPanelProps {
  chain: string[];
  chainIndex: number;
  chainAuto: boolean;
  queuedIndex: number | null;
  armed: boolean;
  stripFocused?: boolean;
  selectedSlotIdx?: number;
  fillQueued?: string | false;
  fillActive?: boolean;
  termCols: number;
  termRows: number;
}

export function ChainPanel({
  chain,
  chainIndex,
  chainAuto,
  queuedIndex,
  armed,
  stripFocused = false,
  selectedSlotIdx = 0,
  fillQueued = false,
  fillActive = false,
  termCols,
  termRows,
}: ChainPanelProps) {
  if (chain.length === 0) return null;

  const innerW = Math.max(8, termCols - 2);
  const useShortHint = termRows < 22 || termCols < 72;
  const hintLong =
    "c focus \u00B7 n next \u00B7 N fire \u00B7 Shift+1\u20139 fill (US) \u00B7 f\u2192digit \u00B7 /chain fill n";
  const hintShort =
    termCols >= 72 ? hintLong : "c n N \u00B7 Shift+digit fill \u00B7 f\u21921\u20139 \u00B7 /chain fill n";

  const boxFrame = 4;
  const approxBracket = 4;
  const nameMax = Math.max(
    4,
    Math.min(
      28,
      Math.floor((innerW - chain.length * (boxFrame + approxBracket)) / Math.max(1, chain.length)),
    ),
  );

  return (
    <Box
      flexDirection="column"
      width={termCols}
      paddingX={1}
      paddingY={0}
      borderStyle="single"
      borderColor={stripFocused ? theme.borderActive : theme.border}
      flexShrink={0}
    >
      <Box flexDirection="row" flexWrap="wrap" alignItems="flex-start">
        <Box flexDirection="row" marginRight={1} flexShrink={0}>
          <Text bold color={stripFocused ? theme.accent : theme.textDim}>
            CHAIN
            {stripFocused ? " \u25B8" : ""}
          </Text>
          <Text color={fillActive ? theme.good : theme.surface}> FILL</Text>
        </Box>
        {chain.map((name, i) => {
          const slot = i + 1;
          const isCurrent = i === chainIndex;
          const transitionQueued = queuedIndex !== null && i === queuedIndex;
          const transitionArmed = transitionQueued && armed;
          const fillIdx = fillCueIndex(chain, fillQueued);
          const fillCue = fillIdx === i;
          const isSel = stripFocused && i === selectedSlotIdx;

          let borderColor = theme.border;
          if (fillCue) borderColor = theme.good;
          else if (transitionArmed) borderColor = theme.error;
          else if (transitionQueued) borderColor = theme.warn;
          else if (isCurrent || isSel) borderColor = theme.borderActive;

          // Slots with an active state get a border; inactive slots are plain text
          // with paddingX=2 to preserve the same total width (border eats 1 char per side).
          const hasBorder = isCurrent || isSel || transitionQueued || transitionArmed || fillCue;
          const onAccent = isCurrent;
          const mainColor = onAccent ? theme.accent : theme.textDim;
          const nameColor = onAccent ? theme.accent : theme.text;
          // Fixed 6-char slots per cue type \u2014 prevents layout shift as cues appear/disappear.
          // " \u00B7fill" and " \u00B7next" are each 6 chars; "@1" padded to match.
          const fillCueStr  = fillCue        ? "\u00A0\u00B7fill" : "      ";
          const transCueStr = transitionArmed  ? "\u00A0\u00B7@1  "
                            : transitionQueued ? "\u00A0\u00B7next"
                            :                    "      ";

          return (
            <Box
              key={`${name}-${i}`}
              borderStyle={hasBorder ? "single" : undefined}
              borderColor={hasBorder ? borderColor : undefined}
              paddingX={hasBorder ? 1 : 2}
              marginRight={1}
              marginBottom={0}
              flexShrink={0}
              flexDirection="column"
            >
              <Text wrap="truncate">
                <Text bold color={mainColor}>
                  {`[${slot}]`}
                </Text>
                <Text color={nameColor}>{` ${trunc(name, nameMax)}`}</Text>
                <Text color={fillCue ? theme.good : theme.textFaint}>{fillCueStr}</Text>
                <Text color={transitionArmed ? theme.error : transitionQueued ? theme.warn : theme.textFaint}>{transCueStr}</Text>
              </Text>
            </Box>
          );
        })}
        {chainAuto ? (
          <Box marginLeft={0} flexShrink={0}>
            <Text color={theme.textFaint}>AUTO</Text>
          </Box>
        ) : null}
      </Box>
      <Box flexDirection="row" marginTop={0}>
        <Text color={theme.textFaint} wrap="truncate">
          {useShortHint ? hintShort : hintLong}
        </Text>
      </Box>
    </Box>
  );
}
