import { useEffect, useRef, useState } from "react";
import { ScanLine, Camera, Loader2, AlertTriangle, X, RotateCw, Check } from "lucide-react";
import Modal from "./Modal";
import api from "../api/client";
import axios from "axios";

const CARD_TYPES = [
  { value: "AADHAAR", label: "Aadhaar card" },
  { value: "AYUSHMAN", label: "Ayushman Bharat card" },
  { value: "CGHS", label: "CGHS card" },
  { value: "ECHS", label: "ECHS card" },
  { value: "CAPF", label: "CAPF card" },
  { value: "OTHER", label: "Other (prescription, etc.)" },
];

// The OCR provider's free tier caps uploads at 1MB, but phone camera photos routinely come
// in at 2-8MB — so every photo gets resized/recompressed in the browser before upload. This
// also means less mobile data used and a faster upload for the person scanning the card.
const MAX_UPLOAD_BYTES = 950 * 1024; // a little under 1MB for safety margin
const MAX_DIMENSION = 1600; // plenty for OCR on printed card text; no need for the original's full resolution

// Bakes the confirmed rotation AND the size/quality reduction into a SINGLE canvas pass and a
// single JPEG encode. This used to be two separate functions run back-to-back (rotate, then
// separately compress) — each one re-encoding the image as JPEG. Two lossy re-encodes stacked
// on each other degrades small printed text (exactly the kind an ID card is covered in) more
// than either pass alone, even when the in-between result still looks fine to the eye — that
// mismatch (a crisp-looking preview, but OCR still failing) is what pointed at this as the
// real cause, rather than the rotation itself. createImageBitmap with imageOrientation
// "from-image" also respects a photo's EXIF rotation tag (how phone cameras record "this was
// held sideways"), independent of the rotation the person chose in the preview.
async function rotateAndCompressImage(fileOrBlob, degrees) {
  if (!fileOrBlob.type?.startsWith("image/")) return fileOrBlob; // not an image somehow — let the backend reject it

  let bitmap;
  try {
    bitmap = await createImageBitmap(fileOrBlob, { imageOrientation: "from-image" });
  } catch {
    return fileOrBlob; // very old browser without EXIF-aware decoding — fall back to the original
  }

  const swapDimensions = degrees === 90 || degrees === 270;
  const rotatedWidth = swapDimensions ? bitmap.height : bitmap.width;
  const rotatedHeight = swapDimensions ? bitmap.width : bitmap.height;
  const scale = Math.min(1, MAX_DIMENSION / Math.max(rotatedWidth, rotatedHeight));

  const canvas = document.createElement("canvas");
  canvas.width = Math.round(rotatedWidth * scale);
  canvas.height = Math.round(rotatedHeight * scale);
  const ctx = canvas.getContext("2d");
  ctx.translate(canvas.width / 2, canvas.height / 2);
  if (degrees) ctx.rotate((degrees * Math.PI) / 180);
  ctx.scale(scale, scale);
  ctx.drawImage(bitmap, -bitmap.width / 2, -bitmap.height / 2);

  // Step quality down until the file fits the size cap, or we hit a quality floor. The floor
  // is 0.5, not the 0.3 this used to fall back to — 0.3 JPEG quality visibly smears small
  // text, which is exactly what OCR needs intact.
  let quality = 0.92;
  let blob = await new Promise((resolve) => canvas.toBlob(resolve, "image/jpeg", quality));
  while (blob && blob.size > MAX_UPLOAD_BYTES && quality > 0.5) {
    quality -= 0.1;
    blob = await new Promise((resolve) => canvas.toBlob(resolve, "image/jpeg", quality));
  }
  return blob || fileOrBlob;
}

const CAN_USE_CAMERA = typeof navigator !== "undefined" && !!navigator.mediaDevices?.getUserMedia;

