// GA4 (gtag.js). No-ops unless VITE_GA_ID is set at build time, so dev and
// preview builds stay out of analytics unless the var is explicitly provided.
declare global {
  interface Window {
    dataLayer: unknown[];
    gtag: (...args: unknown[]) => void;
  }
}

export function initAnalytics(): void {
  const id = import.meta.env.VITE_GA_ID;
  if (!id) return;

  const s = document.createElement("script");
  s.async = true;
  s.src = `https://www.googletagmanager.com/gtag/js?id=${id}`;
  document.head.appendChild(s);

  window.dataLayer = window.dataLayer || [];
  // gtag.js requires the raw `arguments` object, not an array — pushing a
  // plain array silently no-ops the command queue (no collect beacon fires).
  window.gtag = function gtag() {
    window.dataLayer.push(arguments);
  };
  window.gtag("js", new Date());
  window.gtag("config", id);
}
