import React from "react";
import ReactDOM from "react-dom/client";
import "@/index.css";
import App from "@/App";

// Swallow the CRA dev-overlay's reaction to anonymous "Script error." events.
// These come from cross-origin Web Workers (notably monaco-yaml on the
// preview infra). We only suppress events that carry zero useful info —
// real errors (with a message + filename) still propagate to the overlay
// and console as normal.
//
// `error` listener triggers BEFORE CRA's own overlay handler (capture: true).
window.addEventListener('error', (e) => {
  if (!e.message || e.message === 'Script error.') {
    const fname = e.filename || '';
    const sameOriginFile = fname.startsWith(window.location.origin);
    if (!sameOriginFile) {
      // Opaque cross-origin worker error — log to console, stop the overlay.
      console.warn('[index] suppressed anonymous cross-origin error event', {
        message: e.message,
        filename: e.filename,
        lineno: e.lineno,
      });
      e.stopImmediatePropagation();
      e.preventDefault();
    }
  }
}, true);

const root = ReactDOM.createRoot(document.getElementById("root"));
root.render(
  <React.StrictMode>
    <App />
  </React.StrictMode>,
);
