import React from "react";
import { createRoot } from "react-dom/client";
import { App } from "./App.js";
import "./styles/theme.css";
import "./styles/workbench.css";

const root = createRoot(document.getElementById("root")!);
root.render(<App />);
