import React from "react";
import ReactDOM from "react-dom/client";
import App from "./App";
import Overlay from "./routes/Overlay";
import "./index.css";

function shouldRenderOverlay() {
  const { pathname, hash } = window.location;
  if (pathname === "/overlay" || pathname.startsWith("/overlay/")) return true;
  if (hash.startsWith("#/overlay") || hash === "#overlay") return true;
  return false;
}

const RootComponent = shouldRenderOverlay() ? Overlay : App;

ReactDOM.createRoot(document.getElementById("root") as HTMLElement).render(
  <React.StrictMode>
    <RootComponent />
  </React.StrictMode>
);
