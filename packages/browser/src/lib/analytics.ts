// GA4 (gtag.js). No-ops unless VITE_GA_ID is set at build time, so dev and
// preview builds stay out of analytics unless the var is explicitly provided.
declare global {
  interface Window {
    dataLayer: unknown[];
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
  function gtag(...args: unknown[]) {
    window.dataLayer.push(args);
  }
  gtag("js", new Date());
  gtag("config", id);
}
