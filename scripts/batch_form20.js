/* Batch OCR of ECI Form-20 for Purulia ACs. Restartable: skips ACs whose
   ac<NNN>_booths.jsonl already exists. Usage: node batch_form20.js 238 240 241 */
const { PDFDocument } = require('pdf-lib');
const fs = require('fs');

const KEY = fs.readFileSync('C:/Users/mahat/Downloads/wb-grievance-portal/.env', 'utf8').match(/GEMINI_API_KEY\s*=\s*(.+)/)[1].trim();
const MODEL = process.env.OCR_MODEL || 'gemini-2.5-flash';

// Verified 2021 winner + runner-up candidate names per AC (from SESSION 59 sourcing)
const ACS = {
  238: { ac: 'Bandwan',      w: 'Rajib Lochan Saren',    wp: 'AITC', r: 'Parcy Murmu',            rp: 'BJP'  },
  240: { ac: 'Baghmundi',    w: 'Sushanta Mahato',        wp: 'AITC', r: 'Asutosh Mahato',         rp: 'AJSU' },
  241: { ac: 'Joypur',       w: 'Narahari Mahato',        wp: 'BJP',  r: 'Phanibhusan Kumar',      rp: 'INC'  },
  242: { ac: 'Purulia',      w: 'Sudip Kumar Mukherjee',  wp: 'BJP',  r: 'Sujoy Banerjee',         rp: 'AITC' },
  243: { ac: 'Manbazar',     w: 'Sandhyarani Tudu',       wp: 'AITC', r: 'Gouri Singh Sardar',     rp: 'BJP'  },
  244: { ac: 'Kashipur',     w: 'Kamalakanta Hansda',     wp: 'BJP',  r: 'Swapan Kumar Beltharia', rp: 'AITC' },
  245: { ac: 'Para',         w: 'Nadiar Chand Bouri',     wp: 'BJP',  r: 'Umapada Bauri',          rp: 'AITC' },
  246: { ac: 'Raghunathpur', w: 'Vivekananda Bauri',      wp: 'BJP',  r: 'Bouri Hazari',           rp: 'AITC' },
};

async function gemini(pdfB64, prompt) {
  const res = await fetch(`https://generativelanguage.googleapis.com/v1beta/models/${MODEL}:generateContent?key=${KEY}`, {
    method: 'POST', headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      contents: [{ parts: [{ inline_data: { mime_type: 'application/pdf', data: pdfB64 } }, { text: prompt }] }],
      generationConfig: { temperature: 0, maxOutputTokens: 30000 },
    }),
  });
  const j = await res.json();
  if (j.error) throw new Error(j.error.message);
  return j.candidates?.[0]?.content?.parts?.map((p) => p.text || '').join('') || '';
}

async function slice(pdfPath, from, to) {
  const src = await PDFDocument.load(fs.readFileSync(pdfPath));
  const out = await PDFDocument.create();
  const idx = [];
  for (let i = from; i <= Math.min(to, src.getPageCount() - 1); i++) idx.push(i);
  const pages = await out.copyPages(src, idx);
  pages.forEach((p) => out.addPage(p));
  return Buffer.from(await out.save()).toString('base64');
}

function promptFor(meta) {
  return `This is ECI Form 20 (booth-wise final result sheet) for ${meta.ac} AC, West Bengal 2021 assembly election. Among the candidate vote columns are "${meta.w}" (winner) and "${meta.r}" (runner-up) — find those two columns by candidate name in the header.

Extract EVERY polling-station row on these pages as JSONL — one JSON object per line, NO markdown, NO commentary:
{"ps":"<Serial No of Polling Station exactly as printed, e.g. 1 or 4A>","w":<votes for ${meta.w}>,"r":<votes for ${meta.r}>,"valid":<Total No of valid votes>,"nota":<NOTA>}

Rules: read digits EXACTLY as printed. Skip header rows, page totals, "Total" summary rows, and postal/EVM summary rows — only individual polling-station rows. Unreadable cell -> null. Output ONLY JSONL lines.`;
}

(async () => {
  const targets = process.argv.slice(2).map(Number);
  for (const num of targets) {
    const meta = ACS[num];
    if (!meta) { console.log(`SKIP ${num}: unknown AC`); continue; }
    const outFile = `ac${num}_booths.jsonl`;
    if (fs.existsSync(outFile)) { console.log(`SKIP ${num} (${meta.ac}): ${outFile} exists`); continue; }
    const pdf = `${num}_Form20.pdf`;
    if (!fs.existsSync(pdf)) {
      console.log(`DOWNLOAD ${num}...`);
      const r = await fetch(`https://ceowestbengal.wb.gov.in/Downloads/Election/GE2021/Form20/${num}_Form20.pdf`);
      if (!r.ok) { console.log(`FAIL download ${num}: HTTP ${r.status}`); continue; }
      fs.writeFileSync(pdf, Buffer.from(await r.arrayBuffer()));
    }
    const doc = await PDFDocument.load(fs.readFileSync(pdf));
    const n = doc.getPageCount();
    console.log(`=== AC ${num} ${meta.ac}: ${n} pages ===`);
    const all = [];
    for (let s = 0; s < n; s += 2) {
      const b64 = await slice(pdf, s, s + 1);
      let txt = '';
      for (let attempt = 0; attempt < 5; attempt++) {
        try { txt = await gemini(b64, promptFor(meta)); break; }
        catch (e) { console.log(`  p${s + 1}-${s + 2} try${attempt + 1}: ${e.message.slice(0, 70)}`); await new Promise((x) => setTimeout(x, 5000 * (attempt + 1))); }
      }
      const rows = txt.replace(/```jsonl?/gi, '').replace(/```/g, '').split('\n').map((l) => l.trim()).filter((l) => l.startsWith('{'));
      console.log(`  pages ${s + 1}-${Math.min(s + 2, n)}: ${rows.length} rows`);
      all.push(...rows);
      await new Promise((x) => setTimeout(x, 2000));
    }
    fs.writeFileSync(outFile, all.join('\n'));
    console.log(`AC ${num} ${meta.ac}: TOTAL ${all.length} rows -> ${outFile}`);
  }
  console.log('BATCH DONE');
})().catch((e) => { console.error('FATAL', e.message); process.exit(1); });
