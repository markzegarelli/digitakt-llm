import React from "react";
import { render } from "ink";
import { App } from "./App.js";

const rawUrl = process.env["DIGITAKT_URL"] ?? "http://localhost:8000";
const BASE_URL = rawUrl.replace(/\/+$/, "");

// Clear screen + scrollback so pre-launch output (shell prompt, server
// messages) doesn't bleed into the Ink render area.
process.stdout.write('\x1b[2J\x1b[3J\x1b[H');

render(<App baseUrl={BASE_URL} />);
