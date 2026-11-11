import { useEffect, useRef, useState } from 'react';
import { Pencil, Copy, Trash, RotateCcw, Check, Plus, Moon, Sun, X, ChevronDown } from 'lucide-react';
import { useStore } from '../store/store';
import { Modal, ModalHead, Seg, Confirm, useToast } from './ui';
import { uid } from '../lib/stats';
import { TEMPLATES, COLOR_GROUPS, FONTS, findFont, fontStack, loadFonts, activeThemeId, findTheme, applyTheme, themeSettings, normHex } from '../lib/themes';

const setSettings = (update, patch) => update((s) => ({ ...s, settings: { ...s.settings, ...(typeof patch === 'function' ? patch(s.settings) : patch) } }));

/** Little drawing of the app in a theme's colours. */
function ThemePreview({ c }) {
  return (
    <div className="th-prev" style={{ background: c.bg, borderColor: c.border }}>
      <div className="th-prev-side" style={{ background: c.sidebar, borderColor: c.border }}>
        <i style={{ background: c.fg, width: '70%' }} />
        <i style={{ background: c.primary, opacity: 0.9 }} />
        <i style={{ background: c.muted2 }} />
        <i style={{ background: c.muted2 }} />
      </div>
      <div className="th-prev-main">
        <div className="th-prev-panel" style={{ background: c.panel, borderColor: c.border }}>
          <b style={{ color: c.pos }}>+$1,240</b>
          <div className="th-prev-bars">
            {[38, 62, 30, 80, 50, 70].map((h, i) => <span key={i} style={{ height: `${h}%`, background: i === 2 ? c.neg : c.posStrong }} />)}
          </div>
        </div>
        <div className="row" style={{ gap: 4 }}>
          <span className="th-prev-btn" style={{ background: c.btnBg }} />
          <span className="th-prev-btn" style={{ background: c.primary, width: 18 }} />
          <span className="th-prev-txt" style={{ background: c.muted }} />
        </div>
      </div>
    </div>
  );
}

function ThemeCard({ t, active, onPick, onEdit }) {
  return (
    <div className={`th-card ${active ? 'on' : ''}`} onClick={onPick} role="button" tabIndex={0} onKeyDown={(e) => e.key === 'Enter' && onPick()}>
      <ThemePreview c={t.colors} />
      <div className="th-card-foot">
        <div className="grow" style={{ minWidth: 0 }}>
          <div className="th-card-name">{t.name} {active && <Check size={13} className="accent" />}</div>
          <div className="th-card-sub truncate">{t.blurb || (t.from ? `Based on ${TEMPLATES.find((x) => x.id === t.from)?.name || 'a template'}` : 'Custom')}</div>
        </div>
        <button className="icon-btn" title={t.custom ? 'Edit' : 'Customise (makes an editable copy)'} onClick={(e) => { e.stopPropagation(); onEdit(); }}><Pencil size={14} /></button>
      </div>
    </div>
  );
}

/** Appearance picker: templates + your own themes. */
export function ThemePicker({ open, onClose, onEdit }) {
  const { state, update } = useStore();
  const s = state.settings;
  const active = activeThemeId(s);
  const customs = (s.customThemes || []).map((t) => ({ ...findTheme(s, t.id), custom: true }));
  const pick = (t) => setSettings(update, themeSettings(t));
  const copyOf = (t) => {
    const copy = { id: uid('th'), name: `${t.name} (custom)`, base: t.base, from: t.from || t.id, colors: { ...t.colors } };
    setSettings(update, (st) => ({ customThemes: [...(st.customThemes || []), copy], ...themeSettings(copy) }));
    return copy;
  };
  const edit = (t) => { onEdit(t.custom ? t.id : copyOf(t).id); onClose(); };
  const group = (base) => TEMPLATES.filter((t) => t.base === base);
  return (
    <Modal open={open} onClose={onClose} width={880}>
      <ModalHead title="Appearance" sub="Pick a theme, or press the pencil to make it your own" onClose={onClose} />
      <div className="modal-body th-body">
        <div className="th-sec"><Moon size={14} /> Dark</div>
        <div className="th-grid">{group('dark').map((t) => <ThemeCard key={t.id} t={t} active={active === t.id} onPick={() => pick(t)} onEdit={() => edit(t)} />)}</div>
        <div className="th-sec"><Sun size={14} /> Light</div>
        <div className="th-grid">{group('light').map((t) => <ThemeCard key={t.id} t={t} active={active === t.id} onPick={() => pick(t)} onEdit={() => edit(t)} />)}</div>
        <div className="th-sec">Your themes</div>
        <div className="th-grid">
          {customs.map((t) => <ThemeCard key={t.id} t={t} active={active === t.id} onPick={() => pick(t)} onEdit={() => edit(t)} />)}
          <button className="th-card th-new" onClick={() => edit(findTheme(s))}>
            <Plus size={20} />
            <span>New theme</span>
            <span className="muted" style={{ fontSize: 12 }}>starts from the current one</span>
          </button>
        </div>
      </div>
    </Modal>
  );
}

