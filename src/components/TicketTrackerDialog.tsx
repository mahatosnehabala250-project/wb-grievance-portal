'use client';

import { useState, useCallback } from 'react';
import { Search, Ticket, MapPin, CalendarDays, Clock, CheckCircle2, XCircle, AlertTriangle, ArrowRight, X } from 'lucide-react';
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogDescription } from '@/components/ui/dialog';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Separator } from '@/components/ui/separator';
import { motion, AnimatePresence } from 'framer-motion';
import { NAVY } from '@/lib/constants';
import { authHeaders, getDaysOld, getSLAInfo } from '@/lib/helpers';
import { StatusBadge, UrgencyBadge } from '@/components/common';
import type { Complaint } from '@/lib/types';

interface TicketResult {
  ticketNo: string;
  citizenName: string | null;
  category: string;
  block: string;
  district: string;
  urgency: string;
  status: string;
  description: string | null;
  createdAt: string;
  updatedAt: string;
  daysOld: number;
  lastUpdated: { action: string; description: string; at: string } | null;
}

interface TicketTrackerDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
}

const STATUS_STAGES = ['OPEN', 'IN_PROGRESS', 'RESOLVED'];
const STATUS_LABELS: Record<string, string> = {
  OPEN: 'Received',
  IN_PROGRESS: 'In Progress',
  RESOLVED: 'Resolved',
  REJECTED: 'Rejected',
};

const STATUS_ICONS: Record<string, typeof CheckCircle2> = {
  OPEN: AlertTriangle,
  IN_PROGRESS: Clock,
  RESOLVED: CheckCircle2,
  REJECTED: XCircle,
};

