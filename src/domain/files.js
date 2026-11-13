// قراءة ملفات الجداول بلا مكتبات (نقي): CSV، و Excel (.xlsx = أرشيف zip فيه XML، مضغوط بـ deflate).
// يعمل على WebView قديم (لا يعتمد على DecompressionStream).

// ---------- inflate (RFC 1951) ----------
const LBASE = [3, 4, 5, 6, 7, 8, 9, 10, 11, 13, 15, 17, 19, 23, 27, 31, 35, 43, 51, 59, 67, 83, 99, 115, 131, 163, 195, 227, 258];
const LEXT = [0, 0, 0, 0, 0, 0, 0, 0, 1, 1, 1, 1, 2, 2, 2, 2, 3, 3, 3, 3, 4, 4, 4, 4, 5, 5, 5, 5, 0];
const DBASE = [1, 2, 3, 4, 5, 7, 9, 13, 17, 25, 33, 49, 65, 97, 129, 193, 257, 385, 513, 769, 1025, 1537, 2049, 3073, 4097, 6145, 8193, 12289, 16385, 24577];
const DEXT = [0, 0, 0, 0, 1, 1, 2, 2, 3, 3, 4, 4, 5, 5, 6, 6, 7, 7, 8, 8, 9, 9, 10, 10, 11, 11, 12, 12, 13, 13];
const ORDER = [16, 17, 18, 0, 8, 7, 9, 6, 10, 5, 11, 4, 12, 3, 13, 2, 14, 1, 15];

function huffman(lengths) {
  const count = new Uint16Array(16);
  const symbols = new Uint16Array(lengths.length);
  for (const l of lengths) count[l]++;
  count[0] = 0;
  const offs = new Uint16Array(17);
  for (let i = 1; i < 16; i++) offs[i + 1] = offs[i] + count[i];
  for (let s = 0; s < lengths.length; s++) if (lengths[s]) symbols[offs[lengths[s]]++] = s;
  return { count, symbols };
}

export function inflateRaw(src, sizeHint = 0) {
  let pos = 0, bitBuf = 0, bitCnt = 0;
  let out = new Uint8Array(sizeHint || Math.max(1024, src.length * 4));
  let n = 0;
  const need = (k) => { if (n + k > out.length) { const b = new Uint8Array(Math.max(out.length * 2, n + k)); b.set(out); out = b; } };
  const bits = (k) => {
    while (bitCnt < k) { if (pos >= src.length) throw new Error('الملف تالف'); bitBuf |= src[pos++] << bitCnt; bitCnt += 8; }
    const v = bitBuf & ((1 << k) - 1);
    bitBuf >>>= k; bitCnt -= k;
    return v;
  };
  const decode = (h) => {
    let code = 0, first = 0, index = 0;
    for (let len = 1; len <= 15; len++) {
      code |= bits(1);
      const c = h.count[len];
      if (code - c < first) return h.symbols[index + (code - first)];
      index += c; first += c; first <<= 1; code <<= 1;
    }
    throw new Error('الملف تالف');
  };
  let fixed = null;
  for (;;) {
    const final = bits(1);
    const type = bits(2);
    if (type === 0) {
      bitBuf = 0; bitCnt = 0;
      const len = src[pos] | (src[pos + 1] << 8);
      pos += 4;
      need(len); out.set(src.subarray(pos, pos + len), n); n += len; pos += len;
    } else if (type === 1 || type === 2) {
      let lit, dist;
      if (type === 1) {
        if (!fixed) {
          const l = new Uint8Array(288);
          l.fill(8, 0, 144); l.fill(9, 144, 256); l.fill(7, 256, 280); l.fill(8, 280, 288);
          fixed = { lit: huffman(l), dist: huffman(new Uint8Array(30).fill(5)) };
        }
        lit = fixed.lit; dist = fixed.dist;
      } else {
        const hlit = bits(5) + 257, hdist = bits(5) + 1, hclen = bits(4) + 4;
        const cl = new Uint8Array(19);
        for (let i = 0; i < hclen; i++) cl[ORDER[i]] = bits(3);
        const ch = huffman(cl);
        const lens = new Uint8Array(hlit + hdist);
        for (let i = 0; i < hlit + hdist;) {
          const sym = decode(ch);
          if (sym < 16) lens[i++] = sym;
          else {
            let prev = 0, rep;
            if (sym === 16) { prev = lens[i - 1]; rep = 3 + bits(2); } else if (sym === 17) rep = 3 + bits(3); else rep = 11 + bits(7);
            while (rep--) lens[i++] = prev;
          }
        }
        lit = huffman(lens.subarray(0, hlit)); dist = huffman(lens.subarray(hlit));
      }
      for (;;) {
        let sym = decode(lit);
        if (sym === 256) break;
        if (sym < 256) { need(1); out[n++] = sym; continue; }
        sym -= 257;
        const len = LBASE[sym] + bits(LEXT[sym]);
        const ds = decode(dist);
        const d = DBASE[ds] + bits(DEXT[ds]);
        if (d > n) throw new Error('الملف تالف');
        need(len);
        for (let i = 0; i < len; i++, n++) out[n] = out[n - d];
      }
    } else throw new Error('الملف تالف');
    if (final) break;
  }
  return out.subarray(0, n);
}

