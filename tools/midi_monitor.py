#!/usr/bin/env python3
"""
MIDI input diagnostic tool.

Run with:  uv run python tools/midi_monitor.py

Lists available MIDI input ports, then opens the Digitakt port (or any
port you choose) and prints every incoming MIDI message to the terminal.
Use this to confirm what channel and CC numbers the Digitakt actually sends
when you turn its encoders.
"""
import sys
import time

try:
    import mido
except ImportError:
    print("ERROR: mido not installed. Run: uv sync")
    sys.exit(1)


def main() -> None:
    input_ports = mido.get_input_names()
    output_ports = mido.get_output_names()

    print("=== Available MIDI input ports ===")
    if input_ports:
        for i, name in enumerate(input_ports):
            print(f"  [{i}] {name}")
    else:
        print("  (none — is the Digitakt connected and powered on?)")

    print()
    print("=== Available MIDI output ports ===")
    if output_ports:
        for i, name in enumerate(output_ports):
            print(f"  [{i}] {name}")
    else:
        print("  (none)")

    if not input_ports:
        print("\nNo input ports found. Check USB connection and power.")
        sys.exit(1)

    # Auto-select a Digitakt port, or let user pick
    auto = next((p for p in input_ports if "Digitakt" in p or "Elektron" in p), None)
    if auto:
        print(f"\nAuto-selected: '{auto}'")
        port_name = auto
    elif len(input_ports) == 1:
        port_name = input_ports[0]
        print(f"\nUsing only available port: '{port_name}'")
    else:
        idx = input(f"\nEnter port index to monitor [0-{len(input_ports)-1}]: ").strip()
        port_name = input_ports[int(idx)]

    print(f"\nOpening '{port_name}' — turn knobs on the Digitakt now.")
    print("(Ctrl+C to quit)\n")
    print(f"{'TIME':>8}  {'TYPE':<20}  {'CHANNEL':>7}  {'DATA'}")
    print("-" * 60)

    cc_seen: dict[tuple, int] = {}  # (channel, control) → count

    try:
        with mido.open_input(port_name) as port:
            while True:
                msg = port.poll()
                if msg is not None and msg.type not in ("clock", "active_sensing"):
                    t = time.strftime("%H:%M:%S")
                    if msg.type == "control_change":
                        key = (msg.channel, msg.control)
                        cc_seen[key] = cc_seen.get(key, 0) + 1
                        print(
                            f"{t:>8}  {'control_change':<20}  ch={msg.channel:<5}  "
                            f"CC#{msg.control}={msg.value}"
                        )
                    elif msg.type in ("note_on", "note_off"):
                        print(
                            f"{t:>8}  {msg.type:<20}  ch={msg.channel:<5}  "
                            f"note={msg.note} vel={msg.velocity}"
                        )
                    else:
                        print(f"{t:>8}  {msg.type:<20}  {str(msg)[:40]}")
                else:
                    time.sleep(0.001)
    except KeyboardInterrupt:
        print("\n\n=== Summary of CC messages seen ===")
        if cc_seen:
            print(f"  {'Channel':>7}  {'CC#':>4}  {'Count':>6}")
            for (ch, cc), count in sorted(cc_seen.items()):
                print(f"  ch={ch:<5}  CC#{cc:<4}  {count:>6}x")
        else:
            print("  (none — Digitakt may not be sending CC)")
            print()
            print("  Possible reasons:")
            print("  1. ENCODER DEST is still set to INT, not CC")
            print("     → Digitakt: SETTINGS > MIDI CONFIG > PORT CONFIG > ENCODER DEST = CC")
            print("  2. No encoder was moved during the session")
            print("  3. Wrong port was monitored")


if __name__ == "__main__":
    main()
