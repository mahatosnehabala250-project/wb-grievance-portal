/**
 * prCard.ts — Hyperlocal PR factory (Level 15, Phase 1). Renders a per-village
 * "humne ye kiya" ACHIEVEMENT card as a shareable PNG (pure Canvas 2D, no dep,
 * client-only). Built from REAL resolved-complaint data the user already has.
 *
 * Privacy/ethics: AGGREGATE only — counts + category breakdown + avg rating.
 * NO individual citizen names (public broadcast → DPDP/consent). Honest wording:
 * "ab tak" (all-time resolved), not "is mahine" (data is not month-windowed).
 */

export interface PrCardData {
  orgName: string;
  village: string;
  count: number;
  avgRating: number | null;
  categories: Array<{ label: string; n: number }>;  // top categories, desc
  accent: string;
}

function wrap(ctx: CanvasRenderingContext2D, text: string, x: number, y: number, maxW: number, lh: number, maxLines = 2): number {
  const words = text.split(/\s+/);
  let line = '', lines = 0;
  for (let i = 0; i < words.length; i++) {
    const test = line ? `${line} ${words[i]}` : words[i];
    if (ctx.measureText(test).width > maxW && line) {
      ctx.fillText(line, x, y); line = words[i]; y += lh;
      if (++lines >= maxLines - 1) {
        let last = line;
        while (ctx.measureText(`${last}…`).width > maxW && last.length) last = last.slice(0, -1);
        ctx.fillText(`${last}…`, x, y); return y + lh;
      }
    } else line = test;
  }
  ctx.fillText(line, x, y); return y + lh;
}

export async function downloadVillagePrCard(d: PrCardData): Promise<void> {
  const W = 1080, H = 1350;
  const canvas = document.createElement('canvas');
  canvas.width = W; canvas.height = H;
  const ctx = canvas.getContext('2d');
  if (!ctx) return;
  const accent = /^#([0-9a-fA-F]{6})$/.test(d.accent) ? d.accent : '#BA7517';
  const ink = '#0f172a', muted = '#64748b', line = '#e2e8f0';

  ctx.fillStyle = '#ffffff'; ctx.fillRect(0, 0, W, H);

  // header band
  ctx.fillStyle = accent; ctx.fillRect(0, 0, W, 210);
  ctx.fillStyle = '#ffffff'; ctx.textBaseline = 'alphabetic';
  ctx.font = '600 50px sans-serif'; ctx.fillText(d.orgName.slice(0, 28), 64, 92);
  ctx.font = '400 30px sans-serif'; ctx.globalAlpha = 0.9; ctx.fillText('Kaam ki report', 64, 140); ctx.globalAlpha = 1;

  // village + headline number
  ctx.fillStyle = muted; ctx.font = '400 32px sans-serif'; ctx.fillText('Gaon', 64, 320);
  ctx.fillStyle = ink; ctx.font = '600 60px sans-serif';
  wrap(ctx, d.village, 64, 384, W - 128, 64, 1);

  ctx.fillStyle = accent; ctx.font = '600 130px sans-serif'; ctx.fillText(String(d.count), 64, 540);
  ctx.fillStyle = ink; ctx.font = '500 40px sans-serif'; ctx.fillText('shikayatein solve ✓', 64 + ctx.measureText(String(d.count)).width + 24, 540);
  ctx.fillStyle = muted; ctx.font = '400 26px sans-serif'; ctx.fillText('Ab tak pure kiye gaye kaam', 64, 580);

  ctx.fillStyle = line; ctx.fillRect(64, 620, W - 128, 2);

  // category breakdown (aggregate, no names)
  let y = 690;
  ctx.fillStyle = ink; ctx.font = '500 36px sans-serif'; ctx.fillText('Kis cheez mein:', 64, y); y += 56;
  const maxN = Math.max(1, ...d.categories.map(c => c.n));
  for (const c of d.categories.slice(0, 6)) {
    ctx.fillStyle = ink; ctx.font = '400 32px sans-serif';
    ctx.fillText(c.label, 64, y);
    ctx.textAlign = 'right'; ctx.fillStyle = accent; ctx.font = '600 32px sans-serif';
    ctx.fillText(String(c.n), W - 64, y); ctx.textAlign = 'left';
    // bar
    const barW = Math.round((W - 128) * (c.n / maxN));
    ctx.fillStyle = '#f1f5f9'; ctx.fillRect(64, y + 12, W - 128, 8);
    ctx.fillStyle = accent; ctx.fillRect(64, y + 12, barW, 8);
    y += 64;
  }

  // rating
  if (d.avgRating !== null) {
    y += 14;
    ctx.fillStyle = '#f8fafc'; ctx.fillRect(48, y - 36, W - 96, 92);
    ctx.fillStyle = accent; ctx.fillRect(48, y - 36, 8, 92);
    ctx.fillStyle = ink; ctx.font = '500 34px sans-serif';
    ctx.fillText(`★ Logon ki rating: ${d.avgRating} / 5`, 80, y + 18);
  }

  // footer
  ctx.fillStyle = muted; ctx.font = '400 26px sans-serif';
  ctx.fillText('Aapke gaon ke saath — JanSunwai', 64, H - 90);
  ctx.fillStyle = accent; ctx.font = '400 24px sans-serif';
  ctx.fillText('wb-grievance-portal.vercel.app', 64, H - 54);

  const blob: Blob | null = await new Promise((res) => canvas.toBlob(res, 'image/png'));
  if (!blob) return;
  const fname = `pr-${d.village.replace(/\s+/g, '-')}.png`;
  const file = new File([blob], fname, { type: 'image/png' });

  const nav = navigator as Navigator & { canShare?: (x: { files: File[] }) => boolean };
  if (nav.canShare && nav.canShare({ files: [file] })) {
    try { await nav.share({ files: [file], title: `${d.village} — kaam ki report` } as ShareData); return; } catch { /* fall through */ }
  }
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url; a.download = fname;
  document.body.appendChild(a); a.click(); a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}
