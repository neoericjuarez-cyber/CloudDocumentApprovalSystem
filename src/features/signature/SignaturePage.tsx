import { useLayoutEffect, useRef, useState, type PointerEvent } from "react";
import { deleteSignature, saveSignature, type SavedSignature } from "@/api/signature";
import { errorMessage } from "@/api/client";
import { Button, Icon, Modal } from "@/components/ui";
import { formatDate } from "@/lib/format";

const MAX_W = 600, MAX_H = 200;               // saved signatures are scaled to fit this box
const MAX_UPLOAD_BYTES = 2 * 1024 * 1024;

type Ink = { minX: number; minY: number; maxX: number; maxY: number };

/** Crops to the ink (so the signature fills its box on documents) and scales down to a small PNG. */
export function exportInk(canvas: HTMLCanvasElement, ink: Ink, dpr: number): string {
  const pad = 8;
  const sx = Math.max(0, Math.floor((ink.minX - pad) * dpr)), sy = Math.max(0, Math.floor((ink.minY - pad) * dpr));
  const sw = Math.min(canvas.width - sx, Math.ceil((ink.maxX - ink.minX + 2 * pad) * dpr)), sh = Math.min(canvas.height - sy, Math.ceil((ink.maxY - ink.minY + 2 * pad) * dpr));
  const scale = Math.min(1, MAX_W / sw, MAX_H / sh);
  const out = document.createElement("canvas");
  out.width = Math.max(1, Math.round(sw * scale)); out.height = Math.max(1, Math.round(sh * scale));
  out.getContext("2d")?.drawImage(canvas, sx, sy, sw, sh, 0, 0, out.width, out.height);
  return out.toDataURL("image/png");
}

/** Reads a chosen picture and returns it as a small PNG (JPEGs and large photos are converted/shrunk). */
async function pictureToPng(file: File): Promise<string> {
  const bitmap = await createImageBitmap(file);
  const scale = Math.min(1, MAX_W / bitmap.width, MAX_H / bitmap.height);
  const out = document.createElement("canvas");
  out.width = Math.max(1, Math.round(bitmap.width * scale)); out.height = Math.max(1, Math.round(bitmap.height * scale));
  out.getContext("2d")?.drawImage(bitmap, 0, 0, out.width, out.height);
  bitmap.close?.();
  return out.toDataURL("image/png");
}

/**
 * `signature` is undefined while loading, null when the person hasn't saved one.
 * `onChange` tells the rest of the app when it was saved or removed.
 */
