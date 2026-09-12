// This app has personal deep links per person (a marketing employee's /marketing/:id, a
// leader's /refer/:doctorCode, a doctor's /doctor/:doctorCode) but only one static manifest
// file for the whole site — and vite-plugin-pwa always bakes a fixed start_url into that
// file at build time (even if you omit it from config, it defaults to "/"). Without this,
// EVERY install — no matter which personal link someone installed from — would launch to
// "/" (the staff login page) instead of back to their own page.
//
// The fix: fetch the static manifest, patch its start_url to the current page's path, then
// swap the <link rel="manifest"> tag over to a Blob URL containing that patched copy.
//
// This has to happen SYNCHRONOUSLY. An earlier version used a normal async fetch() here, and
// it lost the race in practice: Chrome/Android can read the manifest for "Add to Home
// Screen" eligibility very soon after the page loads, and on a real device the async fetch
// sometimes hadn't resolved yet by the time that happened — so the install still captured
// the original static manifest with start_url "/". A deliberately blocking XHR (on a same-
// origin file well under 1KB, effectively instant on any real connection) closes that race:
// by the time this script's next line runs, the link tag is already pointing at the patched
// manifest, well before Chrome evaluates it for installability.
export function patchManifestStartUrl() {
  const link = document.querySelector('link[rel="manifest"]');
  if (!link) return;

  try {
    const xhr = new XMLHttpRequest();
    xhr.open("GET", link.href, false); // false = synchronous, deliberately
    xhr.send(null);
    if (xhr.status !== 200) return;

    const manifest = JSON.parse(xhr.responseText);
    manifest.start_url = window.location.pathname + window.location.search;
    const blob = new Blob([JSON.stringify(manifest)], { type: "application/manifest+json" });
    link.setAttribute("href", URL.createObjectURL(blob));
  } catch {
    // If this fails for any reason, the static manifest (start_url "/") is still in
    // place — worse UX for a fresh install, but never a broken one.
  }
}
