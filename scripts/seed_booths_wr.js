/* Multi-AC seeder: reads ac<NNN>_booths.jsonl (w/r format) → prints one INSERT.
   Usage: node seed_booths_wr.js 238 240 241  (writes seed_batch.sql) */
const fs = require('fs');
const AC_NAME = { 238: 'Bandwan', 240: 'Baghmundi', 241: 'Joypur', 242: 'Purulia', 243: 'Manbazar', 244: 'Kashipur', 245: 'Para', 246: 'Raghunathpur' };
const rows = [];
let report = '';
for (const num of process.argv.slice(2).map(Number)) {
  const f = `ac${num}_booths.jsonl`;
  const ac = AC_NAME[num];
  if (!fs.existsSync(f) || !ac) { report += `${num}: MISSING\n`; continue; }
  const seen = new Set();
  let cnt = 0, sumW = 0, sumR = 0, bad = 0;
  for (const l of fs.readFileSync(f, 'utf8').split('\n')) {
    if (!l.trim().startsWith('{')) continue;
    try {
      const o = JSON.parse(l);
      const ps = String(o.ps ?? '').trim();
      if (!ps || seen.has(ps)) { bad++; continue; }
      seen.add(ps);
      const n = (v) => (v === null || v === undefined || isNaN(Number(v)) ? 'null' : Number(v));
      rows.push(`('${ac}',2021,'${ps.replace(/'/g, "''")}',${n(o.w)},${n(o.r)},${n(o.valid)},${n(o.nota)})`);
      cnt++; sumW += o.w || 0; sumR += o.r || 0;
    } catch { bad++; }
  }
  report += `${ac}: ${cnt} booths (skip ${bad}) | sum W=${sumW} R=${sumR}\n`;
}
fs.writeFileSync('seed_batch.sql',
  `insert into election_results_booth (ac, year, ps, w, r, valid, nota) values\n${rows.join(',\n')}\n` +
  `on conflict (ac,year,ps) do update set w=excluded.w, r=excluded.r, valid=excluded.valid, nota=excluded.nota;`);
console.log(report + `SQL rows: ${rows.length} -> seed_batch.sql`);
