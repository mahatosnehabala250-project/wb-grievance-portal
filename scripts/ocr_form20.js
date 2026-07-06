/* OCR ECI Form-20 (scanned) via Gemini vision.
   Usage: node ocr_form20.js <pdf> <outPrefix> [probe|extract] */
const { PDFDocument } = require('pdf-lib');
const fs = require('fs');

const KEY = fs.readFileSync('C:/Users/mahat/Downloads/wb-grievance-portal/.env', 'utf8').match(/GEMINI_API_KEY\s*=\s*(.+)/)[1].trim();
const MODEL = 'gemini-2.5-flash'; // stronger vision than -lite for table OCR

async function gemini(pdfB64, prompt, maxTokens = 30000) {
  const res = await fetch(`https://generativelanguage.googleapis.com/v1beta/models/${MODEL}:generateContent?key=${KEY}`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      contents: [{ parts: [{ inline_data: { mime_type: 'application/pdf', data: pdfB64 } }, { text: prompt }] }],
      generationConfig: { temperature: 0, maxOutputTokens: maxTokens },
    }),
  });
  const j = await res.json();
  if (j.error) throw new Error(`Gemini: ${j.error.message}`);
  return j.candidates?.[0]?.content?.parts?.map((p) => p.text || '').join('') || '';
}

async function slice(pdfPath, from, to) { // 0-based inclusive
  const src = await PDFDocument.load(fs.readFileSync(pdfPath));
  const out = await PDFDocument.create();
  const idx = [];
  for (let i = from; i <= Math.min(to, src.getPageCount() - 1); i++) idx.push(i);
  const pages = await out.copyPages(src, idx);
  pages.forEach((p) => out.addPage(p));
  return Buffer.from(await out.save()).toString('base64');
}

(async () => {
  const [pdf, outPrefix, cmd] = process.argv.slice(2);
  if (cmd === 'probe') {
    const b64 = await slice(pdf, 0, 1);
    const txt = await gemini(b64, `This is ECI Form 20 (final result sheet, booth-wise) for a West Bengal 2021 assembly constituency. Describe the table structure: (1) list ALL candidate column headers IN ORDER (leftmost to rightmost) with any party name shown, (2) what the first column is (serial no of polling station?), (3) whether polling-station NAMES appear anywhere, (4) any total/rejected/NOTA columns. Be precise and quote exactly what you see.`, 4000);
    console.log(txt);
    return;
  }
  // extract: 2-page chunks → JSONL
  const src = await PDFDocument.load(fs.readFileSync(pdf));
  const n = src.getPageCount();
  const all = [];
  for (let s = 0; s < n; s += 2) {
    const b64 = await slice(pdf, s, s + 1);
    const prompt = fs.readFileSync(outPrefix + '_prompt.txt', 'utf8');
    let txt = '';
    for (let attempt = 0; attempt < 3; attempt++) {
      try { txt = await gemini(b64, prompt); break; }
      catch (e) { console.error(`pages ${s}-${s + 1} attempt ${attempt + 1}: ${e.message}`); await new Promise((r) => setTimeout(r, 4000 * (attempt + 1))); }
    }
    const clean = txt.replace(/```jsonl?/gi, '').replace(/```/g, '').trim();
    const rows = clean.split('\n').map((l) => l.trim()).filter((l) => l.startsWith('{'));
    console.log(`pages ${s + 1}-${Math.min(s + 2, n)}: ${rows.length} rows`);
    all.push(...rows);
    await new Promise((r) => setTimeout(r, 1500));
  }
  fs.writeFileSync(outPrefix + '_booths.jsonl', all.join('\n'));
  console.log(`TOTAL rows: ${all.length} → ${outPrefix}_booths.jsonl`);
})().catch((e) => { console.error('FATAL', e.message); process.exit(1); });
