'use client';

import { useState, useEffect, useCallback } from 'react';
import { QrCode, RefreshCw, Printer, Check, Copy } from 'lucide-react';
import { Button } from '@/components/ui/button';
import {
  Dialog, DialogContent, DialogHeader, DialogTitle, DialogDescription,
} from '@/components/ui/dialog';
import { toast } from 'sonner';
import { authHeaders } from '@/lib/helpers';
import { printFrame } from '@/lib/print';

/**
 * Show the Telegram code on screen, big enough to scan off a monitor or phone.
 *
 * Printing a slip is the wrong default for this: the office would have to make
 * a PDF per visitor just to hand over a code that, without a ticket, is
 * identical for everyone. Holding up the screen takes a second and costs
 * nothing — the slip stays available for when the citizen wants the promise on
 * paper too.
 */

interface Props {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  /** Links this exact complaint when supplied; otherwise the code just opens the bot. */
  ticket?: string;
  officeName?: string;
}

export function TelegramQrDialog({ open, onOpenChange, ticket, officeName }: Props) {
  const [svg, setSvg] = useState('');
  const [link, setLink] = useState('');
  const [ticketed, setTicketed] = useState(false);
  const [loading, setLoading] = useState(false);
  const [copied, setCopied] = useState(false);

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const qs = ticket ? `?ticket=${encodeURIComponent(ticket)}` : '';
      const res = await fetch(`/api/telegram/qr${qs}`, { headers: authHeaders() });
      if (res.ok) {
        const j = await res.json();
        setSvg(j.svg || ''); setLink(j.link || ''); setTicketed(Boolean(j.ticketed));
      } else {
        const j = await res.json().catch(() => null);
        toast.error(j?.error || 'Could not load the code');
      }
    } catch { toast.error('Network error'); }
    setLoading(false);
  }, [ticket]);

  useEffect(() => { if (open) load(); }, [open, load]);

  const copy = useCallback(async () => {
    try {
      await navigator.clipboard.writeText(link);
      setCopied(true);
      setTimeout(() => setCopied(false), 1800);
    } catch { toast.error('Could not copy'); }
  }, [link]);

  const print = useCallback(() => {
    if (!svg) return;
    printFrame(
      `<!doctype html><html><head><meta charset="utf-8"></head>
<body style="font-family:Georgia,serif;text-align:center;padding:24mm 10mm;color:#111">
  <h1 style="font-size:18pt;margin:0 0 4px">${(officeName || 'Constituency Office').replace(/[&<>]/g, '')}</h1>
  <p style="margin:0 0 22px;font-size:11pt;color:#444">Scan to follow your complaint on Telegram</p>
  <div style="transform:scale(1.7);transform-origin:top center;margin-bottom:120px">${svg}</div>
  <p style="font-size:10pt;color:#555;word-break:break-all">${link}</p>
  <p style="font-size:9.5pt;color:#666;margin-top:14px">Send your ticket number to the bot and it will keep you updated.</p>
</body></html>`,
      'Telegram QR'
    );
  }, [svg, link, officeName]);

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-sm">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2">
            <QrCode className="h-4 w-4" /> Telegram code
          </DialogTitle>
          <DialogDescription>
            {ticketed
              ? 'Scanning links this complaint to their Telegram — nothing else for them to do.'
              : 'Hold up the screen. Scanning opens the bot, which asks for their ticket number.'}
          </DialogDescription>
        </DialogHeader>

        <div className="flex flex-col items-center gap-3">
          {loading ? (
            <div className="h-[220px] flex items-center justify-center text-muted-foreground gap-2">
              <RefreshCw className="h-4 w-4 animate-spin" /><span className="text-sm">Loading…</span>
            </div>
          ) : svg ? (
            // White plate regardless of theme: a dark-mode QR does not scan.
            <div className="rounded-lg bg-white p-3" dangerouslySetInnerHTML={{ __html: svg }} />
          ) : (
            <p className="text-sm text-muted-foreground py-10">No code available.</p>
          )}

          {link && (
            <button type="button" onClick={copy}
                    className="text-[11px] text-muted-foreground hover:text-foreground break-all flex items-center gap-1.5 px-2">
              {copied ? <Check className="h-3 w-3 text-emerald-600 shrink-0" /> : <Copy className="h-3 w-3 shrink-0" />}
              {copied ? 'Copied' : link}
            </button>
          )}

          <Button variant="outline" size="sm" className="gap-1.5 w-full" onClick={print} disabled={!svg}>
            <Printer className="h-3.5 w-3.5" /> Print for the desk
          </Button>
          <p className="text-[11px] text-muted-foreground text-center -mt-1">
            Print once and keep it on the counter — the code is the same for everyone.
          </p>
        </div>
      </DialogContent>
    </Dialog>
  );
}

export default TelegramQrDialog;
