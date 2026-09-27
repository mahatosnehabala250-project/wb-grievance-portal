'use client';

import { useCallback, useState } from 'react';
import { toast } from 'sonner';
import { ComplaintDetailDialog } from '@/components/ComplaintDetailDialog';
import { authHeaders } from '@/lib/helpers';
import type { Complaint } from '@/lib/types';

/** Opens the existing complaint dialog from a bare id, loading the full record first. */
export function useComplaintOpener(onChanged: () => void) {
  const [complaint, setComplaint] = useState<Complaint | null>(null);
  const [open, setOpen] = useState(false);

  const openComplaint = useCallback(async (id: string) => {
    try {
      const r = await fetch(`/api/complaints/${encodeURIComponent(id)}`, { headers: authHeaders() });
      const j = await r.json();
      if (!r.ok || !j.complaint) throw new Error(j.error || 'Could not open this complaint');
      setComplaint(j.complaint);
      setOpen(true);
    } catch (e) {
      toast.error(e instanceof Error ? e.message : 'Could not open this complaint');
    }
  }, []);

  const dialog = (
    <ComplaintDetailDialog
      complaint={complaint}
      open={open}
      onOpenChange={(v) => { setOpen(v); if (!v) onChanged(); }}
      onUpdate={() => onChanged()}
    />
  );

  return { openComplaint, dialog };
}
