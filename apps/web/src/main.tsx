import React from "react";
import ReactDOM from "react-dom/client";
import App from "./App.js";
import "./styles/globals.css";

// Register Service Worker in production
if (import.meta.env.PROD && typeof navigator !== "undefined" && "serviceWorker" in navigator) {
  window.addEventListener("load", () => {
    navigator.serviceWorker
      .register("/app/sw.js", { scope: "/app/" })
      .catch((err) => {
        console.error("ServiceWorker registration failed:", err);
      });
  });
}

const rootEl = document.getElementById("root");
if (rootEl) {
  ReactDOM.createRoot(rootEl).render(
    <React.StrictMode>
      <App />
    </React.StrictMode>
  );
}
