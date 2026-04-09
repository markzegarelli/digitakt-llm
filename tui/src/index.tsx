import React from "react";
import { render } from "ink";
import { App } from "./App.js";

const BASE_URL = process.env["DIGITAKT_URL"] ?? "http://localhost:8000";

render(<App baseUrl={BASE_URL} />);
