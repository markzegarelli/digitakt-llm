import React from "react";
import { render } from "ink";
import { App } from "./App.js";

const BASE_URL = process.env["DIGITAKT_URL"] ?? "http://localhost:8000";

process.stdout.write("\x1b[2J\x1b[0;0H");
render(<App baseUrl={BASE_URL} />);
