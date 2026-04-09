# core/midi_utils.py
import mido

NOTE_MAP: dict[str, int] = {
    "kick":  36,
    "snare": 37,
    "hihat": 38,
    "clap":  39,
    "perc1": 40,
    "perc2": 41,
    "perc3": 42,
    "perc4": 43,
}


def list_ports() -> list[str]:
    return mido.get_output_names()


def find_digitakt(ports: list[str]) -> str | None:
    for port in ports:
        if "Digitakt" in port:
            return port
    return None


def open_port(name: str):
    return mido.open_output(name)


def send_note(port, note: int, velocity: int, channel: int = 0) -> None:
    if velocity <= 0:
        return
    port.send(mido.Message("note_on", note=note, velocity=velocity, channel=channel))
    port.send(mido.Message("note_off", note=note, velocity=0, channel=channel))
