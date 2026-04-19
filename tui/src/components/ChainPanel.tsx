import React from "react";
import { Box, Text } from "ink";
import { theme } from "../theme.js";

interface ChainPanelProps {
  chain: string[];
  chainIndex: number;
  chainAuto: boolean;
  queuedIndex: number | null;
  armed: boolean;
  stripFocused?: boolean;
  selectedSlotIdx?: number;
}

export function ChainPanel({
  chain,
  chainIndex,
  chainAuto,
  queuedIndex,
  armed,
  stripFocused = false,
  selectedSlotIdx = 0,
}: ChainPanelProps) {
  if (chain.length === 0) return null;

  const sep = " \u203a ";

  return (
    <Box
      flexDirection="row"
      flexWrap="wrap"
      paddingX={1}
      paddingY={0}
      borderStyle="single"
      borderColor={stripFocused ? theme.borderActive : theme.border}
      flexShrink={0}
    >
      <Text bold color={stripFocused ? theme.accent : theme.textDim}>
        CHAIN
        {stripFocused ? " \u25B8" : ""}
      </Text>
      <Text color={theme.textGhost}>{sep}</Text>
      {chain.map((name, i) => {
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
              {isSel && !isCurrent ? "\u203a " : ""}
              {name}
            </Text>
          </React.Fragment>
        );
      })}
      {chainAuto && (
        <>
          <Text color={theme.textGhost}>{"  "}</Text>
          <Text color={theme.textFaint}>LOOP</Text>
        </>
      )}
      <Text color={theme.textGhost}>{"  "}</Text>
      {queuedIndex !== null && chain[queuedIndex] !== undefined ? (
        <Text color={theme.warn} bold>
          {`\u23ED ${chain[queuedIndex]}`}
          <Text color={theme.textFaint}>
            {armed ? "  @1" : "  next bar"}
          </Text>
        </Text>
      ) : (
        <Text color={theme.textFaint}>
          {stripFocused
            ? "\u2190\u2192 slot  n next  N fire  esc"
            : "c focus  n next  N fire"}
        </Text>
      )}
    </Box>
  );
}
