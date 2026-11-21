import { useCallback, useEffect, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import ShotEditor from './ShotEditor';
import { ImagePlus, X, ChevronLeft, ChevronRight, Trash, Download, Maximize, MessageCircle, ZoomIn, ZoomOut, FolderSync, PenLine } from 'lucide-react';
import { saveImage, imageUrl, deleteImage } from '../lib/imageStore';
import { IS_VIEWER } from '../lib/shareMode';
import { IS_DEMO } from '../lib/demoMode';
import { useToast } from './ui';

function Thumb({ img, onOpen, onDelete, onCaption, onAsk, reading }) {
  const [url, setUrl] = useState(null);
  useEffect(() => { let live = true; imageUrl(img.id).then((u) => live && setUrl(u)); return () => { live = false; }; }, [img.id]);
  return (
    <div className="gal-item">
      <button className="gal-img" onClick={onOpen} title="Open">
        {url ? <img src={url} alt={img.caption || img.name} /> : <span className="muted" style={{ fontSize: 12 }}>{url === null ? 'Loading…' : 'Missing'}</span>}
        <span className="gal-zoom"><Maximize size={14} /></span>
      </button>
      <div className="row gap6" style={{ padding: '8px 10px' }}>
        <input className="grow" value={img.caption || ''} placeholder={reading ? 'Reading instrument…' : 'Add a caption…'} onChange={(e) => onCaption(e.target.value)} style={{ background: 'transparent', border: 0, outline: 'none', fontSize: 12.5 }} />
        {onAsk && url && <button className="icon-btn" style={{ width: 24, height: 24 }} title="Ask coach about this chart" onClick={() => onAsk(url, img.caption)}><MessageCircle size={13} /></button>}
        <button className="icon-btn" style={{ width: 24, height: 24 }} title="Delete" onClick={onDelete}><Trash size={13} /></button>
      </div>
    </div>
  );
}

/** An image you can zoom (click, wheel, pinch, + / − / 0) and drag around once zoomed in. Clicking outside the
 *  picture closes the viewer; clicking the picture zooms in there (or back out). */
function ZoomImage({ src, onBackdrop }) {
  const box = useRef(null);
  const img = useRef(null);
  const [v, setV] = useState({ k: 1, x: 0, y: 0 });
  const vRef = useRef(v); vRef.current = v;
  const ptrs = useRef(new Map());
  const gest = useRef(null); // { x, y, ox, oy, moved, pinch: distance }
  useEffect(() => { setV({ k: 1, x: 0, y: 0 }); }, [src]);
  // keep the picture on screen: it can be dragged only as far as its zoomed edges reach
  const clamp = (k, x, y) => {
    const bw = box.current?.clientWidth || 0, bh = box.current?.clientHeight || 0;
    const iw = (img.current?.offsetWidth || bw) * k, ih = (img.current?.offsetHeight || bh) * k;
    const mx = Math.max(0, (iw - bw) / 2), my = Math.max(0, (ih - bh) / 2);
    return { k, x: Math.max(-mx, Math.min(mx, x)), y: Math.max(-my, Math.min(my, y)) };
  };
  // zoom to k around a point (cx, cy) measured from the box's centre
  const zoomTo = useCallback((k1, cx = 0, cy = 0) => {
    const o = vRef.current;
    const k = Math.max(1, Math.min(8, k1));
    const r = k / o.k;
    const n = k === 1 ? { k: 1, x: 0, y: 0 } : clamp(k, cx - (cx - o.x) * r, cy - (cy - o.y) * r);
    vRef.current = n; setV(n);
  }, []); // eslint-disable-line react-hooks/exhaustive-deps
  const local = (x, y) => { const r = box.current.getBoundingClientRect(); return [x - r.left - r.width / 2, y - r.top - r.height / 2]; };
  const onImage = (x, y) => { const r = img.current?.getBoundingClientRect(); return !!r && x >= r.left && x <= r.right && y >= r.top && y <= r.bottom; };
  useEffect(() => {
    const el = box.current;
    if (!el) return undefined;
    const wheel = (e) => { e.preventDefault(); const [cx, cy] = local(e.clientX, e.clientY); zoomTo(vRef.current.k * Math.exp(-e.deltaY * (e.ctrlKey ? 0.01 : 0.0012)), cx, cy); };
    el.addEventListener('wheel', wheel, { passive: false });
    const key = (e) => {
      if (e.key === '+' || e.key === '=') zoomTo(vRef.current.k * 1.4);
      else if (e.key === '-' || e.key === '_') zoomTo(vRef.current.k / 1.4);
      else if (e.key === '0') zoomTo(1);
    };
    window.addEventListener('keydown', key);
    return () => { el.removeEventListener('wheel', wheel); window.removeEventListener('keydown', key); };
  }, [zoomTo]);
  const down = (e) => {
    e.preventDefault(); // no native image drag or text selection
    e.stopPropagation();
    box.current.setPointerCapture?.(e.pointerId);
    ptrs.current.set(e.pointerId, [e.clientX, e.clientY]);
    if (ptrs.current.size === 2) {
      const [a, b] = [...ptrs.current.values()];
      gest.current = { ...(gest.current || {}), moved: true, pinch: Math.hypot(a[0] - b[0], a[1] - b[1]) };
    } else {
      gest.current = { x: e.clientX, y: e.clientY, ox: vRef.current.x, oy: vRef.current.y, moved: false, pinch: 0, start: [e.clientX, e.clientY] };
    }
  };
  const move = (e) => {
    const g = gest.current;
    if (!g || !ptrs.current.has(e.pointerId)) return;
    ptrs.current.set(e.pointerId, [e.clientX, e.clientY]);
    if (g.pinch && ptrs.current.size === 2) {
      const [a, b] = [...ptrs.current.values()];
      const d = Math.hypot(a[0] - b[0], a[1] - b[1]);
      const [cx, cy] = local((a[0] + b[0]) / 2, (a[1] + b[1]) / 2);
      zoomTo(vRef.current.k * (d / g.pinch), cx, cy);
      g.pinch = d;
      return;
    }
    const dx = e.clientX - g.x, dy = e.clientY - g.y;
    if (!g.moved && Math.hypot(dx, dy) > 4) g.moved = true;
    if (g.moved && vRef.current.k > 1) {
      const n = clamp(vRef.current.k, g.ox + dx, g.oy + dy);
      vRef.current = n; setV(n);
    }
  };
  const up = (e) => {
    ptrs.current.delete(e.pointerId);
    const g = gest.current;
    if (ptrs.current.size) return; // the other finger is still down
    gest.current = null;
    if (!g || g.moved || e.type === 'pointercancel') return;
    // a click: on the picture → zoom in there (or back out); outside it → close
    if (vRef.current.k > 1) zoomTo(1);
    else if (onImage(e.clientX, e.clientY)) { const [cx, cy] = local(e.clientX, e.clientY); zoomTo(2.5, cx, cy); }
    else onBackdrop?.();
  };
  return (
    <>
      <div ref={box} className={`lb-stage ${v.k > 1 ? 'zoomed' : ''}`} onPointerDown={down} onPointerMove={move} onPointerUp={up} onPointerCancel={up} onMouseDown={(e) => e.stopPropagation()}>
        <img ref={img} src={src} alt="" draggable={false} style={{ transform: `translate3d(${v.x}px, ${v.y}px, 0) scale(${v.k})` }} />
      </div>
      <div className="lb-zoom" onMouseDown={(e) => e.stopPropagation()}>
        <button className="icon-btn" title="Zoom out (−)" onClick={() => zoomTo(vRef.current.k / 1.4)} disabled={v.k <= 1}><ZoomOut size={16} /></button>
        <button className="lb-pct" title="Fit (0)" onClick={() => zoomTo(1)}>{Math.round(v.k * 100)}%</button>
        <button className="icon-btn" title="Zoom in (+)" onClick={() => zoomTo(vRef.current.k * 1.4)} disabled={v.k >= 8}><ZoomIn size={16} /></button>
      </div>
    </>
  );
}

/** Full-screen viewer. images: [{ id } (saved screenshots) or { src } (a data URL / link), name, caption]. */
export function Lightbox({ images, index, onClose, onIndex, onAsk, onEdit }) {
  const [url, setUrl] = useState(null);
  const [editing, setEditing] = useState(null); // the original picture's URL while the editor is open
  const img = images[index];
  useEffect(() => {
    let live = true;
    setUrl(img?.src || null);
    if (img?.id) imageUrl(img.id).then((u) => live && setUrl(u));
    return () => { live = false; };
  }, [img]);
  useEffect(() => {
    const k = (e) => {
      if (editing) return; // the editor has the keyboard
      if (e.key === 'Escape') { e.stopPropagation(); onClose(); }
      if (e.key === 'ArrowRight') onIndex((index + 1) % images.length);
      if (e.key === 'ArrowLeft') onIndex((index - 1 + images.length) % images.length);
    };
    window.addEventListener('keydown', k, true);
    return () => window.removeEventListener('keydown', k, true);
  }, [index, images.length, onClose, onIndex, editing]);
  if (!img) return null;
  return createPortal(
    <div className="lightbox" onMouseDown={(e) => e.target === e.currentTarget && onClose()}>
      <div className="row gap12 lb-top">
        <span>{index + 1} / {images.length}</span>
        <span className="grow truncate" style={{ opacity: 0.8 }}>{img.caption || img.name}</span>
        {onEdit && url && <button className="btn xs lb-ask" title="Draw on this screenshot — your drawings stay editable" onClick={async () => { const o = img.orig ? (/^(data:|blob:|https?:|\/)/.test(img.orig) ? img.orig : await imageUrl(img.orig)) : url; setEditing(o || url); }}><PenLine size={13} /> {img.annot?.shapes?.length ? 'Edit drawing' : 'Draw'}</button>}
        {onAsk && url && <button className="btn xs lb-ask" onClick={() => { onClose(); onAsk(url, img.caption); }}><MessageCircle size={13} /> Ask coach about this chart</button>}
        {url && <a className="icon-btn" style={{ color: '#fff' }} href={url} download={img.name || 'screenshot.png'} title="Download"><Download size={17} /></a>}
        <button className="icon-btn" style={{ color: '#fff' }} onClick={onClose} title="Close"><X size={20} /></button>
      </div>
      {images.length > 1 && <button className="lb-nav" style={{ left: 16 }} onClick={() => onIndex((index - 1 + images.length) % images.length)}><ChevronLeft size={26} /></button>}
      {url && <ZoomImage src={url} onBackdrop={onClose} />}
      {images.length > 1 && <button className="lb-nav" style={{ right: 16 }} onClick={() => onIndex((index + 1) % images.length)}><ChevronRight size={26} /></button>}
      {editing && <ShotEditor src={editing} annot={img.annot} onClose={() => setEditing(null)} onSave={(blob, annot) => onEdit(index, blob, annot)} />}
    </div>,
    document.body,
  );
}

/** Chart screenshot gallery. images: [{id,name,caption,addedAt}] stored on the diary entry; files in IndexedDB. */
export default function Gallery({ images = [], onChange, onAsk, autoCaption }) {
  const [drag, setDrag] = useState(false);
  const [open, setOpen] = useState(-1);
  const [busy, setBusy] = useState(false);
  const ref = useRef(null);
  const zone = useRef(null);
  const toast = useToast();
  const latest = useRef(images);
  latest.current = images;
  const [reading, setReading] = useState(() => new Set()); // image ids whose caption is being read

  const add = useCallback(async (files) => {
    const list = [...files].filter((f) => f.type.startsWith('image/'));
    if (!list.length) return;
    setBusy(true);
    try {
      const saved = [];
      for (const f of list) saved.push(await saveImage(f));
      const next = [...latest.current, ...saved];
      latest.current = next; // keep our view current so later updates build on this list, not a stale one
      onChange(next);
      toast(`${saved.length} screenshot${saved.length > 1 ? 's' : ''} added`);
      // fill in captions (instrument / timeframe) in the background, one image at a time (parallel AI calls
      // can fail), applying each to the freshest list; never overwrite a caption you've typed
      if (autoCaption) {
        setReading((r) => { const n = new Set(r); saved.forEach((img) => n.add(img.id)); return n; });
        (async () => {
          for (let k = 0; k < saved.length; k++) {
            const img = saved[k];
            let caption = '';
            try { caption = await autoCaption(list[k]); } catch { /* leave it empty */ }
            const cur = latest.current;
            if (caption && cur.some((x) => x.id === img.id && !x.caption)) {
              const upd = cur.map((x) => (x.id === img.id ? { ...x, caption } : x));
              latest.current = upd;
              onChange(upd);
            }
            setReading((r) => { const n = new Set(r); n.delete(img.id); return n; });
          }
        })();
      }
    } catch (e) {
      toast(`Couldn't save image: ${e.message}`);
    }
    setBusy(false);
  }, [images, onChange, toast, autoCaption]);

  // a drawing saved in the editor: the flat picture replaces the shown one; the original and the shapes are kept so
  // it can be edited again
  const editShot = useCallback(async (i, blob, annot) => {
    const cur = latest.current[i];
    if (!cur) return;
    const saved = await saveImage(new File([blob], cur.name || 'screenshot.png', { type: 'image/png' }));
    const orig = cur.orig || cur.id;
    const next = latest.current.map((x, k) => (k === i ? { ...x, id: saved.id, size: saved.size, orig, annot: annot.shapes.length ? annot : null } : x));
    latest.current = next;
    onChange(next);
    if (cur.id !== orig) deleteImage(cur.id).catch(() => {}); // the previous flat copy
    toast('Drawing saved');
  }, [onChange, toast]);

  useEffect(() => {
    const el = zone.current;
    if (!el) return undefined;
    const paste = (e) => {
      const files = [...(e.clipboardData?.items || [])].filter((i) => i.type.startsWith('image/')).map((i) => i.getAsFile());
      if (files.length) { e.preventDefault(); add(files); }
    };
    el.addEventListener('paste', paste);
    return () => el.removeEventListener('paste', paste);
  }, [add]);

  return (
    <div
      ref={zone}
      tabIndex={0}
      className={`gal ${drag ? 'drag' : ''}`}
      onDragOver={(e) => { e.preventDefault(); setDrag(true); }}
      onDragLeave={() => setDrag(false)}
      onDrop={(e) => { e.preventDefault(); setDrag(false); add(e.dataTransfer.files); }}
    >
      <div className="gal-grid">
        {images.map((img, i) => (
          <Thumb
            key={img.id}
            img={img}
            onOpen={() => setOpen(i)}
            onAsk={onAsk}
            reading={reading.has(img.id)}
            onCaption={(caption) => onChange(images.map((x) => (x.id === img.id ? { ...x, caption } : x)))}
            onDelete={async () => { await deleteImage(img.id); if (img.orig && img.orig !== img.id) deleteImage(img.orig).catch(() => {}); onChange(images.filter((x) => x.id !== img.id)); }}
          />
        ))}
        <button className="gal-add" onClick={() => ref.current?.click()} disabled={busy}>
          <ImagePlus size={22} />
          <span style={{ fontWeight: 500 }}>{busy ? 'Saving…' : 'Add chart screenshots'}</span>
          <span className="muted" style={{ fontSize: 11.5 }}>Click, drop files, or paste (Ctrl+V) here</span>
        </button>
      </div>
      <input ref={ref} type="file" accept="image/*" multiple hidden onChange={(e) => { add(e.target.files); e.target.value = ''; }} />
      {!IS_VIEWER && !IS_DEMO && <button type="button" className="gal-auto" onClick={() => window.dispatchEvent(new CustomEvent('tj:open-settings', { detail: 'shots' }))}><FolderSync size={12} /> Import screenshots automatically from a folder</button>}
      {open >= 0 && <Lightbox images={images} index={open} onIndex={setOpen} onClose={() => setOpen(-1)} onAsk={onAsk} onEdit={IS_VIEWER ? undefined : editShot} />}
    </div>
  );
}
