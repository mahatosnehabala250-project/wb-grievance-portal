'use client';

import { useState, useEffect, useCallback } from 'react';
import { Star, ThumbsUp, Send, CheckCircle2, MessageSquare, RotateCcw } from 'lucide-react';
import {
  Dialog, DialogContent, DialogHeader, DialogTitle, DialogDescription, DialogFooter,
} from '@/components/ui/dialog';
import { Button } from '@/components/ui/button';
import { Textarea } from '@/components/ui/textarea';
import { Label } from '@/components/ui/label';
import { toast } from 'sonner';
import { motion, AnimatePresence } from 'framer-motion';
import type { Complaint } from '@/lib/types';
import { NAVY, NAVY_DARK } from '@/lib/constants';
import { authHeaders, safeGetLocalStorage, safeSetLocalStorage } from '@/lib/helpers';

const SATISFACTION_LABELS = ['Very Dissatisfied', 'Dissatisfied', 'Neutral', 'Satisfied', 'Very Satisfied'];
const SATISFACTION_COLORS = [
  { bg: 'bg-red-100 dark:bg-red-900/30', text: 'text-red-600 dark:text-red-400', star: 'text-red-500' },
  { bg: 'bg-orange-100 dark:bg-orange-900/30', text: 'text-orange-600 dark:text-orange-400', star: 'text-orange-500' },
  { bg: 'bg-amber-100 dark:bg-amber-900/30', text: 'text-amber-600 dark:text-amber-400', star: 'text-amber-500' },
  { bg: 'bg-emerald-100 dark:bg-emerald-900/30', text: 'text-emerald-600 dark:text-emerald-400', star: 'text-emerald-500' },
  { bg: 'bg-sky-100 dark:bg-sky-900/30', text: 'text-sky-600 dark:text-sky-400', star: 'text-sky-500' },
];
const SATISFACTION_EMOJIS = ['😞', '😕', '😐', '😊', '🤩'];

const FEEDBACK_CATEGORIES = [
  { value: 'General', label: 'General Feedback' },
  { value: 'Resolution Quality', label: 'Resolution Quality' },
  { value: 'Response Time', label: 'Response Time' },
  { value: 'Staff Behavior', label: 'Staff Behavior' },
  { value: 'Process', label: 'Process Experience' },
  { value: 'Other', label: 'Other' },
];

interface FeedbackDialogProps {
  complaint: Complaint | null;
  open: boolean;
  onOpenChange: (v: boolean) => void;
}

