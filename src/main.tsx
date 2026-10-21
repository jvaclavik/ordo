import { StrictMode } from "react";
import { createRoot } from "react-dom/client";
import { registerSW } from "virtual:pwa-register";
import { App } from "./App.tsx";
import { startGcal } from "./data/gcal.ts";
import { startGcalPush } from "./data/gcalPush.ts";
import { loadStore } from "./data/store.tsx";
import "./index.css";

loadStore();
startGcal();
startGcalPush();

if (import.meta.env.PROD) {
  registerSW({ immediate: true });
}

const root = document.getElementById("root");
if (root) createRoot(root).render(<StrictMode><App /></StrictMode>);
