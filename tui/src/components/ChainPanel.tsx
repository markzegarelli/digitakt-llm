import React from "react";
import { Box, Text } from "ink";
import { theme } from "../theme.js";

interface ChainPanelProps {
  chain: string[];
  chainIndex: number;
  chainAuto: boolean;
  queuedIndex: number | null;
  armed: boolean;
}

export function ChainPanel({
  chain,
  chainIndex,
  chainAuto,
  queuedIndex,
  armed,
}: ChainPanelProps) {
  if (chain.length === 0) return null;

  return (
    <Box borderStyle="single" borderColor={theme.border} paddingX={1} flexShrink={0}>
      <Text bold color={theme.textDim}>SET </Text>
      {chain.map((name, i) => {
        const isCurrent = i === chainIndex;
        const isQueued = queuedIndex !== null && i === queuedIndex;
        const isNextAuto =
          i === chainIndex + 1 || (chainAuto && chainIndex === chain.length - 1 && i === 0);
        return (
          <React.Fragment key={`${name}-${i}`}>
            {i > 0 && <Text color={theme.textFaint}> {"\u2192"} </Text>}
            <Text
              bold={isCurrent}
              color={
                isCurrent
                  ? theme.accent
                  : isQueued
                    ? (armed ? theme.error : theme.warn)
                    : isNextAuto
                      ? theme.warn
                      : theme.textDim
              }
            >
              {isCurrent ? `[${name.toUpperCase()}]` : name}
            </Text>
            {isCurrent && <Text color={theme.accentMuted}> NOW</Text>}
            {isQueued && !armed && <Text color={theme.warn}> QUEUED</Text>}
            {isQueued && armed && <Text color={theme.error}> ARMED@1</Text>}
          </React.Fragment>
        );
      })}
      {chainAuto && <Text color={theme.textFaint}>  LOOP</Text>}
    </Box>
  );
}
