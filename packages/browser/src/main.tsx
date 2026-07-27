import { StrictMode, Suspense, lazy } from "react";
import { createRoot } from "react-dom/client";
import "@/styles/globals.css";
import { App } from "@/App";
import { initAnalytics } from "@/lib/analytics";
import { drainCompareHandoff } from "@/lib/compareHandoff";

// /?ds renders the design-system gallery instead of the app — every atom in both
// themes on one page. Dev-only, and lazily imported: a static import would ship
// the gallery and its Phosphor glyphs to every production visitor, and an
// unguarded query param would hand any of them the gallery instead of the app,
// with analytics silently disabled.
const designSystem =
  import.meta.env.DEV && new URLSearchParams(window.location.search).has("ds");

// The DEV gate on the lazy() call itself (not just the flag) makes the dynamic
// import statically dead in production, so the bundler never emits the gallery
// chunk into the deploy artifact at all.
const Preview = import.meta.env.DEV
  ? lazy(() => import("@/components/ui/Preview").then((m) => ({ default: m.Preview })))
  : () => null;

if (!designSystem) {
  initAnalytics();
  // Compare's "open in editor" graduation — import the study before first
  // render so the hydrated-or-imported spec is the dirty baseline.
  drainCompareHandoff();
}

createRoot(document.getElementById("root")!).render(
  <StrictMode>
    {designSystem ? (
      <Suspense fallback={null}>
        <Preview />
      </Suspense>
    ) : (
      <App />
    )}
  </StrictMode>,
);
