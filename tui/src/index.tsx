import React from "react";
import { render } from "ink";
import { App } from "./App.js";

const BASE_URL = process.env["DIGITAKT_URL"] ?? "http://localhost:8000";

// Clear screen + scrollback so pre-launch output (shell prompt, server
// messages) doesn't bleed into the Ink render area.
process.stdout.write('\x1b[2J\x1b[3J\x1b[H');

render(<App baseUrl={BASE_URL} />, { fullScreen: true });