// Lets someone upload/photograph an ID or health-scheme card and have the name/age/gender
// (and, for scheme cards, the billing panel) prefilled automatically via OCR, instead of
// typing them in by hand. Works three ways:
//   - Pass `doctorCode` for the public leader-facing referral form (no login).
//   - Pass `authToken` for a caller with its own separate token scheme that isn't the shared
//     staff login (e.g. the marketing person portal, which keeps its own per-person token in
//     localStorage rather than the "token" key the shared `api` client reads) — this bypasses
//     `api` entirely for the OCR call so it's never accidentally sent with an unrelated staff
//     token that might also be sitting in localStorage on the same browser/device.
//   - Omit both when used inside an already-authenticated staff screen (e.g. Add Patient) —
//     the shared axios client attaches the staff auth token automatically.
// Extracted fields are always handed back for the person to review/edit, never auto-applied
// silently — a card photo OCR read is a starting point, not a guarantee.
//
// "Other" (prescriptions, anything OCR can't read) skips the OCR call entirely — onExtracted
// still fires so the caller gets the photo itself, just with `data` as null.
//
// onExtracted(data, meta) — data is the OCR result (or null for "Other"/on failure before a
// result exists), meta is always { file, cardType } so a caller that also needs to attach the
// underlying photo (not just the OCR text) can do so, regardless of whether OCR succeeded.
export default function CardScanUpload({ doctorCode, authToken, onExtracted }) {
  const [cardType, setCardType] = useState("AADHAAR");
  const [scanning, setScanning] = useState(false);
  const [error, setError] = useState("");
  const fileInputRef = useRef(null);

  const [showCamera, setShowCamera] = useState(false);
  const [cameraError, setCameraError] = useState("");
  const videoRef = useRef(null);
  const streamRef = useRef(null);

  // Preview step: whatever was just captured/selected sits here, rotatable, before it's
  // actually sent off for OCR.
  const [pendingBlob, setPendingBlob] = useState(null);
  const [pendingPreviewUrl, setPendingPreviewUrl] = useState(null);
  const [rotation, setRotation] = useState(0);

  function openPreview(blob) {
    setPendingBlob(blob);
    setPendingPreviewUrl(URL.createObjectURL(blob));
    setRotation(0);
  }
  function closePreview() {
    if (pendingPreviewUrl) URL.revokeObjectURL(pendingPreviewUrl);
    setPendingBlob(null);
    setPendingPreviewUrl(null);
    setRotation(0);
  }
  // Releases the preview's object URL if the component unmounts while one is still open.
  useEffect(() => () => { if (pendingPreviewUrl) URL.revokeObjectURL(pendingPreviewUrl); }, [pendingPreviewUrl]);

  // Takes a blob that's already been rotated/compressed (by confirmPreview below) and uploads
  // it as-is — this function does NOT do any further image processing itself, precisely to
  // avoid a second lossy re-encode on top of the one confirmPreview already did.
  async function processAndUpload(processedBlob) {
    const file = new File([processedBlob], "card.jpg", { type: "image/jpeg" });

    // "Other" isn't a real OCR card type — there's nothing to read, so skip the API call and
    // just hand the photo straight back. Still goes through onExtracted (with data: null) so
    // a caller relying on it to know "a file is ready" behaves the same either way.
    if (cardType === "OTHER") {
      onExtracted(null, { file, cardType });
      return;
    }

    setScanning(true);
    setError("");
    try {
      const formData = new FormData();
      formData.append("file", processedBlob, "card.jpg");
      formData.append("cardType", cardType);
      if (doctorCode) formData.append("doctorCode", doctorCode);

      let data;
      if (authToken) {
        // Deliberately NOT using the shared `api` client here — its interceptor would attach
        // whatever staff token is under localStorage["token"], overriding this one, if a
        // hospital-staff login also happens to be open in the same browser.
        const res = await axios.post(`${api.defaults.baseURL}/ocr/extract-card`, formData, {
          headers: { "Content-Type": "multipart/form-data", Authorization: `Bearer ${authToken}` },
        });
        data = res.data;
      } else {
        const res = await api.post("/ocr/extract-card", formData, {
          headers: { "Content-Type": "multipart/form-data" },
        });
        data = res.data;
      }
      onExtracted(data, { file, cardType });
    } catch (err) {
      setError(err?.response?.data?.error || "Could not read this card. Please enter the details manually.");
      // Even on a failed read, the photo itself is still fine to attach — hand it back so the
      // caller isn't forced to ask for the photo a second time just because OCR choked on it.
      onExtracted(null, { file, cardType });
    } finally {
      setScanning(false);
    }
  }

  async function confirmPreview() {
    const blob = pendingBlob;
    const finalRotation = rotation;
    closePreview();
    const processed = await rotateAndCompressImage(blob, finalRotation);
    processAndUpload(processed);
  }

  function handleFile(e) {
    const file = e.target.files?.[0];
    e.target.value = ""; // allow picking the same file again later
    if (file) openPreview(file);
  }

  function stopCameraStream() {
    streamRef.current?.getTracks().forEach((t) => t.stop());
    streamRef.current = null;
  }

  function openCamera() {
    setCameraError("");
    setShowCamera(true);
  }

  function closeCamera() {
    stopCameraStream();
    setShowCamera(false);
  }

  // Starts the camera once the modal (and its <video> element) has actually mounted, and
  // always releases it again on close/unmount — an unreleased camera stream keeps the
  // browser's "camera in use" indicator on and drains battery on mobile.
  useEffect(() => {
    if (!showCamera) return;
    let cancelled = false;
    (async () => {
      try {
        const stream = await navigator.mediaDevices.getUserMedia({ video: { facingMode: "environment" } });
        if (cancelled) { stream.getTracks().forEach((t) => t.stop()); return; }
        streamRef.current = stream;
        if (videoRef.current) videoRef.current.srcObject = stream;
      } catch {
        if (!cancelled) setCameraError("Could not access the camera. Check that you've allowed camera permission, or use Upload photo instead.");
      }
    })();
    return () => { cancelled = true; stopCameraStream(); };
  }, [showCamera]);

  function capturePhoto() {
    const video = videoRef.current;
    if (!video || !video.videoWidth) return;
    const canvas = document.createElement("canvas");
    canvas.width = video.videoWidth;
    canvas.height = video.videoHeight;
    canvas.getContext("2d").drawImage(video, 0, 0);
    canvas.toBlob((blob) => {
      closeCamera();
      if (blob) openPreview(blob);
    }, "image/jpeg", 0.92);
  }

  return (
    <div style={{ marginBottom: 16 }}>
      <input
        ref={fileInputRef}
        type="file"
        accept="image/*"
        capture="environment"
        style={{ display: "none" }}
        onChange={handleFile}
      />

      <select value={cardType} onChange={(e) => setCardType(e.target.value)} style={{ width: "100%", marginBottom: 8 }} disabled={scanning}>
        {CARD_TYPES.map((c) => <option key={c.value} value={c.value}>{c.label}</option>)}
      </select>
      <div style={{ display: "flex", gap: 8 }}>
        <button
          type="button"
          className="secondary"
          style={{ flex: 1, padding: "8px 12px", whiteSpace: "nowrap" }}
          disabled={scanning}
          onClick={() => fileInputRef.current?.click()}
        >
          {scanning ? <Loader2 size={15} className="spin" /> : <ScanLine size={15} />}
          {scanning ? "Reading…" : "Upload photo"}
        </button>
        {CAN_USE_CAMERA && (
          <button
            type="button"
            className="secondary"
            style={{ flex: 1, padding: "8px 12px", whiteSpace: "nowrap" }}
            disabled={scanning}
            onClick={openCamera}
          >
            <Camera size={15} />Use camera
          </button>
        )}
      </div>

      {error && (
        <p style={{ fontSize: 12.5, color: "var(--red-700)", marginTop: 6, display: "flex", alignItems: "flex-start", gap: 4 }}>
          <AlertTriangle size={13} style={{ flexShrink: 0, marginTop: 1 }} />{error}
        </p>
      )}
      <p style={{ fontSize: 11.5, color: "var(--ink-soft)", marginTop: 6 }}>
        We'll fill in what we can read — please check it's correct before submitting.
      </p>

      {showCamera && (
        <Modal title="Scan card" onClose={closeCamera} width={480}>
          {cameraError ? (
            <>
              <p style={{ fontSize: 13.5, color: "var(--red-700)", display: "flex", alignItems: "flex-start", gap: 6 }}>
                <AlertTriangle size={15} style={{ flexShrink: 0, marginTop: 1 }} />{cameraError}
              </p>
              <button className="secondary" style={{ width: "auto", padding: "8px 16px" }} onClick={closeCamera}>
                <X size={15} />Close
              </button>
            </>
          ) : (
            <>
              <div style={{ position: "relative", background: "#000", borderRadius: 10, overflow: "hidden", aspectRatio: "4 / 3" }}>
                {/* eslint-disable-next-line jsx-a11y/media-has-caption */}
                <video ref={videoRef} autoPlay playsInline muted style={{ width: "100%", height: "100%", objectFit: "cover" }} />
              </div>
              <p style={{ fontSize: 12, color: "var(--ink-soft)", marginTop: 8, marginBottom: 14 }}>
                Line the card up inside the frame, hold it flat and right-side up, then capture.
              </p>
              <div style={{ display: "flex", gap: 8 }}>
                <button className="secondary" style={{ width: "auto", padding: "10px 16px" }} onClick={closeCamera}>
                  <X size={16} />Cancel
                </button>
                <button style={{ flex: 1, padding: "10px 16px" }} onClick={capturePhoto}>
                  <Camera size={16} />Capture
                </button>
              </div>
            </>
          )}
        </Modal>
      )}

      {pendingPreviewUrl && (
        <Modal title="Check the photo" onClose={closePreview} width={480}>
          <div style={{ background: "#111", borderRadius: 10, overflow: "hidden", aspectRatio: "1 / 1", display: "flex", alignItems: "center", justifyContent: "center" }}>
            <img
              src={pendingPreviewUrl}
              alt="Card preview"
              style={{
                maxWidth: "100%",
                maxHeight: "100%",
                objectFit: "contain",
                transform: `rotate(${rotation}deg)`,
                transition: "transform 0.15s ease",
              }}
            />
          </div>
          <p style={{ fontSize: 12.5, color: "var(--ink-soft)", marginTop: 10, marginBottom: 14 }}>
            Is the card upright and readable, the same way you'd read it yourself? If it's sideways, rotate it before continuing — OCR reads text assuming it's horizontal.
          </p>
          <div style={{ display: "flex", gap: 8 }}>
            <button className="secondary" style={{ width: "auto", padding: "10px 16px" }} onClick={closePreview}>
              <X size={16} />Cancel
            </button>
            <button className="secondary" style={{ width: "auto", padding: "10px 16px" }} onClick={() => setRotation((r) => (r + 90) % 360)}>
              <RotateCw size={16} />Rotate
            </button>
            <button style={{ flex: 1, padding: "10px 16px" }} onClick={confirmPreview}>
              <Check size={16} />Looks good, scan it
            </button>
          </div>
        </Modal>
      )}
    </div>
  );
}
