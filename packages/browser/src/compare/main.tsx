import { StrictMode } from "react";
import { createRoot } from "react-dom/client";
import "@/styles/globals.css";
import { ComparePage } from "@/compare/ComparePage";
import { initAnalytics } from "@/lib/analytics";

initAnalytics();

createRoot(document.getElementById("root")!).render(
  <StrictMode>
    <ComparePage />
  </StrictMode>,
);
