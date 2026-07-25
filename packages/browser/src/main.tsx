import { StrictMode } from "react";
import { createRoot } from "react-dom/client";
import "@/styles/globals.css";
import { App } from "@/App";
import { Preview } from "@/components/ui/Preview";
import { initAnalytics } from "@/lib/analytics";

// /?ds renders the design-system gallery instead of the app — every atom in both
// themes on one page. A query-param switch rather than a route because the app
// has no router, and this should not become a URL anyone can land on by accident.
const designSystem = new URLSearchParams(window.location.search).has("ds");

if (!designSystem) initAnalytics();

createRoot(document.getElementById("root")!).render(
  <StrictMode>{designSystem ? <Preview /> : <App />}</StrictMode>,
);
