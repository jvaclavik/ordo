import { StrictMode } from "react";
import { createRoot } from "react-dom/client";
import { App } from "./App.tsx";
import { loadStore } from "./data/store.tsx";
import "./index.css";

loadStore();

const root = document.getElementById("root");
if (root) createRoot(root).render(<StrictMode><App /></StrictMode>);