export function ColorRow({ k, label, desc, value, onChange }) {
  const [text, setText] = useState(value);
  useEffect(() => setText(value), [value]);
  return (
    <div className="th-row">
      <label className="th-swatch" style={{ background: value }} title="Pick a colour">
        <input type="color" value={value} onChange={(e) => onChange(k, e.target.value)} />
      </label>
      <div className="grow" style={{ minWidth: 0 }}>
        <div className="th-row-l">{label}</div>
        <div className="th-row-d truncate">{desc}</div>
      </div>
      <input
        className="input th-hex" value={text} spellCheck={false} maxLength={7}
        onChange={(e) => { setText(e.target.value); const h = normHex(e.target.value); if (h && e.target.value.replace('#', '').length === 6) onChange(k, h); }}
        onBlur={() => { const h = normHex(text); if (h) onChange(k, h); else setText(value); }}
      />
    </div>
  );
}

/** Font tiles, each drawn in its own font (all previews load together when the editor opens). */
function FontPicker({ value, onChange }) {
  useEffect(() => loadFonts(FONTS), []);
  return (
    <div className="th-fonts">
      {FONTS.map((f) => (
        <button key={f.id} className={`th-font ${findFont(value).id === f.id ? 'on' : ''}`} style={{ fontFamily: fontStack(f), letterSpacing: f.track }} onClick={() => onChange(f.id)} title={f.note}>
          <b>Aa<span>123</span></b>
          <em>{f.name}</em>
          <small>{f.note}</small>
        </button>
      ))}
    </div>
  );
}

