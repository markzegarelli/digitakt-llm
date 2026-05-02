import React from "react";
import { Box, Text } from "ink";
import { theme } from "../theme.js";

function trunc(s: string, max: number): string {
  if (max <= 0) return "";
  if (s.length <= max) return s;
  if (max <= 1) return "\u2026";
  return `${s.slice(0, max - 1)}\u2026`;
}

interface ChainPanelProps {
  chain: string[];
  chainIndex: number;
  chainAuto: boolean;
  queuedIndex: number | null;
  armed: boolean;
  stripFocused?: boolean;
  selectedSlotIdx?: number;
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
  termCols,
  termRows,
}: ChainPanelProps) {
  if (chain.length === 0) return null;

  const innerW = Math.max(8, termCols - 4);
  const useCompact = chain.length > 8 || termRows < 22;
  const cellW = Math.max(3, Math.floor(innerW / chain.length) - 1);
  const nameMax = Math.max(4, Math.min(14, cellW + 2));

  const hintLong =
    "c focus \u00B7 n next \u00B7 N fire \u00B7 Shift+1\u20139 fill (US) \u00B7 f\u2192digit \u00B7 /chain fill n";
  const hintShort =
    termCols >= 72 ? hintLong : "c n N \u00B7 Shift+digit fill \u00B7 f\u21921\u20139 \u00B7 /chain fill n";

  const sep = " \u203a ";

  if (useCompact) {
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
        <Box flexDirection="row" flexWrap="wrap">
          <Text bold color={stripFocused ? theme.accent : theme.textDim}>
            CHAIN
            {stripFocused ? " \u25B8" : ""}
          </Text>
          <Text color={theme.textGhost}>{sep}</Text>
          {chain.map((name, i) => {
            const slot = i + 1;
            const isCurrent = i === chainIndex;
            const isQueued = queuedIndex !== null && i === queuedIndex;
            const isSel = stripFocused && i === selectedSlotIdx;
            return (
              <React.Fragment key={`${name}-${i}`}>
                {i > 0 ? <Text color={theme.textGhost}>{sep}</Text> : null}
                <Text
                  bold={isCurrent || isQueued || isSel}
                  color={
                    isCurrent
                      ? theme.accentInk
                      : isQueued
                        ? armed
                          ? theme.error
                          : theme.warn
                        : isSel
                          ? theme.accent
                          : theme.textDim
                  }
                  backgroundColor={isCurrent ? theme.accent : undefined}
                >
                  [{slot}]{trunc(name, nameMax)}
                </Text>
              </React.Fragment>
            );
          })}
          {chainAuto ? (
            <>
              <Text color={theme.textGhost}>{"  "}</Text>
              <Text color={theme.textFaint}>LOOP</Text>
            </>
          ) : null}
          {queuedIndex !== null && chain[queuedIndex] !== undefined ? (
            <>
              <Text color={theme.textGhost}>{"  "}</Text>
              <Text color={theme.warn} bold>
                {`\u23ED${queuedIndex + 1}`}
                <Text color={theme.textFaint}>{armed ? "@1" : " bar"}</Text>
              </Text>
            </>
          ) : null}
        </Box>
        <Box flexDirection="row" marginTop={0}>
          <Text color={theme.textFaint} wrap="truncate">
            {hintShort}
          </Text>
        </Box>
      </Box>
    );
  }

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
      <Box flexDirection="row" marginBottom={0}>
        <Text bold color={stripFocused ? theme.accent : theme.textDim}>
          CHAIN
          {stripFocused ? " \u25B8" : ""}
        </Text>
      </Box>
      <Box flexDirection="row" flexWrap="nowrap" width={innerW}>
        {chain.map((name, i) => {
          const slot = i + 1;
          const isCurrent = i === chainIndex;
          const isQueued = queuedIndex !== null && i === queuedIndex;
          const isSel = stripFocused && i === selectedSlotIdx;
          const w = Math.max(3, cellW);
          const numColor =
            isCurrent ? theme.accentInk
            : isQueued ? (armed ? theme.error : theme.warn)
            : isSel ? theme.accent
            : theme.textGhost;
          const numBg = isCurrent ? theme.accent : undefined;
          return (
            <Box key={`slot-${i}`} width={w + 1} marginRight={0} flexDirection="column">
              <Text
                bold
                color={numColor}
                backgroundColor={numBg}
                wrap="truncate"
              >
                {String(slot).padStart(Math.max(1, w - 1), " ")}
              </Text>
              <Text
                color={isCurrent ? theme.accentInk : theme.textDim}
                backgroundColor={isCurrent ? theme.accent : undefined}
                wrap="truncate"
              >
                {trunc(name, nameMax)}
              </Text>
            </Box>
          );
        })}
      </Box>
      <Box flexDirection="row" flexWrap="wrap" marginTop={0}>
        {queuedIndex !== null && chain[queuedIndex] !== undefined ? (
          <Text color={theme.warn} bold>
            {`\u23ED ${queuedIndex + 1}:${chain[queuedIndex]}`}
            <Text color={theme.textFaint}>
              {armed ? "  @1" : "  next bar"}
            </Text>
          </Text>
        ) : (
          <Text color={theme.textFaint}>{stripFocused ? "\u2190\u2192  n  N  esc  \u00B7  " : ""}</Text>
        )}
        <Text color={theme.textFaint} wrap="truncate">
          {hintShort}
        </Text>
      </Box>
      {chainAuto ? (
        <Box flexDirection="row">
          <Text color={theme.textFaint}>AUTO-ADVANCE</Text>
        </Box>
      ) : null}
    </Box>
  );
}
