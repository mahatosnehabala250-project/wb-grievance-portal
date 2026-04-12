'use client';

import { useState, useEffect, useCallback, useMemo, useRef } from 'react';
import {
  Shield, LayoutDashboard, FileText, Users, Bell, Sun, Moon, Menu,
  Search, Filter, X, Eye, Download, Plus, ArrowUpDown, ChevronLeft,
  ChevronRight, Clock, AlertTriangle, CheckCircle2, Activity, MapPin,
  LogOut, RefreshCw, MoreHorizontal, Phone, CalendarDays, Hash,
  Building2, UserCog, TrendingUp, ArrowUpRight, ArrowDownRight,
  CircleDot, Send, Trash2, KeyRound,
  RotateCcw, Zap, Star, Clock3, CheckCircle, XCircle, ChevronDown,
  ArrowLeft, MessageSquare, ShieldCheck, Globe, BarChart2,
  Printer, UserCircle, Hand, Gauge, Timer, Award, BadgeCheck, PlayCircle, Ban, CircleCheckBig,
  Settings, CircleHelp, Monitor, Mail, Volume2, LayoutGrid, Keyboard,
  UserCheck, GitCompareArrows, CalendarClock, History, Tag, ClipboardList,
  AlertCircle, Info, CheckCircle2 as CheckCircleFill, Sparkles, Megaphone,
  ArrowUp, Flame, CalendarRange, TimerReset,
} from 'lucide-react';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Skeleton } from '@/components/ui/skeleton';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Textarea } from '@/components/ui/textarea';
import { Progress } from '@/components/ui/progress';
import { Separator } from '@/components/ui/separator';
import { Switch } from '@/components/ui/switch';
import { ScrollArea } from '@/components/ui/scroll-area';
import {
  Table, TableBody, TableCell, TableHead, TableHeader, TableRow,
} from '@/components/ui/table';
import {
  ChartContainer, ChartTooltip, ChartTooltipContent, ChartLegend, ChartLegendContent,
} from '@/components/ui/chart';
import {
  Dialog, DialogContent, DialogHeader, DialogTitle, DialogDescription, DialogFooter,
} from '@/components/ui/dialog';
import {
  DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuTrigger,
  DropdownMenuSeparator, DropdownMenuLabel,
} from '@/components/ui/dropdown-menu';
import {
  Select, SelectContent, SelectItem, SelectTrigger, SelectValue,
} from '@/components/ui/select';
import {
  Sheet, SheetContent, SheetHeader, SheetTitle, SheetDescription,
} from '@/components/ui/sheet';
import {
  BarChart, Bar, XAxis, YAxis, CartesianGrid, PieChart, Pie, Cell,
  AreaChart, Area, ResponsiveContainer, Legend,
} from 'recharts';
import { toast } from 'sonner';
import { useTheme } from 'next-themes';
import { useAuthStore } from '@/lib/auth-store';
import { motion, AnimatePresence } from 'framer-motion';
import type { Complaint, ActivityLogEntry, AssignableUser, AppUser, DashboardData, ViewType, AuditEntry } from '@/lib/types';
import { NAVY, NAVY_DARK, STATUS_MAP, URGENCY_MAP, URGENCY_BORDER_MAP, ROLE_MAP, ROLE_COLORS, CATEGORIES, CATEGORY_COLORS } from '@/lib/constants';
import { fmtDate, fmtDateTime, fmtStatus, fmtUrgency, fmtRole, safeGetLocalStorage, safeSetLocalStorage, authHeaders, getDaysOld, getSLAInfo, playNotificationSound } from '@/lib/helpers';
import { StatusBadge, UrgencyBadge, RoleBadge, StatCard, MiniStat, PieLabel, LoadingSkeleton, EmptyState } from '@/components/common';