/** Side panel editor for one custom theme. The whole app previews changes live. */
export function ThemeEditor({ themeId, onClose }) {
  const { state, update } = useStore();
  const toast = useToast();
  const saved = (state.settings.customThemes || []).find((t) => t.id === themeId);
  const [draft, setDraft] = useState(() => saved && findTheme(state.settings, themeId));
  const [closed, setClosed] = useState({});
  const [del, setDel] = useState(false);
  const timer = useRef(null);
  const latest = useRef(draft);
  latest.current = draft;

  const save = (d = latest.current) => {
    clearTimeout(timer.current);
    if (!d) return;
    const { custom, blurb, ...rec } = d;
    setSettings(update, (st) => ({ customThemes: (st.customThemes || []).map((t) => (t.id === d.id ? rec : t)), ...themeSettings(d) }));
  };
  // live preview + save shortly after you stop changing things
  useEffect(() => {
    if (!draft) return;
    window.__themePreview = true;
    applyTheme(draft);
    clearTimeout(timer.current);
    timer.current = setTimeout(() => save(draft), 500);
  }, [draft]); // eslint-disable-line react-hooks/exhaustive-deps
  useEffect(() => () => { save(); window.__themePreview = false; }, []); // eslint-disable-line react-hooks/exhaustive-deps
  useEffect(() => {
    const k = (e) => e.key === 'Escape' && onClose();
    window.addEventListener('keydown', k);
    return () => window.removeEventListener('keydown', k);
  }, [onClose]);

  if (!draft) return null;
  const setColor = (k, v) => setDraft((d) => ({ ...d, colors: { ...d.colors, [k]: v } }));
  const from = TEMPLATES.find((t) => t.id === draft.from);
  const setBase = (base) => setDraft((d) => {
    if (d.base === base) return d;
    // switching dark/light starts from that side's template so the result is readable
    const tpl = TEMPLATES.find((t) => t.base === base);
    return { ...d, base, from: tpl.id, colors: { ...tpl.colors, primary: d.colors.primary, primary2: d.colors.primary2, primaryInk: d.colors.primaryInk } };
  });
  const duplicate = () => {
    save();
    const copy = { ...draft, id: uid('th'), name: `${draft.name} copy` };
    delete copy.custom; delete copy.blurb;
    setSettings(update, (st) => ({ customThemes: [...(st.customThemes || []), copy], ...themeSettings(copy) }));
    setDraft(copy);
    toast('Theme duplicated');
  };
  const remove = () => {
    clearTimeout(timer.current);
    window.__themePreview = false;
    const back = TEMPLATES.find((t) => t.id === (draft.from || (draft.base === 'light' ? 'daylight' : 'ronin')));
    setSettings(update, (st) => ({ customThemes: (st.customThemes || []).filter((t) => t.id !== draft.id), ...themeSettings(back) }));
    latest.current = null;
    setDraft(null);
    toast('Theme deleted');
    onClose();
  };
  const c = draft.colors;

  return (
    <div className="th-editor">
      <div className="th-ed-head">
        <input className="th-name" value={draft.name} onChange={(e) => setDraft((d) => ({ ...d, name: e.target.value }))} placeholder="Theme name" />
        <button className="icon-btn" title="Done" onClick={onClose}><X size={18} /></button>
      </div>
      <div className="th-ed-top">
        <Seg value={draft.base} onChange={setBase} options={[{ value: 'dark', label: 'Dark' }, { value: 'light', label: 'Light' }]} />
        <div className="th-sample" style={{ background: c.panel, borderColor: c.border }}>
          <span style={{ color: c.fg }}>Aa</span>
          <span style={{ color: c.muted }}>label</span>
          <b style={{ color: c.pos }}>+$412</b>
          <b style={{ color: c.neg }}>−$96</b>
          <span className="th-sample-btn" style={{ background: c.primary, color: c.primaryInk }}>Button</span>
        </div>
      </div>
      <div className="th-ed-body">
        <div className="th-group">
          <button className="th-group-h" onClick={() => setClosed((x) => ({ ...x, font: !x.font }))}>
            <span className="grow">Font</span>
            <span className="muted" style={{ fontWeight: 400, fontFamily: fontStack(findFont(draft.font)) }}>{findFont(draft.font).name}</span>
            <ChevronDown size={15} style={{ transform: closed.font ? 'rotate(-90deg)' : 'none', transition: 'transform .15s' }} />
          </button>
          {!closed.font && <FontPicker value={draft.font} onChange={(font) => setDraft((d) => ({ ...d, font }))} />}
        </div>
        {COLOR_GROUPS.map((g) => (
          <div key={g.id} className="th-group">
            <button className="th-group-h" onClick={() => setClosed((x) => ({ ...x, [g.id]: !x[g.id] }))}>
              <span className="grow">{g.label}</span>
              <span className="th-dots">{g.keys.map(([k]) => <i key={k} style={{ background: c[k] }} />)}</span>
              <ChevronDown size={15} style={{ transform: closed[g.id] ? 'rotate(-90deg)' : 'none', transition: 'transform .15s' }} />
            </button>
            {!closed[g.id] && g.keys.map(([k, , label, desc]) => <ColorRow key={k} k={k} label={label} desc={desc} value={c[k]} onChange={setColor} />)}
          </div>
        ))}
      </div>
      <div className="th-ed-foot">
        {from && <button className="btn" title={`Put every colour back to ${from.name}`} onClick={() => setDraft((d) => ({ ...d, colors: { ...from.colors } }))}><RotateCcw size={14} /> Reset</button>}
        <button className="btn" onClick={duplicate}><Copy size={14} /> Duplicate</button>
        <button className="btn" onClick={() => setDel(true)}><Trash size={14} /> Delete</button>
        <div className="grow" />
        <button className="btn white" onClick={onClose}>Done</button>
      </div>
      <Confirm open={del} title="Delete theme?" body={`"${draft.name}" will be removed and the journal goes back to ${from?.name || 'the default theme'}.`} onCancel={() => setDel(false)} onConfirm={remove} />
    </div>
  );
}

/** Sidebar entry point: theme row switch + picker + editor. */
export function useThemeStudio() {
  const [pickerOpen, setPickerOpen] = useState(false);
  const [editing, setEditing] = useState(null);
  const ui = (
    <>
      <ThemePicker open={pickerOpen} onClose={() => setPickerOpen(false)} onEdit={setEditing} />
      {editing && <ThemeEditor key={editing} themeId={editing} onClose={() => setEditing(null)} />}
    </>
  );
  return { openPicker: () => setPickerOpen(true), ui };
}
