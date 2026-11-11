// Minimal, dependency-free .xlsx reader (zip + SpreadsheetML) for the browser.
// Returns every sheet as a 2-D array of cell values. Dates are returned as
// "YYYY-MM-DDTHH:mm:ss" strings when the cell uses a date number format.

const td = new TextDecoder();

async function inflateRaw(bytes) {
  const ds = new DecompressionStream('deflate-raw');
  const stream = new Blob([bytes]).stream().pipeThrough(ds);
  return new Uint8Array(await new Response(stream).arrayBuffer());
}

async function unzip(buf) {
  const u8 = new Uint8Array(buf);
  const dv = new DataView(buf);
  let eocd = -1;
  if (dv.getUint32(0, true) !== 0x04034b50) throw new Error('This is not an .xlsx file (it may be an old .xls or a renamed file).');
  for (let i = u8.length - 22; i >= Math.max(0, u8.length - 66000); i--) {
    if (dv.getUint32(i, true) === 0x06054b50) { eocd = i; break; }
  }
  if (eocd < 0) throw new Error('Not a valid .xlsx file');
  const count = dv.getUint16(eocd + 10, true);
  let p = dv.getUint32(eocd + 16, true);
  const files = {};
  for (let n = 0; n < count; n++) {
    if (dv.getUint32(p, true) !== 0x02014b50) break;
    const method = dv.getUint16(p + 10, true);
    const csize = dv.getUint32(p + 20, true);
    const nlen = dv.getUint16(p + 28, true);
    const xlen = dv.getUint16(p + 30, true);
    const clen = dv.getUint16(p + 32, true);
    const off = dv.getUint32(p + 42, true);
    const name = td.decode(u8.subarray(p + 46, p + 46 + nlen));
    files[name] = { method, csize, off };
    p += 46 + nlen + xlen + clen;
  }
  const read = async (name) => {
    const f = files[name];
    if (!f) return null;
    const lnlen = dv.getUint16(f.off + 26, true);
    const lxlen = dv.getUint16(f.off + 28, true);
    const start = f.off + 30 + lnlen + lxlen;
    const data = u8.subarray(start, start + f.csize);
    return td.decode(f.method === 0 ? data : await inflateRaw(data));
  };
  return { names: Object.keys(files), read };
}

// Strip a UTF-8 BOM / leading junk before the XML declaration (ATAS writes one in some parts).
const xml = (s) => new DOMParser().parseFromString(String(s || '').replace(/^[\s\S]*?(?=<\?xml|<[A-Za-z])/, ''), 'application/xml');
// Namespace-agnostic: matches <row> as well as prefixed <x:row> (.NET OpenXML SDK output).
const byTag = (node, tag) => [...node.getElementsByTagNameNS('*', tag)];
const first = (node, tag) => node.getElementsByTagNameNS('*', tag)[0];

const pad = (n) => String(n).padStart(2, '0');
export function serialToIso(v) {
  // Excel 1900 date system (with the 1900 leap-year bug offset)
  const ms = Math.round((v - 25569) * 86400000);
  const d = new Date(ms);
  return `${d.getUTCFullYear()}-${pad(d.getUTCMonth() + 1)}-${pad(d.getUTCDate())}T${pad(d.getUTCHours())}:${pad(d.getUTCMinutes())}:${pad(d.getUTCSeconds())}`;
}

const colIndex = (ref) => {
  const letters = ref.replace(/[0-9]/g, '');
  let n = 0;
  for (const c of letters) n = n * 26 + (c.charCodeAt(0) - 64);
  return n - 1;
};

export async function readXlsx(buf) {
  const zip = await unzip(buf);
  const wb = xml(await zip.read('xl/workbook.xml'));
  const rels = xml((await zip.read('xl/_rels/workbook.xml.rels')) || '<Relationships/>');
  const relMap = Object.fromEntries(byTag(rels, 'Relationship').map((r) => [r.getAttribute('Id'), r.getAttribute('Target')]));

  const ssXml = await zip.read('xl/sharedStrings.xml');
  const shared = ssXml ? byTag(xml(ssXml), 'si').map((si) => byTag(si, 't').map((t) => t.textContent).join('')) : [];

  // date-formatted styles
  const dateStyles = new Set();
  const stXml = await zip.read('xl/styles.xml');
  if (stXml) {
    const st = xml(stXml);
    const custom = {};
    byTag(st, 'numFmt').forEach((f) => { custom[f.getAttribute('numFmtId')] = f.getAttribute('formatCode') || ''; });
    const cellXfs = first(st, 'cellXfs');
    if (cellXfs) {
      byTag(cellXfs, 'xf').forEach((xf, i) => {
        const id = Number(xf.getAttribute('numFmtId'));
        const code = (custom[id] || '').replace(/"[^"]*"|\[[^\]]*\]/g, '').toLowerCase();
        if ((id >= 14 && id <= 22) || (id >= 45 && id <= 47) || /[dy]|h+:?m|m+:?s/.test(code)) dateStyles.add(i);
      });
    }
  }

  const sheets = [];
  for (const s of byTag(wb, 'sheet')) {
    const rid = s.getAttributeNS('http://schemas.openxmlformats.org/officeDocument/2006/relationships', 'id') || s.getAttribute('r:id') || [...s.attributes].find((a) => a.localName === 'id')?.value;
    let target = relMap[rid] || '';
    target = target.startsWith('/') ? target.slice(1) : 'xl/' + target.replace(/^\.\//, '');
    const sx = await zip.read(target);
    if (!sx) continue;
    const doc = xml(sx);
    const rows = [];
    for (const r of byTag(doc, 'row')) {
      const ri = Number(r.getAttribute('r')) - 1;
      const row = [];
      for (const c of byTag(r, 'c')) {
        const ref = c.getAttribute('r');
        const ci = ref ? colIndex(ref) : row.length;
        const t = c.getAttribute('t');
        const sIdx = Number(c.getAttribute('s') || 0);
        const v = first(c, 'v')?.textContent;
        let val = '';
        if (t === 's') val = shared[Number(v)] ?? '';
        else if (t === 'inlineStr') val = byTag(c, 't').map((x) => x.textContent).join('');
        else if (t === 'b') val = v === '1';
        else if (t === 'str' || t === 'e') val = v ?? '';
        else if (v !== undefined) {
          const num = Number(v);
          val = dateStyles.has(sIdx) && num > 20000 && num < 80000 ? serialToIso(num) : num;
        }
        row[ci] = val;
      }
      rows[ri] = Array.from(row, (x) => (x === undefined ? '' : x));
    }
    sheets.push({ name: s.getAttribute('name'), rows: Array.from(rows, (x) => x || []) });
  }
  return { sheets };
}
