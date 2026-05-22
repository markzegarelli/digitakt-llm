import React from "react";
import type { WorkbenchView, TrackView } from "../../lib/viewModel.js";
import { muteIndicator } from "../../lib/muteUi.js";
import { StepNumberRow } from "../primitives/index.js";
import type { StepStyle } from "../constants.js";

export function Sequencer({
  view,
  focused,
  stepStyle,
}: {
  view: WorkbenchView;
  focused: boolean;
  stepStyle: StepStyle;
}) {
  const { ui, tracks, playing, playhead } = view;
  const labelW = 56;
  const rowH = 26;
  return (
    <div style={{ display: "flex", flexDirection: "column", height: "100%", minHeight: 0 }}>
      <div className="panel-subhead">
        <div>
          <span className={focused ? "y b" : "d b"}>SEQ</span>
          {" · "}
          <span className="d">
            track <span className={focused ? "y" : ""}>{tracks[ui.cursor.track]?.id}</span> · step{" "}
            <span className={focused ? "y" : ""}>{ui.cursor.step + 1}</span>
          </span>
        </div>
        <div className="d" style={{ fontSize: 10 }}>↑↓ track · ←→ step · m/q/Q mute</div>
      </div>
      <div className="scroll seq-body">
        <div style={{ display: "flex" }}>
          <div style={{ width: labelW, flexShrink: 0 }} />
          <StepNumberRow playing={playing} playhead={playhead} />
        </div>
        {tracks.map((t, ti) => (
          <SeqRow
            key={t.id}
            track={t}
            isActiveTrack={ui.cursor.track === ti}
            cursorStep={ui.cursor.step}
            playing={playing}
            playhead={playhead}
            focused={focused}
            stepStyle={stepStyle}
            labelW={labelW}
            rowH={rowH}
          />
        ))}
      </div>
    </div>
  );
}

function SeqRow(props: {
  track: TrackView;
  isActiveTrack: boolean;
  cursorStep: number;
  playing: boolean;
  playhead: number;
  focused: boolean;
  stepStyle: StepStyle;
  labelW: number;
  rowH: number;
}) {
  const { track, isActiveTrack, cursorStep, playing, playhead, focused, stepStyle, labelW, rowH } = props;
  const mute = muteIndicator(track.muted, track.muteStaged, track.muteArmed);
  return (
    <div style={{ display: "flex", height: rowH, alignItems: "center", opacity: track.muted ? 0.45 : 1 }}>
      <div
        style={{
          width: labelW,
          paddingRight: 8,
          fontSize: 12,
          flexShrink: 0,
          color: isActiveTrack ? "var(--yellow)" : "var(--text)",
          fontWeight: isActiveTrack ? 700 : 400,
        }}
      >
        {isActiveTrack && focused ? "> " : "  "}
        {track.id}
        {mute.badge === "M" ? <span className="r" style={{ fontSize: 9 }}> M</span> : null}
        {mute.badge === "Q" ? (
          <span className={mute.qArmed ? "r" : "y"} style={{ fontSize: 9 }}> Q</span>
        ) : null}
        {mute.badge === "MQ" ? (
          <>
            <span className="r" style={{ fontSize: 9 }}> M</span>
            <span className={mute.qArmed ? "r" : "y"} style={{ fontSize: 9 }}>Q</span>
          </>
        ) : null}
      </div>
      <div style={{ display: "grid", gridTemplateColumns: "repeat(16, minmax(0, 1fr))", flex: 1, minWidth: 0 }}>
        {track.trigs.map((trig, si) => (
          <SeqCell
            key={si}
            trig={trig}
            isActive={isActiveTrack && cursorStep === si}
            isHead={playing && Math.floor(playhead) === si}
            isMajor={si % 4 === 0}
            focused={focused}
            style={stepStyle}
            rowH={rowH}
          />
        ))}
      </div>
    </div>
  );
}

function SeqCell({
  trig,
  isActive,
  isHead,
  isMajor,
  focused,
  style,
  rowH,
}: {
  trig: TrackView["trigs"][0];
  isActive: boolean;
  isHead: boolean;
  isMajor: boolean;
  focused: boolean;
  style: StepStyle;
  rowH: number;
}) {
  let inner: React.ReactNode;
  if (style === "dots") {
    inner = (
      <span style={{ fontSize: 14, color: trig.on ? "var(--yellow)" : "var(--text-faint)" }}>
        {trig.on ? (trig.prob < 100 ? "○" : "●") : "·"}
      </span>
    );
  } else {
    const intensity = trig.on ? Math.max(0.25, trig.velocity / 127) : 0;
    inner = (
      <div
        style={{
          width: "calc(100% - 6px)",
          height: rowH - 8,
          background: trig.on ? `rgba(240,160,32,${intensity * (trig.prob / 100)})` : "transparent",
          border: trig.on ? "1px solid var(--yellow)" : "1px solid var(--border-dim)",
        }}
      />
    );
  }
  return (
    <div
      style={{
        height: rowH,
        display: "flex",
        alignItems: "center",
        justifyContent: "center",
        background: isHead ? "rgba(78,197,197,0.12)" : "transparent",
        outline: isActive && focused ? "1px solid var(--yellow-bright)" : isActive ? "1px solid var(--yellow-dim)" : "none",
        outlineOffset: -2,
        position: "relative",
      }}
    >
      {inner}
      {isMajor && !isHead ? (
        <div style={{ position: "absolute", left: 0, top: 0, bottom: 0, width: 1, background: "var(--border-dim)" }} />
      ) : null}
    </div>
  );
}