export function FeedbackDialog({ complaint, open, onOpenChange }: FeedbackDialogProps) {
  const [rating, setRating] = useState(0);
  const [hoveredRating, setHoveredRating] = useState(0);
  const [category, setCategory] = useState('General');
  const [comment, setComment] = useState('');
  const [submitting, setSubmitting] = useState(false);
  const [submitted, setSubmitted] = useState(false);
  const [feedbackId, setFeedbackId] = useState<string | null>(null);

  // Load saved feedback from localStorage
  useEffect(() => {
    if (open && complaint) {
      const saved = safeGetLocalStorage(`wb_feedback_${complaint.id}`);
      if (saved) {
        try {
          const data = JSON.parse(saved);
          setRating(data.rating || 0);
          setCategory(data.category || 'General');
          setComment(data.comment || '');
          if (data.submitted) {
            setSubmitted(true);
            setFeedbackId(data.feedbackId || null);
          }
        } catch { /* ignore */ }
      } else {
        // Reset for new feedback
        setRating(0);
        setHoveredRating(0);
        setCategory('General');
        setComment('');
        setSubmitted(false);
        setFeedbackId(null);
      }
    }
  }, [open, complaint]);

  // Save draft to localStorage
  useEffect(() => {
    if (!open || !complaint) return;
    safeSetLocalStorage(`wb_feedback_${complaint?.id}`, JSON.stringify({
      rating,
      category,
      comment,
      submitted,
      feedbackId,
    }));
  }, [rating, category, comment, submitted, feedbackId, open, complaint]);

  const handleSubmit = useCallback(async () => {
    if (!complaint || rating === 0) {
      toast.error('Please select a rating');
      return;
    }

    setSubmitting(true);
    try {
      const citizenName = complaint.citizenName || 'Anonymous Citizen';
      const message = [
        `Complaint: ${complaint.ticketNo}`,
        `Rating: ${rating}/5 (${SATISFACTION_LABELS[rating - 1]})`,
        `Category: ${category}`,
        comment ? `Comment: ${comment}` : '',
      ].filter(Boolean).join('\n');

      const res = await fetch('/api/feedback', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', ...authHeaders() },
        body: JSON.stringify({
          name: citizenName,
          email: null,
          message,
          category,
          rating,
        }),
      });

      if (res.ok) {
        const json = await res.json();
        setSubmitted(true);
        setFeedbackId(json.feedback?.id || null);
        toast.success('Thank you for your feedback!', {
          description: 'Your rating helps us improve our services.',
        });
      } else {
        const err = await res.json();
        toast.error(err.error || 'Failed to submit feedback');
      }
    } catch {
      toast.error('Network error. Please try again.');
    }
    setSubmitting(false);
  }, [complaint, rating, category, comment]);

  const handleReset = useCallback(() => {
    setRating(0);
    setHoveredRating(0);
    setCategory('General');
    setComment('');
    setSubmitted(false);
    setFeedbackId(null);
    if (complaint) {
      safeSetLocalStorage(`wb_feedback_${complaint.id}`, JSON.stringify({
        rating: 0, category: 'General', comment: '', submitted: false, feedbackId: null,
      }));
    }
  }, [complaint]);

  const activeRating = hoveredRating || rating;
  const satisfactionIdx = activeRating > 0 ? activeRating - 1 : -1;

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-md border-0 shadow-2xl">
        <motion.div
          initial={{ scale: 0.95, opacity: 0 }}
          animate={{ scale: 1, opacity: 1 }}
          transition={{ duration: 0.2 }}
        >
          {/* Header */}
          <div className="relative -mx-6 -mt-6 mb-4 px-6 py-5 overflow-hidden text-center" style={{ background: 'linear-gradient(135deg, rgba(10,36,99,0.06) 0%, rgba(22,163,74,0.06) 100%)' }}>
            <div className="absolute top-0 right-0 w-24 h-24 rounded-full opacity-10" style={{ background: 'radial-gradient(circle, #0A2463, transparent)', transform: 'translate(30%, -30%)' }} />
            <DialogHeader className="relative">
              <div className="mx-auto mb-2 h-12 w-12 rounded-xl flex items-center justify-center" style={{ backgroundColor: NAVY }}>
                <ThumbsUp className="h-6 w-6 text-white" />
              </div>
              <DialogTitle className="text-base font-bold">Rate Resolution</DialogTitle>
              <DialogDescription className="text-xs">
                {complaint
                  ? `How satisfied are you with the resolution for ${complaint.ticketNo}?`
                  : 'Share your feedback about this resolution'}
              </DialogDescription>
            </DialogHeader>
          </div>

          <AnimatePresence mode="wait">
            {submitted ? (
              /* Thank You State */
              <motion.div
                key="thankyou"
                initial={{ opacity: 0, scale: 0.9 }}
                animate={{ opacity: 1, scale: 1 }}
                exit={{ opacity: 0, scale: 0.9 }}
                transition={{ duration: 0.3 }}
                className="py-6 text-center space-y-4"
              >
                <motion.div
                  initial={{ scale: 0 }}
                  animate={{ scale: 1 }}
                  transition={{ delay: 0.2, type: 'spring', stiffness: 200 }}
                  className="mx-auto"
                >
                  <div className="h-16 w-16 rounded-full bg-emerald-100 dark:bg-emerald-900/30 flex items-center justify-center mx-auto mb-3">
                    <CheckCircle2 className="h-8 w-8 text-emerald-600 dark:text-emerald-400" />
                  </div>
                </motion.div>
                <div>
                  <h3 className="text-lg font-bold text-foreground">Thank You!</h3>
                  <p className="text-sm text-muted-foreground mt-1">
                    Your feedback has been recorded. Your rating of {rating}/5 helps us serve you better.
                  </p>
                </div>

                {/* Submitted feedback summary */}
                <div className="p-4 rounded-xl bg-muted/50 border border-border/50 text-left space-y-2">
                  <div className="flex items-center justify-between">
                    <span className="text-[10px] font-bold uppercase tracking-widest text-muted-foreground">Your Rating</span>
                    <div className="flex items-center gap-0.5">
                      {[1, 2, 3, 4, 5].map((s) => (
                        <Star key={s} className={`h-4 w-4 ${s <= rating ? 'text-amber-500 fill-amber-500' : 'text-gray-300'}`} />
                      ))}
                    </div>
                  </div>
                  <div className="flex items-center justify-between">
                    <span className="text-[10px] font-bold uppercase tracking-widest text-muted-foreground">Satisfaction</span>
                    <span className={`text-xs font-semibold ${SATISFACTION_COLORS[rating - 1]?.text}`}>
                      {SATISFACTION_LABELS[rating - 1]}
                    </span>
                  </div>
                  <div className="flex items-center justify-between">
                    <span className="text-[10px] font-bold uppercase tracking-widest text-muted-foreground">Category</span>
                    <span className="text-xs font-medium">{category}</span>
                  </div>
                  {comment && (
                    <div>
                      <span className="text-[10px] font-bold uppercase tracking-widest text-muted-foreground">Comment</span>
                      <p className="text-xs text-muted-foreground mt-1 leading-relaxed">{comment}</p>
                    </div>
                  )}
                </div>

                <div className="flex items-center gap-2 justify-center">
                  <Button variant="outline" size="sm" onClick={handleReset} className="text-xs gap-1.5">
                    <RotateCcw className="h-3 w-3" />
                    Submit Again
                  </Button>
                  <Button size="sm" onClick={() => onOpenChange(false)} className="text-xs" style={{ backgroundColor: NAVY, color: 'white' }}>
                    Done
                  </Button>
                </div>
              </motion.div>
            ) : (
              /* Feedback Form */
              <motion.div
                key="form"
                initial={{ opacity: 0 }}
                animate={{ opacity: 1 }}
                exit={{ opacity: 0 }}
                className="space-y-5"
              >
                {/* Star Rating */}
                <div className="text-center space-y-3">
                  <Label className="text-[10px] font-bold uppercase tracking-widest text-muted-foreground">
                    How would you rate the resolution?
                  </Label>
                  <div className="flex items-center justify-center gap-1">
                    {[1, 2, 3, 4, 5].map((s) => (
                      <motion.button
                        key={s}
                        type="button"
                        whileHover={{ scale: 1.2 }}
                        whileTap={{ scale: 0.9 }}
                        onClick={() => setRating(s)}
                        onMouseEnter={() => setHoveredRating(s)}
                        onMouseLeave={() => setHoveredRating(0)}
                        className="focus:outline-none p-0.5"
                      >
                        <Star
                          className={`h-9 w-9 transition-colors duration-150 ${
                            s <= activeRating
                              ? 'fill-amber-400 text-amber-400 drop-shadow-sm'
                              : 'text-gray-300 dark:text-gray-600'
                          }`}
                        />
                      </motion.button>
                    ))}
                  </div>
                  {/* Satisfaction Label */}
                  <AnimatePresence mode="wait">
                    {satisfactionIdx >= 0 && (
                      <motion.div
                        key={satisfactionIdx}
                        initial={{ opacity: 0, y: -5 }}
                        animate={{ opacity: 1, y: 0 }}
                        exit={{ opacity: 0, y: 5 }}
                        transition={{ duration: 0.15 }}
                      >
                        <span className={`inline-flex items-center gap-1.5 px-3 py-1 rounded-full text-xs font-semibold ${SATISFACTION_COLORS[satisfactionIdx].bg} ${SATISFACTION_COLORS[satisfactionIdx].text}`}>
                          <span className="text-sm">{SATISFACTION_EMOJIS[satisfactionIdx]}</span>
                          {SATISFACTION_LABELS[satisfactionIdx]}
                        </span>
                      </motion.div>
                    )}
                  </AnimatePresence>
                </div>

                {/* Category */}
                <div className="space-y-2">
                  <Label className="text-[10px] font-bold uppercase tracking-widest text-muted-foreground">
                    What aspect are you rating?
                  </Label>
                  <div className="grid grid-cols-2 gap-2">
                    {FEEDBACK_CATEGORIES.map((cat) => (
                      <button
                        key={cat.value}
                        type="button"
                        onClick={() => setCategory(cat.value)}
                        className={`p-2.5 rounded-lg border text-xs font-medium transition-all text-left ${
                          category === cat.value
                            ? 'border-sky-400 bg-sky-50 dark:bg-sky-950/30 text-sky-700 dark:text-sky-300 shadow-sm'
                            : 'border-border/50 bg-muted/30 text-muted-foreground hover:bg-muted/50 hover:border-border'
                        }`}
                      >
                        {cat.label}
                      </button>
                    ))}
                  </div>
                </div>

                {/* Comment */}
                <div className="space-y-2">
                  <Label className="text-[10px] font-bold uppercase tracking-widest text-muted-foreground flex items-center gap-1.5">
                    <MessageSquare className="h-3 w-3" />
                    Additional Comments (Optional)
                  </Label>
                  <Textarea
                    value={comment}
                    onChange={(e) => setComment(e.target.value)}
                    placeholder="Tell us more about your experience..."
                    rows={3}
                    className="text-sm resize-y min-h-[60px]"
                    maxLength={500}
                  />
                  <p className="text-[10px] text-muted-foreground text-right">{comment.length}/500</p>
                </div>

                {/* Submit */}
                <DialogFooter className="gap-2 pt-2">
                  <Button variant="outline" onClick={() => onOpenChange(false)} className="text-xs flex-1">
                    Cancel
                  </Button>
                  <Button
                    onClick={handleSubmit}
                    disabled={submitting || rating === 0}
                    className="text-xs flex-1 gap-1.5"
                    style={rating > 0 ? { backgroundColor: NAVY, color: 'white' } : undefined}
                  >
                    {submitting ? (
                      <motion.div
                        animate={{ rotate: 360 }}
                        transition={{ duration: 1, repeat: Infinity, ease: 'linear' }}
                      >
                        <Send className="h-3 w-3" />
                      </motion.div>
                    ) : (
                      <Send className="h-3 w-3" />
                    )}
                    {submitting ? 'Submitting...' : 'Submit Feedback'}
                  </Button>
                </DialogFooter>
              </motion.div>
            )}
          </AnimatePresence>
        </motion.div>
      </DialogContent>
    </Dialog>
  );
}
