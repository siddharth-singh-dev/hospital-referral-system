// This app has personal deep links per person (a marketing employee's /marketing/:id, a
// leader's /refer/:doctorCode, a doctor's /doctor/:doctorCode) but only one static manifest
// file for the whole site — and vite-plugin-pwa always bakes a fixed start_url into that
// file at build time (even if you omit it from config, it defaults to "/"). Without this,
// EVERY install — no matter which personal link someone installed from — would launch to
// "/" (the staff login page) instead of back to their own page.
//
// The fix: fetch the static manifest, patch its start_url to the current page's path, then
// swap the <link rel="manifest"> tag over to a Blob URL containing that patched copy. This
// runs on every page load, well before a user could tap "Add to Home Screen" or Android's
// install prompt, so by the time either happens, the manifest the browser reads already
// points back to whichever page is currently open.
export function patchManifestStartUrl() {
  const link = document.querySelector('link[rel="manifest"]');
  if (!link) return;

  fetch(link.href)
    .then((res) => res.json())
    .then((manifest) => {
      manifest.start_url = window.location.pathname + window.location.search;
      const blob = new Blob([JSON.stringify(manifest)], { type: "application/manifest+json" });
      link.setAttribute("href", URL.createObjectURL(blob));
    })
    .catch(() => {
      // If this fails for any reason, the static manifest (start_url "/") is still in
      // place — worse UX for a fresh install, but never a broken one.
    });
}
