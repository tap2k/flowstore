// GA4 bootstrap, external so the site complies with the app's strict CSP
// (script-src has no 'unsafe-inline' — it guards the keys in localStorage on
// /create/ and /compare/, and one CSP covers the whole origin).
// currentScript with a selector fallback: adding defer/async/type=module to
// the tag must not silently kill analytics.
(function () {
  var el = document.currentScript || document.querySelector("script[data-ga-id]");
  var id = el && el.dataset ? el.dataset.gaId : "";
  if (!id) return;
  window.dataLayer = window.dataLayer || [];
  function gtag() { dataLayer.push(arguments); }
  gtag("js", new Date());
  gtag("config", id);
})();