export function TicketTrackerDialog({ open, onOpenChange }: TicketTrackerDialogProps) {
  const [ticketInput, setTicketInput] = useState('');
  const [searching, setSearching] = useState(false);
  const [result, setResult] = useState<TicketResult | null>(null);
  const [error, setError] = useState('');

  const handleSearch = useCallback(async () => {
    if (!ticketInput.trim()) return;
    setSearching(true);
    setError('');
    setResult(null);

    try {
      const res = await fetch(`/api/ticket/${ticketInput.trim().toUpperCase()}`, { headers: authHeaders() });
      if (res.ok) {
        const json = await res.json();
        setResult(json.ticket);
      } else if (res.status === 404) {
        setError(`Ticket "${ticketInput.trim().toUpperCase()}" not found. Please check the ticket number and try again.`);
      } else {
        setError('Failed to search ticket. Please try again.');
      }
    } catch {
      setError('Network error. Please try again.');
    }
    setSearching(false);
  }, [ticketInput]);

  const handleKeyDown = useCallback((e: React.KeyboardEvent) => {
    if (e.key === 'Enter') handleSearch();
  }, [handleSearch]);

  const handleOpenChange = useCallback((v: boolean) => {
    if (!v) {
      setTicketInput('');
      setResult(null);
      setError('');
    }
    onOpenChange(v);
  }, [onOpenChange]);

  const currentStageIndex = result ? STATUS_STAGES.indexOf(result.status) : -1;
  const isRejected = result?.status === 'REJECTED';

  return (
    <Dialog open={open} onOpenChange={handleOpenChange}>
      <DialogContent className="sm:max-w-[520px] p-0 overflow-hidden">
        {/* Header */}
        <div className="p-5 pb-0">
          <DialogHeader>
            <div className="flex items-center gap-3">
              <div className="h-10 w-10 rounded-xl flex items-center justify-center" style={{ backgroundColor: NAVY }}>
                <Search className="h-5 w-5 text-white" />
              </div>
              <div>
                <DialogTitle className="text-base font-bold">Track Your Complaint</DialogTitle>
                <DialogDescription className="text-xs">Enter your ticket number to check the current status</DialogDescription>
              </div>
            </div>
          </DialogHeader>
        </div>

        {/* Search Input */}
        <div className="px-5 pt-4">
          <div className="flex gap-2">
            <div className="relative flex-1">
              <Ticket className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-muted-foreground" />
              <Input
                placeholder="e.g. WB-01001"
                value={ticketInput}
                onChange={(e) => setTicketInput(e.target.value)}
                onKeyDown={handleKeyDown}
                className="pl-10 h-10 font-mono"
                disabled={searching}
              />
            </div>
            <Button onClick={handleSearch} disabled={searching || !ticketInput.trim()} className="h-10 px-4 gap-1.5" style={{ backgroundColor: NAVY }}>
              <Search className="h-4 w-4" />
              Track
            </Button>
          </div>
        </div>

        <Separator className="mt-4" />

        {/* Results */}
        <div className="px-5 py-4 min-h-[200px]">
          {searching ? (
            <div className="flex items-center justify-center py-12">
              <motion.div
                animate={{ rotate: 360 }}
                transition={{ duration: 1, repeat: Infinity, ease: 'linear' }}
              >
                <Search className="h-6 w-6 text-muted-foreground" />
              </motion.div>
              <span className="ml-3 text-sm text-muted-foreground">Searching...</span>
            </div>
          ) : error ? (
            <motion.div
              initial={{ opacity: 0, y: 10 }}
              animate={{ opacity: 1, y: 0 }}
              className="flex flex-col items-center justify-center py-8 text-center"
            >
              <div className="h-14 w-14 rounded-full bg-red-50 dark:bg-red-950/20 flex items-center justify-center mb-3">
                <XCircle className="h-7 w-7 text-red-400" />
              </div>
              <p className="text-sm font-medium text-foreground">{error}</p>
              <Button variant="link" className="text-xs mt-2" onClick={() => { setTicketInput(''); setError(''); }}>
                Try a different ticket number
              </Button>
            </motion.div>
          ) : result ? (
            <AnimatePresence mode="wait">
              <motion.div
                key={result.ticketNo}
                initial={{ opacity: 0, y: 10 }}
                animate={{ opacity: 1, y: 0 }}
                exit={{ opacity: 0 }}
                className="space-y-4"
              >
                {/* Ticket Header */}
                <div className="flex items-start justify-between">
                  <div>
                    <div className="flex items-center gap-2">
                      <span className="text-lg font-black font-mono" style={{ color: NAVY }}>{result.ticketNo}</span>
                      <StatusBadge status={result.status} />
                      <UrgencyBadge urgency={result.urgency} />
                    </div>
                    <p className="text-sm text-muted-foreground mt-1">{result.category} &middot; {result.block}, {result.district}</p>
                  </div>
                </div>

                {/* Citizen Info */}
                {result.citizenName && (
                  <div className="flex items-center gap-2 text-sm">
                    <span className="font-medium">{result.citizenName}</span>
                    <span className="text-muted-foreground">&middot;</span>
                    <span className="text-muted-foreground">Filed {result.daysOld} day{result.daysOld !== 1 ? 's' : ''} ago</span>
                  </div>
                )}

                {/* Progress Stepper */}
                <div className="mt-2 p-4 rounded-xl bg-muted/30 border border-border/50">
                  <p className="text-[10px] font-bold uppercase tracking-widest text-muted-foreground mb-3">Progress</p>
                  {isRejected ? (
                    <div className="flex items-center gap-2 p-2 rounded-lg bg-red-50 dark:bg-red-950/20">
                      <XCircle className="h-5 w-5 text-red-500" />
                      <div>
                        <p className="text-sm font-semibold text-red-700 dark:text-red-400">Complaint Rejected</p>
                        {result.lastUpdated && (
                          <p className="text-[11px] text-muted-foreground mt-0.5">{result.lastUpdated.description}</p>
                        )}
                      </div>
                    </div>
                  ) : (
                    <div className="flex items-center gap-0">
                      {STATUS_STAGES.map((stage, idx) => {
                        const isCompleted = idx <= currentStageIndex;
                        const isCurrent = idx === currentStageIndex;
                        const StatusIcon = STATUS_ICONS[stage];
                        return (
                          <div key={stage} className="flex-1 flex items-center">
                            <div className="flex flex-col items-center flex-1">
                              <motion.div
                                initial={{ scale: 0.8 }}
                                animate={{ scale: 1 }}
                                transition={{ delay: idx * 0.15 }}
                                className={`h-9 w-9 rounded-full flex items-center justify-center border-2 transition-all ${
                                  isCompleted
                                    ? 'border-emerald-500 bg-emerald-50 dark:bg-emerald-950/30'
                                    : 'border-muted-foreground/20 bg-muted/50'
                                } ${isCurrent ? 'ring-2 ring-emerald-500/30 ring-offset-2' : ''}`}
                              >
                                <StatusIcon className={`h-4 w-4 ${isCompleted ? 'text-emerald-600' : 'text-muted-foreground/40'}`} />
                              </motion.div>
                              <span className={`text-[10px] font-semibold mt-1.5 ${isCompleted ? 'text-foreground' : 'text-muted-foreground/50'}`}>
                                {STATUS_LABELS[stage]}
                              </span>
                            </div>
                            {idx < STATUS_STAGES.length - 1 && (
                              <div className="flex-1 mx-1">
                                <div className={`h-0.5 rounded-full mt-[-20px] ${idx < currentStageIndex ? 'bg-emerald-500' : 'bg-muted-foreground/15'}`} />
                              </div>
                            )}
                          </div>
                        );
                      })}
                    </div>
                  )}
                </div>

                {/* Details Grid */}
                <div className="grid grid-cols-2 gap-3">
                  <div className="p-3 rounded-lg bg-muted/20 border border-border/30">
                    <p className="text-[10px] font-bold uppercase tracking-widest text-muted-foreground">Category</p>
                    <p className="text-sm font-medium mt-1">{result.category}</p>
                  </div>
                  <div className="p-3 rounded-lg bg-muted/20 border border-border/30">
                    <p className="text-[10px] font-bold uppercase tracking-widest text-muted-foreground">Location</p>
                    <p className="text-sm font-medium mt-1">{result.block}, {result.district}</p>
                  </div>
                  <div className="p-3 rounded-lg bg-muted/20 border border-border/30">
                    <p className="text-[10px] font-bold uppercase tracking-widest text-muted-foreground">Filed On</p>
                    <p className="text-sm font-medium mt-1 flex items-center gap-1">
                      <CalendarDays className="h-3 w-3" />
                      {new Date(result.createdAt).toLocaleDateString('en-IN', { day: 'numeric', month: 'short', year: 'numeric' })}
                    </p>
                  </div>
                  <div className="p-3 rounded-lg bg-muted/20 border border-border/30">
                    <p className="text-[10px] font-bold uppercase tracking-widest text-muted-foreground">Last Update</p>
                    <p className="text-sm font-medium mt-1 flex items-center gap-1">
                      <Clock className="h-3 w-3" />
                      {new Date(result.updatedAt).toLocaleDateString('en-IN', { day: 'numeric', month: 'short', year: 'numeric' })}
                    </p>
                  </div>
                </div>

                {result.description && (
                  <div className="p-3 rounded-lg bg-muted/20 border border-border/30">
                    <p className="text-[10px] font-bold uppercase tracking-widest text-muted-foreground">Description</p>
                    <p className="text-sm mt-1 leading-relaxed">{result.description}</p>
                  </div>
                )}

                {/* SLA Info */}
                <div className={`flex items-center gap-2 p-2.5 rounded-lg ${
                  result.daysOld > 7 ? 'bg-red-50 dark:bg-red-950/20 border border-red-200/50' :
                  result.daysOld > 3 ? 'bg-amber-50 dark:bg-amber-950/20 border border-amber-200/50' :
                  'bg-emerald-50 dark:bg-emerald-950/20 border border-emerald-200/50'
                }`}>
                  <Clock className={`h-4 w-4 ${result.daysOld > 7 ? 'text-red-500' : result.daysOld > 3 ? 'text-amber-500' : 'text-emerald-500'}`} />
                  <span className={`text-xs font-medium ${result.daysOld > 7 ? 'text-red-700 dark:text-red-400' : result.daysOld > 3 ? 'text-amber-700 dark:text-amber-400' : 'text-emerald-700 dark:text-emerald-400'}`}>
                    {result.daysOld > 7 ? `Overdue by ${result.daysOld - 7} days — SLA breached` :
                     result.daysOld > 3 ? `Aging (${result.daysOld} days) — approaching SLA deadline` :
                     `On track (${result.daysOld} day${result.daysOld !== 1 ? 's' : ''} old)`}
                  </span>
                </div>
              </motion.div>
            </AnimatePresence>
          ) : (
            <div className="flex flex-col items-center justify-center py-10 text-center">
              <div className="h-16 w-16 rounded-full bg-muted/50 flex items-center justify-center mb-3">
                <Ticket className="h-8 w-8 text-muted-foreground/30" />
              </div>
              <p className="text-sm font-medium text-muted-foreground">Enter a ticket number above to track</p>
              <p className="text-[11px] text-muted-foreground/60 mt-1">Ticket numbers look like WB-01001</p>
            </div>
          )}
        </div>
      </DialogContent>
    </Dialog>
  );
}
