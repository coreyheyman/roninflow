import { useEffect, useRef, useState } from 'react';
import { Pilcrow, ChevronDown, Italic, Underline, Strikethrough, Minus, Plus, Palette, Link, ImagePlus, Mic, List, ListOrdered, Quote } from 'lucide-react';
import { Popover, useToast, fileToDataUrl } from './ui';

const COLORS = ['#f4f4f5', '#8b8b8f', '#1aa87f', '#5cd9ae', '#e5484d', '#f69b5f', '#e8b043', '#4da3e5', '#b688f2', '#e772ba'];
const SIZES = [10, 12, 14, 16, 18, 20, 24, 28, 32];

/**
 * Lightweight rich-text editor (contentEditable + execCommand).
 * `docKey` re-seeds the HTML when switching documents.
 */
export default function RichText({ value, onChange, docKey, placeholder = 'Start writing…', toolbarTop = false, minHeight = 180, boxed = false, style }) {
  const ref = useRef(null);
  const [size, setSize] = useState(14);
  const [block, setBlock] = useState('Normal');
  const [listening, setListening] = useState(false);
  const fileRef = useRef(null);
  const toast = useToast();

  useEffect(() => {
    if (ref.current && ref.current.innerHTML !== (value || '')) ref.current.innerHTML = value || '';
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [docKey]);

  const emit = () => onChange?.(ref.current.innerHTML === '<br>' ? '' : ref.current.innerHTML);
  const exec = (cmd, arg) => {
    ref.current.focus();
    document.execCommand(cmd, false, arg);
    emit();
  };
  const setFont = (px) => {
    setSize(px);
    ref.current.focus();
    document.execCommand('fontSize', false, '7');
    ref.current.querySelectorAll('font[size="7"]').forEach((f) => {
      const span = document.createElement('span');
      span.style.fontSize = px + 'px';
      span.innerHTML = f.innerHTML;
      f.replaceWith(span);
    });
    emit();
  };
  const blockFmt = (b) => {
    setBlock(b);
    exec('formatBlock', { Normal: 'P', 'Heading 1': 'H1', 'Heading 2': 'H2', Quote: 'BLOCKQUOTE' }[b]);
  };
  const dictate = () => {
    const SR = window.SpeechRecognition || window.webkitSpeechRecognition;
    if (!SR) { toast('Voice dictation is not supported in this browser'); return; }
    const r = new SR();
    r.lang = 'en-US';
    r.onresult = (e) => exec('insertText', ' ' + e.results[0][0].transcript);
    r.onend = () => setListening(false);
    setListening(true);
    r.start();
  };
  const onImage = async (e) => {
    const f = e.target.files?.[0];
    if (f) exec('insertImage', await fileToDataUrl(f));
    e.target.value = '';
  };
  const onPaste = async (e) => {
    const item = [...(e.clipboardData?.items || [])].find((i) => i.type.startsWith('image/'));
    if (item) {
      e.preventDefault();
      exec('insertImage', await fileToDataUrl(item.getAsFile()));
    }
  };

  const toolbar = (
    <div className="rte-toolbar" onMouseDown={(e) => e.target.closest('button') && !e.target.closest('.pop') && e.preventDefault()}>
      <Popover
        up={!toolbarTop}
        width={160}
        trigger={({ toggle }) => <button onClick={toggle} style={{ gap: 4, display: 'flex', alignItems: 'center' }}><Pilcrow size={14} /> {block} <ChevronDown size={12} /></button>}
      >
        {(close) => ['Normal', 'Heading 1', 'Heading 2', 'Quote'].map((b) => <button key={b} className="pop-item" onMouseDown={(e) => e.preventDefault()} onClick={() => { blockFmt(b); close(); }}>{b}</button>)}
      </Popover>
      <span className="sep" />
      <button onClick={() => exec('bold')} title="Bold" style={{ fontWeight: 800, fontFamily: 'serif', fontSize: 15 }}>B</button>
      <button onClick={() => exec('italic')} title="Italic"><Italic size={15} /></button>
      <button onClick={() => exec('underline')} title="Underline"><Underline size={15} /></button>
      <button onClick={() => exec('strikeThrough')} title="Strikethrough"><Strikethrough size={15} /></button>
      <span className="sep" />
      <button onClick={() => setFont(SIZES[Math.max(0, SIZES.indexOf(size) - 1)] || 12)} title="Smaller"><Minus size={14} /></button>
      <span style={{ fontSize: 12, fontWeight: 600, minWidth: 18, textAlign: 'center' }}>{size}</span>
      <button onClick={() => setFont(SIZES[Math.min(SIZES.length - 1, SIZES.indexOf(size) + 1)] || 16)} title="Larger"><Plus size={14} /></button>
      <Popover
        up={!toolbarTop}
        width={180}
        trigger={({ toggle }) => <button onClick={toggle} title="Text color"><Palette size={15} /></button>}
      >
        {(close) => (
          <div style={{ display: 'grid', gridTemplateColumns: 'repeat(5,1fr)', gap: 6, padding: 6 }}>
            {COLORS.map((c) => <button key={c} onMouseDown={(e) => e.preventDefault()} onClick={() => { exec('foreColor', c); close(); }} style={{ width: 24, height: 24, borderRadius: 4, background: c, border: '1px solid var(--border-2)' }} />)}
          </div>
        )}
      </Popover>
      <span className="sep" />
      <button onClick={() => exec('insertUnorderedList')} title="Bullet list"><List size={15} /></button>
      <button onClick={() => exec('insertOrderedList')} title="Numbered list"><ListOrdered size={15} /></button>
      <button onClick={() => blockFmt('Quote')} title="Quote"><Quote size={14} /></button>
      <span className="sep" />
      <button onClick={() => { const u = prompt('Link URL'); if (u) exec('createLink', u); }} title="Link"><Link size={15} /></button>
      <button onClick={() => fileRef.current?.click()} title="Insert image"><ImagePlus size={15} /></button>
      <input ref={fileRef} type="file" accept="image/*" hidden onChange={onImage} />
      <span className="sep" />
      <button onClick={dictate} title="Dictate" style={listening ? { color: 'var(--neg)' } : undefined}><Mic size={15} /></button>
    </div>
  );

  return (
    <div className={boxed ? 'rte-box' : 'col'} style={{ minHeight: 0, ...style }}>
      {toolbarTop && toolbar}
      <div
        ref={ref}
        className="rte grow"
        contentEditable
        suppressContentEditableWarning
        data-placeholder={placeholder}
        onInput={emit}
        onPaste={onPaste}
        style={{ minHeight }}
      />
      {!toolbarTop && toolbar}
    </div>
  );
}
