import { MotionConfig } from "motion/react";
import { StrictMode } from "react";
import { createRoot } from "react-dom/client";
import { App } from "./App";
import { ChecklistPreview } from "./checklist-preview";
import "./app.css";

const checklistPreview = location.pathname === "/qa/checklist";

createRoot(document.getElementById("root")!).render(
  <StrictMode>
    <MotionConfig reducedMotion="user">
      {checklistPreview ? <ChecklistPreview /> : <App />}
    </MotionConfig>
  </StrictMode>,
);

if (import.meta.env.PROD && "serviceWorker" in navigator) {
  void navigator.serviceWorker.register("/sw.js");
}
