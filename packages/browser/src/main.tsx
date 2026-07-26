import { StrictMode, Suspense, lazy } from "react";
import { createRoot } from "react-dom/client";
import "@/styles/globals.css";
import { App } from "@/App";
import { initAnalytics } from "@/lib/analytics";

// /?ds renders the design-system gallery instead of the app — every atom in both
// themes on one page. Dev-only, and lazily imported: a static import would ship
// the gallery and its Phosphor glyphs to every production visitor, and an
// unguarded query param would hand any of them the gallery instead of the app,
// with analytics silently disabled.
const designSystem =
  import.meta.env.DEV && new URLSearchParams(window.location.search).has("ds");

const Preview = lazy(() => import("@/components/ui/Preview").then((m) => ({ default: m.Preview })));

if (!designSystem) initAnalytics();

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
