import { useState } from 'react';
import { PanelLeftClose, PanelLeft, Plus, Folder, Trash, Maximize, Minimize, Search, Pencil, FileText } from 'lucide-react';
import { useStore } from '../store/store';
import { Confirm, useToast } from '../components/ui';
import RichText from '../components/RichText';
import { uid, fmtDate, fmtTime12 } from '../lib/stats';

const strip = (html) => (html || '').replace(/<[^>]+>/g, ' ').replace(/&nbsp;/g, ' ').replace(/\s+/g, ' ').trim();

export default function Notebook() {
  const { state, setNotebook } = useStore();
  const toast = useToast();
  const { folders, notes } = state.notebook;
  const [folderId, setFolderId] = useState(folders[0]?.id || null);
  const [noteId, setNoteId] = useState(null);
  const [showF, setShowF] = useState(true);
  const [showN, setShowN] = useState(true);
  const [full, setFull] = useState(false);
  const [adding, setAdding] = useState(null);
  const [renaming, setRenaming] = useState(null);
  const [q, setQ] = useState('');
  const [del, setDel] = useState(null);
  const folderNotes = notes.filter((n) => n.folderId === folderId && (strip(n.body) + ' ' + n.title).toLowerCase().includes(q.toLowerCase())).sort((a, b) => b.updatedAt.localeCompare(a.updatedAt));
  const note = notes.find((n) => n.id === noteId);

  const addFolder = (name) => {
    const id = uid('f');
    setNotebook((nb) => ({ ...nb, folders: [...nb.folders, { id, name }] }));
    setFolderId(id);
    setNoteId(null);
  };
  const addNote = () => {
    if (!folderId) return;
    const id = uid('n');
    const now = new Date().toISOString();
    setNotebook((nb) => ({ ...nb, notes: [{ id, folderId, title: 'Untitled note', body: '', createdAt: now, updatedAt: now }, ...nb.notes] }));
    setNoteId(id);
  };
  const patchNote = (patch) => setNotebook((nb) => ({ ...nb, notes: nb.notes.map((n) => (n.id === noteId ? { ...n, ...patch, updatedAt: new Date().toISOString() } : n)) }));

  return (
    <div className={`nb ${showF ? '' : 'no-f'} ${showN ? '' : 'no-n'} ${full ? 'full' : ''}`}>
      <div className="nb-col folders">
        {showF ? (
          <>
            <div className="hd">Folders <button className="icon-btn" style={{ width: 26, height: 26, border: '1px solid var(--border-2)' }} onClick={() => setShowF(false)} title="Collapse folders panel"><PanelLeftClose size={14} /></button></div>
            <div style={{ flex: '0 1 auto', overflow: 'auto' }}>
              {folders.length === 0 && adding === null && <div className="muted" style={{ textAlign: 'center', padding: '20px 0 40px', borderBottom: '1px solid var(--border)', margin: '0 8px' }}>No folders yet</div>}
              {folders.map((f) => (
                <div key={f.id} className={`nb-item ${f.id === folderId ? 'on' : ''}`} onClick={() => { setFolderId(f.id); setNoteId(null); }} onDoubleClick={() => setRenaming(f.id)}>
                  <Folder size={15} className="muted" />
                  {renaming === f.id ? (
                    <input className="input" style={{ height: 26 }} autoFocus defaultValue={f.name} onBlur={(e) => { const v = e.target.value.trim(); if (v) setNotebook((nb) => ({ ...nb, folders: nb.folders.map((x) => (x.id === f.id ? { ...x, name: v } : x)) })); setRenaming(null); }} onKeyDown={(e) => e.key === 'Enter' && e.target.blur()} />
                  ) : <span className="grow truncate">{f.name}</span>}
                  <span className="muted" style={{ fontSize: 12 }}>{notes.filter((n) => n.folderId === f.id).length}</span>
                  <button className="muted" title="Rename" onClick={(e) => { e.stopPropagation(); setRenaming(f.id); }}><Pencil size={12} /></button>
                  <button className="muted" title="Delete folder" onClick={(e) => { e.stopPropagation(); setDel({ type: 'folder', id: f.id, name: f.name }); }}><Trash size={12} /></button>
                </div>
              ))}
              {adding !== null && (
                <div className="nb-item">
                  <Folder size={15} className="muted" />
                  <input className="input" style={{ height: 28 }} autoFocus placeholder="Folder name" value={adding} onChange={(e) => setAdding(e.target.value)}
                    onKeyDown={(e) => { if (e.key === 'Enter' && adding.trim()) { addFolder(adding.trim()); setAdding(null); } if (e.key === 'Escape') setAdding(null); }}
                    onBlur={() => { if (adding.trim()) addFolder(adding.trim()); setAdding(null); }} />
                </div>
              )}
            </div>
            <button className="row gap8 center muted" style={{ padding: '24px 0', fontSize: 14 }} onClick={() => setAdding('')}><Plus size={16} /> Add folder</button>
          </>
        ) : (
          <button className="icon-btn" style={{ margin: '14px auto', border: '1px solid var(--border-2)', width: 26, height: 26 }} onClick={() => setShowF(true)} title="Expand folders panel"><PanelLeft size={14} /></button>
        )}
      </div>

      <div className="nb-col notes">
        {showN ? (
          <>
            <div className="hd">
              Notes
              <span className="row gap6">
                {folderId && <button className="icon-btn" style={{ width: 26, height: 26 }} onClick={addNote} title="New note"><Plus size={15} /></button>}
                <button className="icon-btn" style={{ width: 26, height: 26, border: '1px solid var(--border-2)' }} onClick={() => setShowN(false)} title="Collapse notes panel"><PanelLeftClose size={14} /></button>
              </span>
            </div>
            {!folderId ? (
              <div className="muted" style={{ textAlign: 'center', padding: 22 }}>Select a folder</div>
            ) : (
              <>
                <div className="row gap8" style={{ margin: '0 12px 10px', padding: '0 10px', border: '1px solid var(--border-2)', height: 34 }}>
                  <Search size={14} className="muted" />
                  <input className="grow" style={{ background: 'transparent', border: 0, outline: 'none' }} placeholder="Search notes" value={q} onChange={(e) => setQ(e.target.value)} />
                </div>
                <div style={{ overflow: 'auto', flex: 1 }}>
                  {folderNotes.length === 0 && (
                    <div className="empty" style={{ padding: 30 }}>
                      No notes here yet
                      <button className="btn sm" onClick={addNote}><Plus size={14} /> New note</button>
                    </div>
                  )}
                  {folderNotes.map((n) => (
                    <div key={n.id} className={`nb-note ${n.id === noteId ? 'on' : ''}`} onClick={() => setNoteId(n.id)}>
                      <div className="row between"><b className="truncate" style={{ fontWeight: 500 }}>{n.title || 'Untitled note'}</b></div>
                      <div className="muted truncate" style={{ fontSize: 12.5, marginTop: 4 }}>{strip(n.body) || 'No content'}</div>
                      <div className="muted2" style={{ fontSize: 11.5, marginTop: 6 }}>{fmtDate(n.updatedAt)}</div>
                    </div>
                  ))}
                </div>
              </>
            )}
          </>
        ) : (
          <button className="icon-btn" style={{ margin: '14px auto', border: '1px solid var(--border-2)', width: 26, height: 26 }} onClick={() => setShowN(true)} title="Expand notes panel"><PanelLeft size={14} /></button>
        )}
      </div>

      <div className="nb-editor">
        <div className="row" style={{ justifyContent: 'flex-end', padding: '14px 20px 0', gap: 10 }}>
          {note && <button className="btn xs danger" onClick={() => setDel({ type: 'note', id: note.id, name: note.title })}><Trash size={13} /> Delete</button>}
          <button className="row gap6" style={{ fontSize: 12.5 }} onClick={() => setFull((f) => !f)}>{full ? <Minimize size={15} /> : <Maximize size={15} />} {full ? 'Exit full screen' : 'Full screen'}</button>
        </div>
        {note ? (
          <div className="col" style={{ flex: 1, minHeight: 0, maxWidth: 900, width: '100%', margin: '0 auto', padding: '10px 20px 20px' }}>
            <input value={note.title} onChange={(e) => patchNote({ title: e.target.value })} placeholder="Untitled note" style={{ background: 'transparent', border: 0, outline: 'none', fontSize: 28, fontWeight: 500, letterSpacing: '-0.03em', padding: '10px 22px 4px' }} />
            <div className="muted" style={{ fontSize: 12, padding: '0 22px 12px' }}>Last edited {fmtDate(note.updatedAt)} at {fmtTime12(note.updatedAt)}</div>
            <RichText toolbarTop docKey={note.id} value={note.body} onChange={(body) => patchNote({ body })} placeholder="Write your trading notes, ideas, rules… paste screenshots directly." style={{ flex: 1, border: '1px solid var(--border)' }} minHeight={400} />
          </div>
        ) : (
          <div className="empty" style={{ flex: 1 }}>
            <FileText size={28} className="muted2" />
            Select a note
          </div>
        )}
      </div>
      <Confirm
        open={!!del}
        title={del?.type === 'folder' ? `Delete folder “${del?.name}”?` : 'Delete note?'}
        body={del?.type === 'folder' ? 'The folder and all of its notes will be deleted.' : 'This note will be permanently deleted.'}
        onCancel={() => setDel(null)}
        onConfirm={() => {
          if (del.type === 'folder') {
            setNotebook((nb) => ({ folders: nb.folders.filter((f) => f.id !== del.id), notes: nb.notes.filter((n) => n.folderId !== del.id) }));
            if (folderId === del.id) { setFolderId(null); setNoteId(null); }
          } else {
            setNotebook((nb) => ({ ...nb, notes: nb.notes.filter((n) => n.id !== del.id) }));
            setNoteId(null);
          }
          setDel(null);
          toast('Deleted');
        }}
      />
    </div>
  );
}