export function SignaturePage({ signature, onChange }: { signature: SavedSignature | null | undefined; onChange: (s: SavedSignature | null) => void }) {
  const [tab, setTab] = useState<"draw" | "upload">("draw");
  const [hasInk, setHasInk] = useState(false);
  const [picture, setPicture] = useState<string | null>(null);     // a chosen, converted upload waiting to be saved
  const [fileError, setFileError] = useState("");
  const [confirm, setConfirm] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");

  const canvasRef = useRef<HTMLCanvasElement>(null);
  const drawing = useRef(false);
  const ink = useRef<Ink | null>(null);
  const dpr = useRef(1);

  // Make the canvas as sharp as the screen allows whenever the drawing tab is shown.
  useLayoutEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    const box = canvas.getBoundingClientRect();
    dpr.current = window.devicePixelRatio || 1;
    canvas.width = Math.max(1, Math.round((box.width || 600) * dpr.current));
    canvas.height = Math.max(1, Math.round((box.height || 300) * dpr.current));
    const ctx = canvas.getContext("2d");
    if (ctx) { ctx.scale(dpr.current, dpr.current); ctx.lineWidth = 2.6; ctx.lineCap = "round"; ctx.lineJoin = "round"; ctx.strokeStyle = "#1b2a49"; }
    ink.current = null; setHasInk(false);
  }, [tab]);

  const point = (e: PointerEvent<HTMLCanvasElement>) => {
    const box = e.currentTarget.getBoundingClientRect();
    return { x: e.clientX - box.left, y: e.clientY - box.top };
  };
  const grow = (p: { x: number; y: number }) => {
    ink.current = ink.current
      ? { minX: Math.min(ink.current.minX, p.x), minY: Math.min(ink.current.minY, p.y), maxX: Math.max(ink.current.maxX, p.x), maxY: Math.max(ink.current.maxY, p.y) }
      : { minX: p.x, minY: p.y, maxX: p.x, maxY: p.y };
  };
  const down = (e: PointerEvent<HTMLCanvasElement>) => {
    const ctx = e.currentTarget.getContext("2d"); if (!ctx) return;
    e.currentTarget.setPointerCapture?.(e.pointerId);
    const p = point(e); drawing.current = true; grow(p);
    ctx.beginPath(); ctx.moveTo(p.x, p.y); ctx.lineTo(p.x + 0.1, p.y + 0.1); ctx.stroke();   // a tap leaves a dot
    setHasInk(true);
  };
  const move = (e: PointerEvent<HTMLCanvasElement>) => {
    if (!drawing.current) return;
    const ctx = e.currentTarget.getContext("2d"); if (!ctx) return;
    const p = point(e); grow(p); ctx.lineTo(p.x, p.y); ctx.stroke();
  };
  const up = () => { drawing.current = false; };

  const clear = () => {
    const canvas = canvasRef.current;
    canvas?.getContext("2d")?.clearRect(0, 0, canvas.width / dpr.current, canvas.height / dpr.current);
    ink.current = null; setHasInk(false);
    setPicture(null); setFileError("");
  };

  async function choose(file: File | undefined) {
    setFileError(""); setPicture(null);
    if (!file) return;
    if (!/^image\/(png|jpeg)$/.test(file.type)) { setFileError("Please choose a PNG or JPG image."); return; }
    if (file.size > MAX_UPLOAD_BYTES) { setFileError("That file is larger than 2 MB."); return; }
    try { setPicture(await pictureToPng(file)); } catch { setFileError("That image couldn't be read. Try another file."); }
  }

  const ready = tab === "draw" ? hasInk : picture !== null;
  const pending = () => (tab === "draw" ? (canvasRef.current && ink.current ? exportInk(canvasRef.current, ink.current, dpr.current) : null) : picture);

  async function save() {
    const imageData = pending();
    if (!imageData) return;
    setBusy(true); setError("");
    try { onChange(await saveSignature(imageData)); setConfirm(false); clear(); }
    catch (e) { setError(errorMessage(e)); }
    finally { setBusy(false); }
  }
  async function remove() {
    setBusy(true); setError("");
    try { await deleteSignature(); onChange(null); }
    catch (e) { setError(errorMessage(e)); }
    finally { setBusy(false); }
  }

  const saved = signature ?? null;
  return <div className="signature-layout"><section className="card signature-main">
    <div className="card-head"><div><h3>Create your e-signature</h3><p>Draw your signature, or upload a picture of it. It is stamped on every document you approve.</p></div></div>
    <div className="signature-tabs">
      <button className={tab === "draw" ? "active" : ""} onClick={() => setTab("draw")}><Icon name="pen" size={17}/> Draw signature</button>
      <button className={tab === "upload" ? "active" : ""} onClick={() => setTab("upload")}><Icon name="upload" size={17}/> Upload image</button>
    </div>
    {tab === "draw"
      ? <div className="signature-pad">
          <canvas ref={canvasRef} aria-label="Signature drawing area" style={{ position: "absolute", inset: 0, width: "100%", height: "100%", touchAction: "none", cursor: "crosshair", borderRadius: 10 }}
            onPointerDown={down} onPointerMove={move} onPointerUp={up} onPointerCancel={up} onPointerLeave={up}/>
          <div className="pad-line"/><small>{hasInk ? "Looks good? Press Save signature." : "Draw your signature above using your mouse, pen or touch screen"}</small>
          <button onClick={clear}>Clear</button>
        </div>
      : <label className="upload-zone">
          {picture ? <img src={picture} alt="Your chosen signature" style={{ maxWidth: "80%", maxHeight: 180 }}/> : <><Icon name="upload" size={30}/><strong>Click to choose your signature image</strong><span>PNG or JPG up to 2 MB. A clear photo or scan on a plain background works best</span></>}
          <input type="file" accept="image/png,image/jpeg" onChange={e => { void choose(e.target.files?.[0]); e.target.value = ""; }}/>
        </label>}
    {fileError && <div className="error-text" style={{ margin: "0 22px 10px" }}>{fileError}</div>}
    <div className="signature-actions"><Button variant="secondary" onClick={clear} disabled={busy}>Reset</Button><Button disabled={!ready || busy} onClick={() => { setError(""); setConfirm(true); }}>Save signature</Button></div>
  </section>
  <aside className="card signature-preview"><span className="eyebrow">Current signature</span>
    <div className="preview-sign">{signature === undefined ? <em>Loading…</em> : saved ? <img src={saved.imageData} alt="Your saved signature" style={{ maxWidth: "90%", maxHeight: 130 }}/> : <em>No signature saved</em>}</div>
    <div className="signature-status"><i style={saved ? undefined : { background: "#c0392b" }}/><div><strong>{saved ? "Signature ready" : "No saved signature"}</strong><span>{saved ? `Last updated ${formatDate(saved.updatedAt)}` : "Create one to approve documents"}</span></div></div>
    {saved && <Button variant="danger" className="full" disabled={busy} onClick={remove}>Remove signature</Button>}
    {!confirm && error && <div className="error-text">{error}</div>}
    <div className="legal-note"><Icon name="check" size={18}/><p>Your signature image is stored in the system and copied onto each document when you approve it, together with the date. It is an electronic signature image, not a certificate-based digital signature.</p></div>
  </aside>
  {confirm && <Modal title={saved ? "Replace saved signature?" : "Save this signature?"} close={() => setConfirm(false)}>
    <p>{saved ? "Documents you already signed keep the signature they were signed with. New approvals will use this one." : "This signature will be placed on documents when you approve them."}</p>
    {error && <div className="error-text">{error}</div>}
    <div className="modal-actions"><Button variant="secondary" onClick={() => setConfirm(false)}>Cancel</Button><Button disabled={busy} onClick={save}>{busy ? "Saving…" : saved ? "Replace signature" : "Save signature"}</Button></div>
  </Modal>}
  </div>;
}