// ---------- zip ----------
/** يقرأ أرشيف zip: Map(اسم الملف → Uint8Array). */
export function unzip(buf) {
  const dv = new DataView(buf.buffer, buf.byteOffset, buf.byteLength);
  let e = buf.length - 22;
  while (e >= 0 && dv.getUint32(e, true) !== 0x06054b50) e--;
  if (e < 0) throw new Error('الملف ليس ملف Excel صالحًا');
  const count = dv.getUint16(e + 10, true);
  let p = dv.getUint32(e + 16, true);
  const files = new Map();
  const dec = new TextDecoder();
  for (let i = 0; i < count; i++) {
    if (dv.getUint32(p, true) !== 0x02014b50) break;
    const method = dv.getUint16(p + 10, true), csize = dv.getUint32(p + 20, true), usize = dv.getUint32(p + 24, true);
    const nl = dv.getUint16(p + 28, true), el = dv.getUint16(p + 30, true), cl = dv.getUint16(p + 32, true), lo = dv.getUint32(p + 42, true);
    const name = dec.decode(buf.subarray(p + 46, p + 46 + nl));
    const start = lo + 30 + dv.getUint16(lo + 26, true) + dv.getUint16(lo + 28, true);
    const data = buf.subarray(start, start + csize);
    files.set(name, { method, data, usize });
    p += 46 + nl + el + cl;
  }
  return { has: (n) => files.has(n), names: () => [...files.keys()], read(n) { const f = files.get(n); if (!f) return null; return f.method === 0 ? f.data : inflateRaw(f.data, f.usize); } };
}

// ---------- xlsx ----------
function xmlText(s) {
  return s.replace(/&lt;/g, '<').replace(/&gt;/g, '>').replace(/&quot;/g, '"').replace(/&apos;/g, "'").replace(/&#(\d+);/g, (_, d) => String.fromCodePoint(Number(d)))
    .replace(/&#x([0-9a-f]+);/gi, (_, x) => String.fromCodePoint(parseInt(x, 16))).replace(/&amp;/g, '&');
}
function colIndex(ref) {
  let n = 0;
  for (const ch of ref) { const c = ch.charCodeAt(0); if (c < 65 || c > 90) break; n = n * 26 + (c - 64); }
  return n - 1;
}

/** أول ورقة في ملف xlsx ← صفوف من النصوص. */
export function readXlsx(buf) {
  const zip = unzip(buf);
  const dec = new TextDecoder();
  const shared = [];
  const ss = zip.read('xl/sharedStrings.xml');
  if (ss) for (const m of dec.decode(ss).matchAll(/<si[^>]*>([\s\S]*?)<\/si>/g)) shared.push(xmlText([...m[1].matchAll(/<t[^>]*>([\s\S]*?)<\/t>/g)].map((t) => t[1]).join('')));
  const sheetName = zip.names().filter((n) => /^xl\/worksheets\/sheet\d+\.xml$/.test(n)).sort((a, b) => a.length - b.length || (a < b ? -1 : 1))[0];
  if (!sheetName) throw new Error('لا ورقة في ملف Excel');
  const xml = dec.decode(zip.read(sheetName));
  const rows = [];
  for (const rm of xml.matchAll(/<row[^>]*>([\s\S]*?)<\/row>/g)) {
    const row = [];
    for (const cm of rm[1].matchAll(/<c\b([^>]*?)(?:\/>|>([\s\S]*?)<\/c>)/g)) {
      const attrs = cm[1], inner = cm[2] || '';
      const ref = /\br="([A-Z]+)\d+"/.exec(attrs);
      const type = /\bt="(\w+)"/.exec(attrs);
      const v = /<v>([\s\S]*?)<\/v>/.exec(inner);
      let val = '';
      if (type && type[1] === 's') val = v ? shared[Number(v[1])] ?? '' : '';
      else if (type && type[1] === 'inlineStr') val = xmlText([...inner.matchAll(/<t[^>]*>([\s\S]*?)<\/t>/g)].map((t) => t[1]).join(''));
      else val = v ? xmlText(v[1]) : '';
      const i = ref ? colIndex(ref[1]) : row.length;
      while (row.length < i) row.push('');
      row[i] = String(val).trim();
    }
    if (row.some((c) => c !== '')) rows.push(row);
  }
  return rows;
}

// ---------- csv ----------
/** CSV (فاصلة أو فاصلة منقوطة أو tab، مع علامات الاقتباس) ← صفوف. */
export function parseCsv(text) {
  let s = String(text).replace(/^﻿/, '');
  const first = s.split(/\r?\n/, 1)[0];
  const delim = [',', ';', '\t'].map((d) => [d, first.split(d).length]).sort((a, b) => b[1] - a[1])[0][0];
  const rows = [];
  let row = [], cell = '', q = false;
  for (let i = 0; i < s.length; i++) {
    const ch = s[i];
    if (q) {
      if (ch === '"') { if (s[i + 1] === '"') { cell += '"'; i++; } else q = false; } else cell += ch;
    } else if (ch === '"') q = true;
    else if (ch === delim) { row.push(cell.trim()); cell = ''; }
    else if (ch === '\n' || ch === '\r') {
      if (ch === '\r' && s[i + 1] === '\n') i++;
      row.push(cell.trim()); cell = '';
      if (row.some((c) => c !== '')) rows.push(row);
      row = [];
    } else cell += ch;
  }
  row.push(cell.trim());
  if (row.some((c) => c !== '')) rows.push(row);
  return rows;
}

/** يقرأ ملف جدول من بايتاته واسمه: xlsx أو csv. */
export function readTable(bytes, fileName = '') {
  const isZip = bytes.length > 4 && bytes[0] === 0x50 && bytes[1] === 0x4b;
  if (isZip) return readXlsx(bytes);
  if (/\.xls$/i.test(fileName)) throw new Error('ملف ‎.xls القديم غير مدعوم — احفظه من Excel بصيغة ‎.xlsx أو CSV');
  return parseCsv(new TextDecoder().decode(bytes));
}