export function ComplaintDetailDialog({ complaint: initialComplaint, open, onOpenChange, onUpdate }: {
  complaint: Complaint | null; open: boolean; onOpenChange: (v: boolean) => void;
  onUpdate?: (id: string, status: string, resolution?: string) => void;
}) {
  const [complaint, setComplaint] = useState<Complaint | null>(null);
  const [resolutionText, setResolutionText] = useState('');
  const [newStatus, setNewStatus] = useState('');
  const [updating, setUpdating] = useState(false);
  const [assignableUsers, setAssignableUsers] = useState<AssignableUser[]>([]);
  const [selectedAssignee, setSelectedAssignee] = useState('');
  const [assigning, setAssigning] = useState(false);
  const [activities, setActivities] = useState<ActivityLogEntry[]>([]);
  const [loadingActivity, setLoadingActivity] = useState(false);
  const [internalNotes, setInternalNotes] = useState<string[]>([]);
  const [newNote, setNewNote] = useState('');
  const [addingNote, setAddingNote] = useState(false);
  const [escalating, setEscalating] = useState(false);
  const [comments, setComments] = useState<{ id: string; content: string; actorName: string | null; createdAt: string }[]>([]);
  const [loadingComments, setLoadingComments] = useState(false);
  const [newComment, setNewComment] = useState('');
  const [submittingComment, setSubmittingComment] = useState(false);

  useEffect(() => {
    if (open && initialComplaint) {
      setComplaint(initialComplaint);
      setResolutionText(initialComplaint.resolution || '');
      setNewStatus('');
      setSelectedAssignee(initialComplaint.assignedToId || '');
      setNewNote('');
      // Load internal notes from localStorage
      const notesKey = `wb_notes_${initialComplaint.id}`;
      const saved = safeGetLocalStorage(notesKey);
      setInternalNotes(saved ? JSON.parse(saved) : []);
    }
  }, [open, initialComplaint]);

  // Fetch assignable users, activity log and comments when dialog opens
  useEffect(() => {
    if (!open || !complaint) return;
    fetch('/api/users/list', { headers: authHeaders() })
      .then((res) => res.ok ? res.json() : null)
      .then((json) => { if (json) setAssignableUsers(json.users || []); })
      .catch(() => {});
    setLoadingActivity(true);
    fetch(`/api/complaints/${complaint.id}/activity`, { headers: authHeaders() })
      .then((res) => res.ok ? res.json() : null)
      .then((json) => { if (json) setActivities(json.activities || []); })
      .catch(() => {})
      .finally(() => setLoadingActivity(false));
    // Fetch comments
    setLoadingComments(true);
    fetch(`/api/complaints/${complaint.id}/comments`, { headers: authHeaders() })
      .then((res) => res.ok ? res.json() : null)
      .then((json) => { if (json) setComments(json.comments || []); })
      .catch(() => {})
      .finally(() => setLoadingComments(false));
  }, [open, complaint?.id]);

  const refreshActivity = useCallback(async (cid: string) => {
    try {
      const actRes = await fetch(`/api/complaints/${cid}/activity`, { headers: authHeaders() });
      if (actRes.ok) { const actJson = await actRes.json(); setActivities(actJson.activities || []); }
    } catch { /* silent */ }
  }, []);

  const handleStatusChange = useCallback(async (status: string) => {
    if (!complaint) return;
    setUpdating(true);
    try {
      const body: Record<string, string> = { status };
      if (status === 'RESOLVED' && resolutionText.trim()) {
        body.resolution = resolutionText.trim();
      }
      const res = await fetch(`/api/complaints/${complaint.id}`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json', ...authHeaders() },
        body: JSON.stringify(body),
      });
      if (res.ok) {
        const json = await res.json();
        setComplaint(json.complaint);
        setNewStatus('');
        toast.success('Status updated', { description: `Complaint marked as ${fmtStatus(status)}` });
        onUpdate?.(complaint.id, status, body.resolution);
        refreshActivity(complaint.id);
      } else {
        toast.error('Failed to update status');
      }
    } catch {
      toast.error('Network error');
    }
    setUpdating(false);
  }, [complaint, resolutionText, onUpdate, refreshActivity]);

  const handleSaveResolution = useCallback(async () => {
    if (!complaint) return;
    setUpdating(true);
    try {
      const res = await fetch(`/api/complaints/${complaint.id}`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json', ...authHeaders() },
        body: JSON.stringify({ resolution: resolutionText.trim() }),
      });
      if (res.ok) {
        const json = await res.json();
        setComplaint(json.complaint);
        toast.success('Resolution saved');
      } else {
        toast.error('Failed to save resolution');
      }
    } catch {
      toast.error('Network error');
    }
    setUpdating(false);
  }, [complaint, resolutionText]);

  const handleQuickAction = useCallback((status: string) => {
    handleStatusChange(status);
  }, [handleStatusChange]);

  const handleAssign = useCallback(async () => {
    if (!complaint) return;
    setAssigning(true);
    try {
      const res = await fetch(`/api/complaints/${complaint.id}`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json', ...authHeaders() },
        body: JSON.stringify({ assignedToId: selectedAssignee || null }),
      });
      if (res.ok) {
        const json = await res.json();
        setComplaint(json.complaint);
        const assignUser = assignableUsers.find((u) => u.id === selectedAssignee);
        toast.success(selectedAssignee ? `Assigned to ${assignUser?.name || 'user'}` : 'Assignment removed');
        onUpdate?.(complaint.id, complaint.status);
        refreshActivity(complaint.id);
      } else {
        toast.error('Failed to update assignment');
      }
    } catch {
      toast.error('Network error');
    }
    setAssigning(false);
  }, [complaint, selectedAssignee, assignableUsers, onUpdate, refreshActivity]);

  const handleAddNote = useCallback(() => {
    if (!complaint || !newNote.trim()) return;
    const note = `${new Date().toLocaleString('en-IN', { day: '2-digit', month: 'short', hour: '2-digit', minute: '2-digit' })} — ${newNote.trim()}`;
    const updated = [note, ...internalNotes];
    setInternalNotes(updated);
    safeSetLocalStorage(`wb_notes_${complaint.id}`, JSON.stringify(updated));
    setNewNote('');
    toast.success('Note added');
  }, [complaint, newNote, internalNotes]);

  const handleAddComment = useCallback(async () => {
    if (!complaint || !newComment.trim()) return;
    setSubmittingComment(true);
    try {
      const res = await fetch(`/api/complaints/${complaint.id}/comments`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', ...authHeaders() },
        body: JSON.stringify({ content: newComment.trim() }),
      });
      if (res.ok) {
        const json = await res.json();
        setComments((prev) => [...prev, json.comment]);
        setNewComment('');
        refreshActivity(complaint.id);
        toast.success('Comment added');
      } else {
        const err = await res.json();
        toast.error(err.error || 'Failed to add comment');
      }
    } catch {
      toast.error('Network error');
    }
    setSubmittingComment(false);
  }, [complaint, newComment, refreshActivity]);

  const handleEscalate = useCallback(async () => {
    if (!complaint) return;
    setEscalating(true);
    try {
      const res = await fetch(`/api/complaints/${complaint.id}/escalate`, {
        method: 'PATCH',
        headers: authHeaders(),
      });
      if (res.ok) {
        const json = await res.json();
        setComplaint(json.complaint);
        toast.success(`Escalated to ${json.newUrgency}`, { description: `Previous: ${json.previousUrgency}` });
        onUpdate?.(complaint.id, complaint.status);
        refreshActivity(complaint.id);
      } else {
        const err = await res.json();
        toast.error(err.error || 'Failed to escalate');
      }
    } catch {
      toast.error('Network error');
    }
    setEscalating(false);
  }, [complaint, onUpdate, refreshActivity]);

  if (!complaint) return null;

  const activityConfig: Record<string, { color: string; icon: React.ElementType }> = {
    CREATED: { color: '#0284C7', icon: Plus },
    STATUS_CHANGED: { color: '#D97706', icon: ArrowUpDown },
    ASSIGNED: { color: '#7C3AED', icon: UserCheck },
    UNASSIGNED: { color: '#9CA3AF', icon: Users },
    RESOLVED: { color: '#16A34A', icon: CheckCircle2 },
    REJECTED: { color: '#DC2626', icon: XCircle },
    ESCALATED: { color: '#EA580C', icon: ArrowUp },
  };

  const slaInfo = getSLAInfo(complaint.createdAt, complaint.status);
  const canEscalate = (complaint.status === 'OPEN' || complaint.status === 'IN_PROGRESS') && complaint.urgency !== 'CRITICAL';

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-lg max-h-[90vh] overflow-y-auto border-0 shadow-2xl">
        <motion.div initial={{ scale: 0.95, opacity: 0 }} animate={{ scale: 1, opacity: 1 }} transition={{ duration: 0.15 }}>
        {/* Glassmorphism Header */}
        <div className="relative -mx-6 -mt-6 mb-4 px-6 py-5 overflow-hidden" style={{ background: 'linear-gradient(135deg, rgba(10,36,99,0.08) 0%, rgba(26,58,122,0.04) 100%)', backdropFilter: 'blur(12px)' }}>
          <div className="absolute top-0 right-0 w-32 h-32 rounded-full opacity-10" style={{ background: 'radial-gradient(circle, #0A2463, transparent)', transform: 'translate(30%, -30%)' }} />
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2 text-base font-bold">
            <Hash className="h-4 w-4" style={{ color: NAVY }} />
            Complaint {complaint.ticketNo}
          </DialogTitle>
          <DialogDescription>Complete details of this citizen grievance</DialogDescription>
        </DialogHeader>
        </div>

        <div className="space-y-4 mt-1">
          {/* Priority & Status Bar */}
          <div className="flex items-center gap-2 flex-wrap">
            <StatusBadge status={complaint.status} />
            <UrgencyBadge urgency={complaint.urgency} />
            <Badge variant="outline" className="text-[11px]">{complaint.source}</Badge>
            {/* SLA Age Badge */}
            <span className={`inline-flex items-center gap-1 px-2 py-0.5 rounded-full text-[10px] font-bold ${slaInfo.bg} ${slaInfo.text}`}>
              {slaInfo.level === 'breached' && <Flame className="h-3 w-3" />}
              {slaInfo.days === 0 ? 'Today' : `${slaInfo.days}d old`}
              {slaInfo.level === 'breached' && ' · SLA BREACH'}
              {slaInfo.level === 'warning' && ' · Warning'}
            </span>
            {complaint.assignedToId ? (
              <Badge variant="outline" className="text-[11px] gap-1 bg-purple-50 dark:bg-purple-950/30 text-purple-700 dark:text-purple-300 border-purple-200 dark:border-purple-800">
                <UserCheck className="h-3 w-3" />Assigned
              </Badge>
            ) : (
              <Badge variant="outline" className="text-[11px] gap-1 bg-gray-50 dark:bg-gray-900/30 text-gray-600 dark:text-gray-400 border-gray-200 dark:border-gray-700">
                <Users className="h-3 w-3" />Unassigned
              </Badge>
            )}
            {complaint.urgency === 'CRITICAL' && (
              <Badge className="bg-red-600 text-white text-[10px] gap-1 animate-pulse">
                <AlertTriangle className="h-3 w-3" />Urgent
              </Badge>
            )}
          </div>

          {/* Quick Action Buttons */}
          {complaint.status !== 'RESOLVED' && complaint.status !== 'REJECTED' && (
            <div className="grid grid-cols-4 gap-2">
              <Button size="sm" variant="outline" disabled={updating || complaint.status === 'IN_PROGRESS'}
                onClick={() => handleQuickAction('IN_PROGRESS')}
                className="text-xs gap-1 h-9 border-amber-300 text-amber-700 hover:bg-amber-50 dark:border-amber-700 dark:text-amber-400 dark:hover:bg-amber-950/30">
                <PlayCircle className="h-3.5 w-3.5" /><span className="hidden sm:inline">In Progress</span>
              </Button>
              <Button size="sm" variant="outline" disabled={updating}
                onClick={() => handleQuickAction('RESOLVED')}
                className="text-xs gap-1 h-9 border-emerald-300 text-emerald-700 hover:bg-emerald-50 dark:border-emerald-700 dark:text-emerald-400 dark:hover:bg-emerald-950/30">
                <CircleCheckBig className="h-3.5 w-3.5" /><span className="hidden sm:inline">Resolve</span>
              </Button>
              <Button size="sm" variant="outline" disabled={updating}
                onClick={() => handleQuickAction('REJECTED')}
                className="text-xs gap-1 h-9 border-gray-300 text-gray-700 hover:bg-gray-50 dark:border-gray-600 dark:text-gray-400 dark:hover:bg-gray-900/30">
                <Ban className="h-3 w-3" /><span className="hidden sm:inline">Reject</span>
              </Button>
              <Button size="sm" variant="outline" disabled={escalating || !canEscalate}
                onClick={handleEscalate}
                className="text-xs gap-1 h-9 border-orange-300 text-orange-700 hover:bg-orange-50 dark:border-orange-700 dark:text-orange-400 dark:hover:bg-orange-950/30" title={canEscalate ? 'Escalate urgency level' : 'Already at maximum'}>
                {escalating ? <RefreshCw className="h-3.5 w-3.5 animate-spin" /> : <ArrowUp className="h-3.5 w-3.5" />}
                <span className="hidden sm:inline">{escalating ? '...' : 'Escalate'}</span>
              </Button>
            </div>
          )}

          {/* Assign To */}
          <div className="space-y-2">
            <p className="text-[10px] font-bold uppercase tracking-widest text-muted-foreground flex items-center gap-1.5">
              <UserCheck className="h-3.5 w-3.5" />Assign To
            </p>
            <div className="flex items-center gap-2">
              <Select value={selectedAssignee} onValueChange={setSelectedAssignee} disabled={assigning}>
                <SelectTrigger className="h-9 text-sm flex-1">
                  <SelectValue placeholder="Select officer..." />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="__unassign__">— Unassign —</SelectItem>
                  {assignableUsers.map((u) => (
                    <SelectItem key={u.id} value={u.id}>
                      {u.name} <span className="text-[10px] text-muted-foreground">({fmtRole(u.role)})</span>
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
              <Button size="sm" variant="outline"
                disabled={assigning || (selectedAssignee === complaint.assignedToId && selectedAssignee !== '__unassign__')}
                onClick={handleAssign}
                className="text-xs gap-1 h-9 border-purple-300 text-purple-700 hover:bg-purple-50 dark:border-purple-700 dark:text-purple-400 dark:hover:bg-purple-950/30 whitespace-nowrap">
                {assigning ? <RefreshCw className="h-3 w-3 animate-spin" /> : <Send className="h-3 w-3" />}
                {complaint.assignedToId ? 'Update' : 'Assign'}
              </Button>
            </div>
          </div>

          {/* Activity Timeline */}
          <div>
            <p className="text-[10px] font-bold uppercase tracking-widest text-muted-foreground mb-3 flex items-center gap-1.5">
              <History className="h-3.5 w-3.5" />Activity Timeline
            </p>
            <div className="relative pl-6">
              <div className="absolute left-[9px] top-2 bottom-2 w-0.5 bg-border" />
              {loadingActivity ? (
                <div className="space-y-3">
                  {[0, 1, 2].map((i) => (
                    <div key={i} className="flex gap-3 items-start">
                      <Skeleton className="h-4 w-4 rounded-full shrink-0" />
                      <div className="space-y-1"><Skeleton className="h-3 w-32" /><Skeleton className="h-2 w-20" /></div>
                    </div>
                  ))}
                </div>
              ) : activities.length > 0 ? (
                activities.map((entry, idx) => {
                  const config = activityConfig[entry.action] || { color: '#6B7280', icon: CircleDot };
                  const ActionIcon = config.icon;
                  return (
                    <div key={entry.id || idx} className="relative flex items-start gap-3 pb-4 last:pb-0">
                      <div className="absolute -left-6 top-0.5">
                        <div className="h-[18px] w-[18px] rounded-full border-2 border-white dark:border-gray-800 flex items-center justify-center" style={{ backgroundColor: config.color }}>
                          <ActionIcon className="h-2.5 w-2.5 text-white" strokeWidth={3} />
                        </div>
                      </div>
                      <div className="flex-1 min-w-0">
                        <p className="text-xs font-semibold text-foreground">{entry.description}</p>
                        <div className="flex items-center gap-2 mt-0.5 flex-wrap">
                          <p className="text-[11px] text-muted-foreground flex items-center gap-1">
                            <Clock className="h-3 w-3" />{fmtDateTime(entry.createdAt)}
                          </p>
                          {entry.actorName && (
                            <span className="text-[10px] text-muted-foreground bg-muted px-1.5 py-0.5 rounded">{entry.actorName}</span>
                          )}
                        </div>
                      </div>
                    </div>
                  );
                })
              ) : (
                <p className="text-xs text-muted-foreground italic pl-2">No activity recorded</p>
              )}
            </div>
          </div>

          {/* Citizen Contact Info Card */}
          <div className="p-3.5 rounded-xl bg-muted/50 border border-border/50">
            <p className="text-[10px] font-bold uppercase tracking-widest text-muted-foreground mb-2.5">Citizen Information</p>
            <div className="flex items-center gap-3">
              <div className="h-10 w-10 rounded-full flex items-center justify-center text-white text-sm font-bold shrink-0" style={{ backgroundColor: NAVY }}>
                {(complaint.citizenName || 'A').charAt(0).toUpperCase()}
              </div>
              <div className="flex-1 min-w-0">
                <p className="text-sm font-semibold text-foreground">{complaint.citizenName || 'Anonymous'}</p>
                {complaint.phone && (
                  <a href={`tel:${complaint.phone}`} className="text-[11px] text-muted-foreground hover:text-foreground flex items-center gap-1 mt-0.5 transition-colors">
                    <Phone className="h-3 w-3" />{complaint.phone}
                  </a>
                )}
              </div>
              {complaint.phone && (
                <a href={`tel:${complaint.phone}`} className="h-8 w-8 rounded-lg bg-emerald-50 dark:bg-emerald-950/30 flex items-center justify-center text-emerald-600 dark:text-emerald-400 hover:bg-emerald-100 dark:hover:bg-emerald-950/50 transition-colors shrink-0">
                  <Phone className="h-4 w-4" />
                </a>
              )}
            </div>
          </div>

          {/* Info Grid */}
          <div className="grid grid-cols-2 gap-2.5">
            {[
              { label: 'Category', val: complaint.category },
              { label: 'Block', val: complaint.block },
              { label: 'District', val: complaint.district },
              { label: 'Filed On', val: fmtDateTime(complaint.createdAt) },
              { label: 'Updated', val: fmtDateTime(complaint.updatedAt) },
              { label: 'Priority', val: fmtUrgency(complaint.urgency) },
            ].map((f) => (
              <div key={f.label} className="p-3 rounded-xl bg-muted/50 border border-border/50">
                <p className="text-[10px] font-bold uppercase tracking-widest text-muted-foreground mb-1">{f.label}</p>
                <p className="text-sm font-medium text-foreground">{f.val}</p>
              </div>
            ))}
          </div>

          {/* Issue */}
          <div>
            <p className="text-[10px] font-bold uppercase tracking-widest text-muted-foreground mb-1.5">Issue</p>
            <p className="text-sm leading-relaxed p-3 rounded-xl bg-muted/50 border border-border/50 text-foreground">{complaint.issue}</p>
          </div>

          {/* Description */}
          {complaint.description && (
            <div>
              <p className="text-[10px] font-bold uppercase tracking-widest text-muted-foreground mb-1.5">Description</p>
              <p className="text-sm leading-relaxed p-3 rounded-xl bg-muted/50 border border-border/50 text-muted-foreground">{complaint.description}</p>
            </div>
          )}

          {/* Resolution */}
          <div>
            <p className="text-[10px] font-bold uppercase tracking-widest text-muted-foreground mb-1.5">Resolution</p>
            {complaint.resolution ? (
              <p className="text-sm leading-relaxed p-3 rounded-xl bg-emerald-50 dark:bg-emerald-950/30 border border-emerald-200 dark:border-emerald-800 text-emerald-700 dark:text-emerald-300">
                {complaint.resolution}
              </p>
            ) : (
              <p className="text-sm p-3 rounded-xl bg-muted/30 border border-border/30 text-muted-foreground italic">No resolution recorded yet</p>
            )}
          </div>

          <Separator />

          {/* Status Update */}
          <div className="space-y-2">
            <p className="text-[10px] font-bold uppercase tracking-widest text-muted-foreground">Update Status</p>
            <Select value={newStatus} onValueChange={setNewStatus} disabled={updating}>
              <SelectTrigger className="w-full">
                {updating ? (
                  <span className="flex items-center gap-2 text-xs">
                    <RefreshCw className="h-3 w-3 animate-spin" />Updating...
                  </span>
                ) : (
                  <SelectValue placeholder="Select new status..." />
                )}
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="OPEN">Open</SelectItem>
                <SelectItem value="IN_PROGRESS">In Progress</SelectItem>
                <SelectItem value="RESOLVED">Resolved</SelectItem>
                <SelectItem value="REJECTED">Rejected</SelectItem>
              </SelectContent>
            </Select>
            {newStatus && (
              <Button size="sm" disabled={updating} onClick={() => handleStatusChange(newStatus)}
                className="w-full text-xs" style={{ backgroundColor: NAVY, color: 'white' }}>
                {updating ? <RefreshCw className="h-3 w-3 animate-spin mr-1" /> : <CheckCircle2 className="h-3 w-3 mr-1" />}
                Apply: {fmtStatus(newStatus)}
              </Button>
            )}
          </div>

          {/* Resolution Notes */}
          <div className="space-y-2">
            <Label className="text-[10px] font-bold uppercase tracking-widest">Resolution Notes</Label>
            <Textarea value={resolutionText} onChange={(e) => setResolutionText(e.target.value)}
              placeholder="Enter resolution details..." rows={3} className="text-sm" />
            <Button variant="outline" size="sm" disabled={updating} onClick={handleSaveResolution} className="text-xs w-full">
              <Send className="h-3 w-3 mr-1" />Save Resolution
            </Button>
          </div>

          {/* Official Comments */}
          <div className="space-y-2">
            <p className="text-[10px] font-bold uppercase tracking-widest text-muted-foreground flex items-center gap-1.5">
              <MessageSquare className="h-3.5 w-3.5" />Official Comments
              <span className="text-muted-foreground/60">({comments.length})</span>
            </p>
            {loadingComments && <Skeleton className="h-12 w-full" />}
            {comments.length > 0 && (
              <div className="space-y-1.5 max-h-[150px] overflow-y-auto custom-scrollbar">
                {comments.map((c) => (
                  <div key={c.id} className="p-2.5 rounded-lg bg-sky-50 dark:bg-sky-950/20 border border-sky-200/50 dark:border-sky-800/30 text-xs">
                    <div className="flex items-center justify-between mb-1">
                      <span className="font-semibold text-foreground">{c.actorName || 'System'}</span>
                      <span className="text-[10px] text-muted-foreground">{fmtDateTime(c.createdAt)}</span>
                    </div>
                    <p className="text-foreground/80 leading-relaxed whitespace-pre-wrap">{c.content}</p>
                  </div>
                ))}
              </div>
            )}
            <div className="flex items-center gap-2">
              <Input
                value={newComment}
                onChange={(e) => setNewComment(e.target.value)}
                placeholder="Add a comment..."
                className="text-sm h-8 flex-1"
                onKeyDown={(e) => { if (e.key === 'Enter' && !e.shiftKey && newComment.trim()) { e.preventDefault(); handleAddComment(); } }}
              />
              <Button size="sm" variant="outline" onClick={handleAddComment} disabled={!newComment.trim() || submittingComment} className="text-xs h-8 px-3 shrink-0">
                {submittingComment ? <RefreshCw className="h-3 w-3 animate-spin" /> : <Send className="h-3 w-3" />}
              </Button>
            </div>
          </div>

          {/* Internal Notes (localStorage) */}
          <div className="space-y-2">
            <p className="text-[10px] font-bold uppercase tracking-widest text-muted-foreground/70 flex items-center gap-1.5">
              <MessageSquare className="h-3.5 w-3" />Private Notes
              <span className="text-muted-foreground/40">({internalNotes.length})</span>
            </p>
            {internalNotes.length > 0 && (
              <div className="space-y-1.5 max-h-[120px] overflow-y-auto custom-scrollbar">
                {internalNotes.map((note, idx) => (
                  <div key={idx} className="p-2.5 rounded-lg bg-amber-50 dark:bg-amber-950/20 border border-amber-200/50 dark:border-amber-800/30 text-xs">
                    <p className="text-foreground leading-relaxed">{note}</p>
                  </div>
                ))}
              </div>
            )}
            <div className="flex items-center gap-2">
              <Input
                value={newNote}
                onChange={(e) => setNewNote(e.target.value)}
                placeholder="Add an internal note..."
                className="text-sm h-8 flex-1"
                onKeyDown={(e) => { if (e.key === 'Enter' && !e.shiftKey) { e.preventDefault(); handleAddNote(); } }}
              />
              <Button size="sm" variant="outline" onClick={handleAddNote} disabled={!newNote.trim()} className="text-xs h-8 px-3 shrink-0">
                <Send className="h-3 w-3" />
              </Button>
            </div>
          </div>
        </div>
        </motion.div>
      </DialogContent>
    </Dialog>
  );
}