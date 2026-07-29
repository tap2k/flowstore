// GA4 bootstrap, external so the site complies with the app's strict CSP
// (script-src has no 'unsafe-inline' — it guards the keys in localStorage on
// /create/ and /compare/, and one CSP covers the whole origin).
window.dataLayer = window.dataLayer || [];
function gtag() { dataLayer.push(arguments); }
gtag("js", new Date());
gtag("config", document.currentScript.dataset.gaId);
