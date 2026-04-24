'use client';
import { useState, useEffect, useRef, useCallback } from 'react';
import { BookOpen, Upload, Plus, RefreshCw, Trash2, CheckCircle, Clock, FileText, Globe, Edit3 } from 'lucide-react';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Textarea } from '@/components/ui/textarea';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { toast } from 'sonner';
import { authHeaders } from '@/lib/helpers';
import { CATEGORY_LABELS } from '@/lib/constants';
import { useAuthStore } from '@/lib/auth-store';

interface Scheme {
  id: string; name: string; category: string;
  source_type: string; source_file: string | null;
  is_active: boolean; last_synced_at: string | null;
  added_by: string; valid_until: string | null;
}

const SOURCE_ICONS: Record<string, React.ReactNode> = {
  PDF: <FileText style={{width:12,height:12}} />,
  WEBSITE: <Globe style={{width:12,height:12}} />,
  MANUAL: <Edit3 style={{width:12,height:12}} />,
  NOTIFICATION: <FileText style={{width:12,height:12}} />,
};

export function SchemeKnowledgeView() {
  const user = useAuthStore(s => s.user);
  const isAdmin = user?.role === 'ADMIN' || user?.role === 'STATE';
  const [schemes, setSchemes] = useState<Scheme[]>([]);
  const [loading, setLoading] = useState(true);
  const [submitting, setSubmitting] = useState(false);
  const [mode, setMode] = useState<'list' | 'upload' | 'manual'>('list');
  const fileRef = useRef<HTMLInputElement>(null);

  const [form, setForm] = useState({
    source_type: 'PDF', source_name: '', text_content: '', source_url: '',
  });

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const res = await fetch('/api/schemes', { headers: authHeaders() });
      const data = await res.json();
      setSchemes(data.schemes || []);
    } catch { toast.error('Failed to load schemes'); }
    finally { setLoading(false); }
  }, []);

  useEffect(() => { load(); }, [load]);

  async function handleFileRead(e: React.ChangeEvent<HTMLInputElement>) {
    const file = e.target.files?.[0];
    if (!file) return;
    if (file.type !== 'application/pdf') { toast.error('Only PDF files supported'); return; }
    // For now extract text via a simple approach — in production use a PDF parser
    toast.info('PDF selected. Please paste the text content below (PDF text extraction requires server-side processing).');
    setForm(f => ({ ...f, source_name: file.name, source_type: 'PDF' }));
  }

  async function handleSubmit() {
    if (!form.text_content.trim() || form.text_content.trim().length < 50) {
      toast.error('Text content too short (min 50 characters)'); return;
    }
    setSubmitting(true);
    try {
      const res = await fetch('/api/schemes', {
        method: 'POST',
        headers: { ...authHeaders(), 'Content-Type': 'application/json' },
        body: JSON.stringify(form),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error);
      toast.success('Scheme sync triggered! Processing in background (~30 seconds).');
      setMode('list');
      setForm({ source_type: 'PDF', source_name: '', text_content: '', source_url: '' });
      setTimeout(load, 5000);
    } catch (e: any) {
      toast.error(e.message || 'Failed to sync');
    } finally { setSubmitting(false); }
  }

  async function handleDelete(id: string, name: string) {
    if (!confirm(`Deactivate "${name}"? Citizens won't see it anymore.`)) return;
    try {
      await fetch('/api/schemes', {
        method: 'DELETE',
        headers: { ...authHeaders(), 'Content-Type': 'application/json' },
        body: JSON.stringify({ id }),
      });
      toast.success('Scheme deactivated');
      load();
    } catch { toast.error('Failed'); }
  }

  const active = schemes.filter(s => s.is_active);
  const inactive = schemes.filter(s => !s.is_active);

  return (
    <div className="p-6 space-y-6 max-w-4xl mx-auto">
      <div className="flex items-center justify-between">
        <div className="flex items-center gap-3">
          <div className="w-10 h-10 rounded-xl bg-teal-100 dark:bg-teal-900/30 flex items-center justify-center">
            <BookOpen className="w-5 h-5 text-teal-600 dark:text-teal-400" />
          </div>
          <div>
            <h1 className="text-xl font-medium">Scheme knowledge base</h1>
            <p className="text-sm text-muted-foreground">{active.length} active schemes · citizens can ask on WhatsApp</p>
          </div>
        </div>
        <div className="flex gap-2">
          <Button variant="outline" size="sm" onClick={load} disabled={loading}>
            <RefreshCw className={`w-3.5 h-3.5 ${loading ? 'animate-spin' : ''}`} />
          </Button>
          {isAdmin && mode === 'list' && (
            <Button size="sm" onClick={() => setMode('upload')} className="gap-2">
              <Plus className="w-3.5 h-3.5" /> Add scheme
            </Button>
          )}
        </div>
      </div>

      {/* Upload / Manual entry form */}
      {mode !== 'list' && isAdmin && (
        <Card>
          <CardHeader className="pb-3">
            <CardTitle className="text-sm font-medium">Add new scheme</CardTitle>
          </CardHeader>
          <CardContent className="space-y-4">
            <div className="grid grid-cols-2 gap-3">
              <div className="space-y-1.5">
                <Label className="text-xs">Source type</Label>
                <Select value={form.source_type} onValueChange={v => setForm(f => ({ ...f, source_type: v }))}>
                  <SelectTrigger className="h-9 text-sm"><SelectValue /></SelectTrigger>
                  <SelectContent>
                    <SelectItem value="PDF">PDF / Circular</SelectItem>
                    <SelectItem value="NOTIFICATION">Govt Notification</SelectItem>
                    <SelectItem value="WEBSITE">Website content</SelectItem>
                    <SelectItem value="MANUAL">Manual entry</SelectItem>
                  </SelectContent>
                </Select>
              </div>
              <div className="space-y-1.5">
                <Label className="text-xs">Source name / filename</Label>
                <Input value={form.source_name} onChange={e => setForm(f => ({ ...f, source_name: e.target.value }))}
                  placeholder="e.g. pm_awas_circular_2026.pdf" className="h-9 text-sm" />
              </div>
            </div>

            {form.source_type === 'WEBSITE' && (
              <div className="space-y-1.5">
                <Label className="text-xs">Source URL</Label>
                <Input value={form.source_url} onChange={e => setForm(f => ({ ...f, source_url: e.target.value }))}
                  placeholder="https://wb.gov.in/scheme-page" className="h-9 text-sm" />
              </div>
            )}

            {form.source_type === 'PDF' && (
              <div className="space-y-1.5">
                <Label className="text-xs">Select PDF (to set filename)</Label>
                <input ref={fileRef} type="file" accept=".pdf" onChange={handleFileRead} className="hidden" />
                <Button variant="outline" size="sm" onClick={() => fileRef.current?.click()} className="gap-2">
                  <Upload className="w-3.5 h-3.5" /> Browse PDF
                </Button>
                {form.source_name && <p className="text-xs text-muted-foreground">{form.source_name}</p>}
              </div>
            )}

            <div className="space-y-1.5">
              <Label className="text-xs">
                Paste full text content from the PDF/notification/website *
              </Label>
              <Textarea
                value={form.text_content}
                onChange={e => setForm(f => ({ ...f, text_content: e.target.value }))}
                placeholder={`Paste the complete scheme text here. AI will automatically extract:
• Scheme name
• Eligibility criteria  
• Benefits and amounts
• How to apply (step by step)
• Helpline numbers
• Valid dates

Supports Hindi, Bengali, and English text.`}
                rows={10}
                className="text-sm font-mono"
              />
              <p className="text-xs text-muted-foreground">{form.text_content.length} characters · AI parses and structures automatically</p>
            </div>

            <div className="flex gap-2">
              <Button onClick={handleSubmit} disabled={submitting} className="gap-2">
                {submitting ? <RefreshCw className="w-3.5 h-3.5 animate-spin" /> : <Upload className="w-3.5 h-3.5" />}
                {submitting ? 'Processing...' : 'Sync to knowledge base'}
              </Button>
              <Button variant="ghost" onClick={() => setMode('list')}>Cancel</Button>
            </div>

            <div className="rounded-lg bg-teal-50 dark:bg-teal-950/20 p-3 text-xs text-teal-700 dark:text-teal-400 space-y-1">
              <p className="font-medium">What happens after sync:</p>
              <p>1. GPT-4o extracts structured scheme data from your text</p>
              <p>2. OpenAI generates a 1536-dim embedding for semantic search</p>
              <p>3. Saved to Supabase — available on WhatsApp in ~30 seconds</p>
              <p>4. Citizens can ask Sahayak: "PM Awas ke liye kaise apply karein?"</p>
            </div>
          </CardContent>
        </Card>
      )}

      {/* Active schemes list */}
      <div className="space-y-2">
        <div className="flex items-center justify-between">
          <p className="text-sm font-medium">Active schemes ({active.length})</p>
        </div>
        {loading ? (
          <div className="space-y-2">{[1,2,3].map(i => <div key={i} className="h-14 rounded-lg bg-secondary/40 animate-pulse" />)}</div>
        ) : active.length === 0 ? (
          <Card className="border-dashed"><CardContent className="py-8 text-center">
            <BookOpen className="w-6 h-6 mx-auto mb-2 text-muted-foreground/50" />
            <p className="text-sm text-muted-foreground">No schemes yet. Add one above.</p>
          </CardContent></Card>
        ) : (
          <div className="space-y-2">
            {active.map(s => (
              <div key={s.id} className="flex items-center gap-3 p-3 rounded-lg border border-border/50 bg-background hover:bg-secondary/20 transition-colors">
                <CheckCircle className="w-4 h-4 text-emerald-500 shrink-0" />
                <div className="flex-1 min-w-0">
                  <p className="text-sm font-medium truncate">{s.name}</p>
                  <div className="flex items-center gap-2 text-xs text-muted-foreground mt-0.5">
                    <span>{CATEGORY_LABELS[s.category] || s.category}</span>
                    <span>·</span>
                    <span className="flex items-center gap-1">
                      {SOURCE_ICONS[s.source_type]}
                      {s.source_type}
                    </span>
                    {s.source_file && <span>· {s.source_file}</span>}
                    {s.valid_until && <span>· expires {s.valid_until}</span>}
                  </div>
                </div>
                {isAdmin && (
                  <Button variant="ghost" size="sm" className="h-7 w-7 p-0 text-muted-foreground hover:text-red-500"
                    onClick={() => handleDelete(s.id, s.name)}>
                    <Trash2 className="w-3.5 h-3.5" />
                  </Button>
                )}
              </div>
            ))}
          </div>
        )}
      </div>

      {inactive.length > 0 && (
        <div className="space-y-2">
          <p className="text-xs text-muted-foreground">Inactive ({inactive.length})</p>
          <div className="space-y-1.5 opacity-50">
            {inactive.map(s => (
              <div key={s.id} className="flex items-center gap-3 p-2.5 rounded-lg bg-secondary/30 text-sm">
                <Clock className="w-3.5 h-3.5 shrink-0" />
                <span className="truncate line-through">{s.name}</span>
                <Badge variant="outline" className="text-[10px] ml-auto">inactive</Badge>
              </div>
            ))}
          </div>
        </div>
      )}

      {/* How to add future schemes guide */}
      <Card className="border-0 bg-secondary/30">
        <CardContent className="p-4 space-y-3">
          <p className="text-xs font-medium text-muted-foreground uppercase tracking-widest">Future scheme add karne ka process</p>
          <div className="grid grid-cols-1 gap-2 text-xs">
            <div className="flex gap-2"><span className="text-teal-600 font-medium shrink-0">PDF circular:</span><span>Add Scheme → PDF type → select file → paste text → Sync</span></div>
            <div className="flex gap-2"><span className="text-teal-600 font-medium shrink-0">Govt website:</span><span>Add Scheme → Website type → paste URL + full page text → Sync</span></div>
            <div className="flex gap-2"><span className="text-teal-600 font-medium shrink-0">Notification:</span><span>Add Scheme → Notification type → paste notification text → Sync</span></div>
            <div className="flex gap-2"><span className="text-teal-600 font-medium shrink-0">Auto (future):</span><span>wb.gov.in crawler weekly check karegi naye schemes ke liye</span></div>
          </div>
        </CardContent>
      </Card>
    </div>
  );
}
