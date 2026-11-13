/* ================= دفترة — ملف Excel (.xlsx) بلا مكتبات =================
   يبني ملف جدول يفتحه Excel و Google Sheets و LibreOffice، على الجهاز وبلا إنترنت.
   ملف xlsx أرشيف zip فيه ملفات XML. نكتبه بلا ضغط (stored): أبسط، ويكفي لحجم الدفتر.

   Xlsx.build(sheets) ← Uint8Array
     sheets: [{ name, cols: [عرض كل عمود بالأحرف], rows: [[خلية…]…] }]
     الصف الأول عناوين (خط عريض، يبقى ظاهرًا عند النزول). الخلية:
       نص ← نص · رقم ← رقم · Date ← تاريخ ووقت · null/'' ← فارغة
   الأوراق من اليمين إلى اليسار.
========================================================================= */
(function (global) {
  'use strict';

  var CRC = (function () {
    var t = new Uint32Array(256);
    for (var n = 0; n < 256; n++) {
      var c = n;
      for (var k = 0; k < 8; k++) c = (c & 1) ? (0xEDB88320 ^ (c >>> 1)) : (c >>> 1);
      t[n] = c >>> 0;
    }
    return t;
  })();
  function crc32(b) {
    var c = 0xFFFFFFFF;
    for (var i = 0; i < b.length; i++) c = CRC[(c ^ b[i]) & 0xFF] ^ (c >>> 8);
    return (c ^ 0xFFFFFFFF) >>> 0;
  }
  function utf8(s) { return new TextEncoder().encode(s); }

  // files: [{name, data: Uint8Array}] ← أرشيف zip بلا ضغط
  function zip(files) {
    var parts = [], central = [], offset = 0;
    function u16(v) { return [v & 255, (v >>> 8) & 255]; }
    function u32(v) { return [v & 255, (v >>> 8) & 255, (v >>> 16) & 255, (v >>> 24) & 255]; }
    files.forEach(function (f) {
      var name = utf8(f.name), crc = crc32(f.data), size = f.data.length;
      // 0x0800: الاسم UTF-8 · التاريخ ثابت (1980-01-01): الملف نفسه لنفس الدفتر
      var common = [].concat(u16(20), u16(0x0800), u16(0), u16(0), u16(0x21), u32(crc), u32(size), u32(size), u16(name.length), u16(0));
      var local = new Uint8Array([0x50, 0x4B, 0x03, 0x04].concat(common));
      parts.push(local, name, f.data);
      central.push(new Uint8Array([0x50, 0x4B, 0x01, 0x02].concat(u16(20), common, u16(0), u16(0), u16(0), u32(0), u32(offset))), name);
      offset += local.length + name.length + size;
    });
    var cdSize = central.reduce(function (n, p) { return n + p.length; }, 0);
    var end = new Uint8Array([0x50, 0x4B, 0x05, 0x06].concat(u16(0), u16(0), u16(files.length), u16(files.length), u32(cdSize), u32(offset), u16(0)));
    var all = parts.concat(central, [end]);
    var out = new Uint8Array(all.reduce(function (n, p) { return n + p.length; }, 0));
    var at = 0;
    all.forEach(function (p) { out.set(p, at); at += p.length; });
    return out;
  }

  // أحرف لا يقبلها XML تُحذف، والباقي يُهرَّب
  function esc(s) {
    return String(s).replace(/[\u0000-\u0008\u000B\u000C\u000E-\u001F￾￿]/g, '')
      .replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
  }
  function colName(i) {
    var s = '';
    for (i += 1; i > 0; i = Math.floor((i - 1) / 26)) s = String.fromCharCode(65 + (i - 1) % 26) + s;
    return s;
  }
  // رقم اليوم في Excel (بتوقيت الجهاز): أيام منذ 1899-12-30
  function serial(d) {
    return (d.getTime() - d.getTimezoneOffset() * 60000) / 86400000 + 25569;
  }

  function sheetXml(sh) {
    var rows = sh.rows.map(function (row, r) {
      var cells = row.map(function (v, c) {
        var ref = colName(c) + (r + 1);
        if (v == null || v === '') return '';
        if (v instanceof Date) {
          return isNaN(v.getTime()) ? '' : '<c r="' + ref + '" s="2"><v>' + serial(v) + '</v></c>';
        }
        if (typeof v === 'number' && isFinite(v)) return '<c r="' + ref + '"' + (r ? '' : ' s="1"') + '><v>' + v + '</v></c>';
        return '<c r="' + ref + '" t="inlineStr"' + (r ? '' : ' s="1"') + '><is><t xml:space="preserve">' + esc(v) + '</t></is></c>';
      }).join('');
      return '<row r="' + (r + 1) + '">' + cells + '</row>';
    }).join('');
    var cols = (sh.cols || []).map(function (w, i) {
      return '<col min="' + (i + 1) + '" max="' + (i + 1) + '" width="' + w + '" customWidth="1"/>';
    }).join('');
    return '<?xml version="1.0" encoding="UTF-8" standalone="yes"?>' +
      '<worksheet xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main">' +
      '<sheetViews><sheetView rightToLeft="1" workbookViewId="0">' +
      '<pane ySplit="1" topLeftCell="A2" activePane="bottomLeft" state="frozen"/></sheetView></sheetViews>' +
      (cols ? '<cols>' + cols + '</cols>' : '') +
      '<sheetData>' + rows + '</sheetData></worksheet>';
  }

  // اسم الورقة: 31 حرفًا على الأكثر، وبلا الأحرف التي يرفضها Excel
  function sheetName(n, i) {
    return String(n || '').replace(/[\\\/\?\*\[\]:]/g, ' ').slice(0, 31) || ('Sheet' + (i + 1));
  }

  var Xlsx = {
    MIME: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
    build: function (sheets) {
      var X = '<?xml version="1.0" encoding="UTF-8" standalone="yes"?>';
      var files = [
        { name: '[Content_Types].xml', text: X +
          '<Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types">' +
          '<Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/>' +
          '<Default Extension="xml" ContentType="application/xml"/>' +
          '<Override PartName="/xl/workbook.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.sheet.main+xml"/>' +
          '<Override PartName="/xl/styles.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.styles+xml"/>' +
          sheets.map(function (s, i) {
            return '<Override PartName="/xl/worksheets/sheet' + (i + 1) + '.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.worksheet+xml"/>';
          }).join('') + '</Types>' },
        { name: '_rels/.rels', text: X +
          '<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">' +
          '<Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/officeDocument" Target="xl/workbook.xml"/>' +
          '</Relationships>' },
        { name: 'xl/workbook.xml', text: X +
          '<workbook xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main" xmlns:r="http://schemas.openxmlformats.org/officeDocument/2006/relationships">' +
          '<bookViews><workbookView/></bookViews><sheets>' +
          sheets.map(function (s, i) {
            return '<sheet name="' + esc(sheetName(s.name, i)) + '" sheetId="' + (i + 1) + '" r:id="rId' + (i + 1) + '"/>';
          }).join('') + '</sheets></workbook>' },
        { name: 'xl/_rels/workbook.xml.rels', text: X +
          '<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">' +
          sheets.map(function (s, i) {
            return '<Relationship Id="rId' + (i + 1) + '" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/worksheet" Target="worksheets/sheet' + (i + 1) + '.xml"/>';
          }).join('') +
          '<Relationship Id="rId' + (sheets.length + 1) + '" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/styles" Target="styles.xml"/>' +
          '</Relationships>' },
        // الأنماط: 0 عادي · 1 عنوان عريض · 2 تاريخ ووقت
        { name: 'xl/styles.xml', text: X +
          '<styleSheet xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main">' +
          '<numFmts count="1"><numFmt numFmtId="164" formatCode="yyyy-mm-dd hh:mm"/></numFmts>' +
          '<fonts count="2"><font><sz val="11"/><name val="Calibri"/></font><font><b/><sz val="11"/><name val="Calibri"/></font></fonts>' +
          '<fills count="2"><fill><patternFill patternType="none"/></fill><fill><patternFill patternType="gray125"/></fill></fills>' +
          '<borders count="1"><border><left/><right/><top/><bottom/><diagonal/></border></borders>' +
          '<cellStyleXfs count="1"><xf numFmtId="0" fontId="0" fillId="0" borderId="0"/></cellStyleXfs>' +
          '<cellXfs count="3">' +
          '<xf numFmtId="0" fontId="0" fillId="0" borderId="0" xfId="0"/>' +
          '<xf numFmtId="0" fontId="1" fillId="0" borderId="0" xfId="0" applyFont="1"/>' +
          '<xf numFmtId="164" fontId="0" fillId="0" borderId="0" xfId="0" applyNumberFormat="1"/>' +
          '</cellXfs><cellStyles count="1"><cellStyle name="Normal" xfId="0" builtinId="0"/></cellStyles></styleSheet>' }
      ];
      sheets.forEach(function (s, i) {
        files.push({ name: 'xl/worksheets/sheet' + (i + 1) + '.xml', text: sheetXml(s) });
      });
      return zip(files.map(function (f) { return { name: f.name, data: utf8(f.text) }; }));
    }
  };

  global.Xlsx = Xlsx;
})(typeof window !== 'undefined' ? window : globalThis);
