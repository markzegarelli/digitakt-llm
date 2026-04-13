import React from "react";
import { Box, Text } from "ink";

interface ChainPanelProps {
  chain: string[];
  chainIndex: number;
  chainAuto: boolean;
}

export function ChainPanel({ chain, chainIndex, chainAuto }: ChainPanelProps) {
  if (chain.length === 0) return null;

  return (
    <Box borderStyle="single" borderColor="#333333" paddingX={1} flexShrink={0}>
      <Text color="#444444">CHAIN  </Text>
      {chain.map((name, i) => {
        const isCurrent = i === chainIndex;
        const isNext = i === chainIndex + 1 || (chainAuto && chainIndex === chain.length - 1 && i === 0);
        return (
          <React.Fragment key={`${name}-${i}`}>
            {i > 0 && <Text color="#333333"> {"-->"} </Text>}
            <Text color={isCurrent ? "#FF6B00" : isNext ? "#FFD700" : "#444444"} bold={isCurrent}>
              {isCurrent ? `[${name.toUpperCase()}]` : name}
            </Text>
          </React.Fragment>
        );
      })}
      {chainAuto && <Text color="#555555">  loop</Text>}
    </Box>
  );
}
