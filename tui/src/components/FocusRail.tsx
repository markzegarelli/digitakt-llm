import React from "react";
import { Box, Text } from "ink";
import { theme } from "../theme.js";
import type { FocusPanel } from "../types.js";

interface FocusRailProps {
  focus: FocusPanel;
  showLog: boolean;
}

function NavLine({ active, label }: { active: boolean; label: string }) {
  return (
    <Text bold color={active ? theme.accent : theme.textDim}>
      {active ? ">" : " "}{" "}{label}
    </Text>
  );
}

export function FocusRail({ focus, showLog }: FocusRailProps) {
  return (
    <Box
      flexDirection="column"
      borderStyle="single"
      borderColor={theme.border}
      paddingX={1}
      width={12}
      flexShrink={0}
    >
      <Text bold color={theme.accent}>DTK</Text>
      <Text color={theme.textFaint}>{"\u2500".repeat(8)}</Text>
      <NavLine active={focus === "pattern"} label="SEQ" />
      <NavLine active={focus === "cc"} label="MIX" />
      {showLog && <NavLine active={focus === "log"} label="LOG" />}
      <NavLine active={focus === "prompt"} label="CMD" />
      <Box marginTop={1}>
        <Text color={theme.textFaint}>TAB cycle</Text>
      </Box>
    </Box>
  );
}
