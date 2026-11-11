import { useCallback, useEffect, useRef, useState } from 'react';
import { ImagePlus, X, ChevronLeft, ChevronRight, Trash, Download, Maximize, MessageCircle } from 'lucide-react';
import { saveImage, imageUrl, deleteImage } from '../lib/imageStore';
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

function Lightbox({ images, index, onClose, onIndex, onAsk }) {
  const [url, setUrl] = useState(null);
  const img = images[index];
  useEffect(() => { let live = true; setUrl(null); if (img) imageUrl(img.id).then((u) => live && setUrl(u)); return () => { live = false; }; }, [img]);
  useEffect(() => {
    const k = (e) => {
      if (e.key === 'Escape') onClose();
      if (e.key === 'ArrowRight') onIndex((index + 1) % images.length);
      if (e.key === 'ArrowLeft') onIndex((index - 1 + images.length) % images.length);
    };
    window.addEventListener('keydown', k);
    return () => window.removeEventListener('keydown', k);
  }, [index, images.length, onClose, onIndex]);
  if (!img) return null;
  return (
    <div className="lightbox" onMouseDown={(e) => e.target === e.currentTarget && onClose()}>
      <div className="row gap12" style={{ position: 'absolute', top: 16, left: 20, right: 20, color: '#fff', fontSize: 13 }}>
        <span>{index + 1} / {images.length}</span>
        <span className="grow truncate" style={{ opacity: 0.8 }}>{img.caption || img.name}</span>
        {onAsk && url && <button className="btn xs lb-ask" onClick={() => { onClose(); onAsk(url, img.caption); }}><MessageCircle size={13} /> Ask coach about this chart</button>}
        {url && <a className="icon-btn" style={{ color: '#fff' }} href={url} download={img.name} title="Download"><Download size={17} /></a>}
        <button className="icon-btn" style={{ color: '#fff' }} onClick={onClose} title="Close"><X size={20} /></button>
      </div>
      {images.length > 1 && <button className="lb-nav" style={{ left: 16 }} onClick={() => onIndex((index - 1 + images.length) % images.length)}><ChevronLeft size={26} /></button>}
      {url && <img src={url} alt="" style={{ maxWidth: 'calc(100vw - 140px)', maxHeight: 'calc(100vh - 90px)', boxShadow: '0 20px 60px rgba(0,0,0,.6)' }} />}
      {images.length > 1 && <button className="lb-nav" style={{ right: 16 }} onClick={() => onIndex((index + 1) % images.length)}><ChevronRight size={26} /></button>}
    </div>
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
            onDelete={async () => { await deleteImage(img.id); onChange(images.filter((x) => x.id !== img.id)); }}
          />
        ))}
        <button className="gal-add" onClick={() => ref.current?.click()} disabled={busy}>
          <ImagePlus size={22} />
          <span style={{ fontWeight: 500 }}>{busy ? 'Saving…' : 'Add chart screenshots'}</span>
          <span className="muted" style={{ fontSize: 11.5 }}>Click, drop files, or paste (Ctrl+V) here</span>
        </button>
      </div>
      <input ref={ref} type="file" accept="image/*" multiple hidden onChange={(e) => { add(e.target.files); e.target.value = ''; }} />
      {open >= 0 && <Lightbox images={images} index={open} onIndex={setOpen} onClose={() => setOpen(-1)} onAsk={onAsk} />}
    </div>
  );
}
