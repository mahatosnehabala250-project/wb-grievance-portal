'use client';

import { useState, useEffect, useRef, useCallback } from 'react';
import { motion, AnimatePresence } from 'framer-motion';
import { MessageSquare, Search, Phone, MapPin, Clock, CheckCircle, Circle, RefreshCw, ChevronRight, Bot, User } from 'lucide-react';

interface ChatContact {
  phone: string;
  village?: string;
  block?: string;
  district?: string;
  total_messages: number;
  total_complaints: number;
  last_seen: string;
  last_message: string;
  last_direction: 'inbound' | 'outbound';
  session_state?: string;
  language?: string;
}

interface ChatMessage {
  id: string;
  phone: string;
  direction: 'inbound' | 'outbound';
  message: string;
  language?: string;
  created_at: string;
}

export function ChatDashboard() {
  const [contacts, setContacts] = useState<ChatContact[]>([]);
  const [selectedPhone, setSelectedPhone] = useState<string | null>(null);
  const [messages, setMessages] = useState<ChatMessage[]>([]);
  const [search, setSearch] = useState('');
  const [loading, setLoading] = useState(true);
  const [msgLoading, setMsgLoading] = useState(false);
  const [lastRefresh, setLastRefresh] = useState(new Date());
  const messagesEndRef = useRef<HTMLDivElement>(null);

  const fetchContacts = useCallback(async () => {
    try {
      const res = await fetch('/api/chat/contacts', { headers: { 'Cache-Control': 'no-cache' } });
      if (res.ok) {
        const data = await res.json();
        setContacts(data.contacts || []);
      }
    } catch (e) {} finally {
      setLoading(false);
      setLastRefresh(new Date());
    }
  }, []);

  const fetchMessages = useCallback(async (phone: string) => {
    setMsgLoading(true);
    try {
      const res = await fetch(`/api/chat/messages?phone=${encodeURIComponent(phone)}`);
      if (res.ok) {
        const data = await res.json();
        setMessages(data.messages || []);
        setTimeout(() => messagesEndRef.current?.scrollIntoView({ behavior: 'smooth' }), 100);
      }
    } catch (e) {} finally {
      setMsgLoading(false);
    }
  }, []);

  useEffect(() => { fetchContacts(); }, []);
  useEffect(() => {
    if (!selectedPhone) return;
    fetchMessages(selectedPhone);
    const interval = setInterval(() => fetchMessages(selectedPhone), 10000);
    return () => clearInterval(interval);
  }, [selectedPhone]);

  const filtered = contacts.filter(c =>
    c.phone.includes(search) ||
    (c.district || '').toLowerCase().includes(search.toLowerCase()) ||
    (c.block || '').toLowerCase().includes(search.toLowerCase())
  );

  const selected = contacts.find(c => c.phone === selectedPhone);
  const formatTime = (iso: string) => {
    const d = new Date(iso);
    const now = new Date();
    const diff = (now.getTime() - d.getTime()) / 1000;
    if (diff < 60) return 'এখনই';
    if (diff < 3600) return Math.floor(diff/60) + 'm আগে';
    if (diff < 86400) return Math.floor(diff/3600) + 'h আগে';
    return d.toLocaleDateString('bn-IN', { day:'numeric', month:'short' });
  };
  const formatMsgTime = (iso: string) => new Date(iso).toLocaleTimeString('en-IN', { hour:'2-digit', minute:'2-digit' });

  return (
    <div className="flex h-[calc(100vh-120px)] rounded-2xl overflow-hidden border border-border bg-card shadow-lg">

      {/* ── LEFT: Contact List ── */}
      <div className="w-80 flex flex-col border-r border-border bg-muted/20">
        {/* Header */}
        <div className="p-4 border-b border-border">
          <div className="flex items-center justify-between mb-3">
            <div className="flex items-center gap-2">
              <div className="h-8 w-8 rounded-xl bg-primary flex items-center justify-center">
                <MessageSquare className="h-4 w-4 text-primary-foreground" />
              </div>
              <div>
                <h2 className="font-bold text-sm">WhatsApp Chats</h2>
                <p className="text-[10px] text-muted-foreground">{contacts.length} conversations</p>
              </div>
            </div>
            <button onClick={fetchContacts} className="p-1.5 rounded-lg hover:bg-muted transition-colors">
              <RefreshCw className="h-3.5 w-3.5 text-muted-foreground" />
            </button>
          </div>
          {/* Search */}
          <div className="relative">
            <Search className="absolute left-2.5 top-1/2 -translate-y-1/2 h-3.5 w-3.5 text-muted-foreground" />
            <input
              value={search}
              onChange={e => setSearch(e.target.value)}
              placeholder="Search phone, district..."
              className="w-full h-8 pl-8 pr-3 rounded-lg bg-background border border-border text-xs focus:outline-none focus:border-primary transition-colors"
            />
          </div>
        </div>

        {/* Contacts */}
        <div className="flex-1 overflow-y-auto">
          {loading ? (
            <div className="p-8 text-center text-muted-foreground text-sm">Loading...</div>
          ) : filtered.length === 0 ? (
            <div className="p-8 text-center">
              <MessageSquare className="h-8 w-8 text-muted-foreground/30 mx-auto mb-2" />
              <p className="text-sm text-muted-foreground">No conversations yet</p>
              <p className="text-xs text-muted-foreground/60 mt-1">Citizens will appear here after messaging</p>
            </div>
          ) : (
            filtered.map(contact => (
              <motion.button
                key={contact.phone}
                onClick={() => setSelectedPhone(contact.phone)}
                className={`w-full p-3 text-left border-b border-border/50 hover:bg-muted/50 transition-colors ${selectedPhone === contact.phone ? 'bg-primary/5 border-l-2 border-l-primary' : ''}`}
                whileHover={{ x: 2 }}
              >
                <div className="flex items-start gap-2.5">
                  {/* Avatar */}
                  <div className={`h-9 w-9 rounded-full flex items-center justify-center shrink-0 text-white text-xs font-bold ${contact.total_complaints > 0 ? 'bg-blue-500' : 'bg-slate-400'}`}>
                    {contact.phone.slice(-2)}
                  </div>
                  <div className="flex-1 min-w-0">
                    <div className="flex items-center justify-between mb-0.5">
                      <span className="text-xs font-semibold truncate">
                        +{contact.phone.replace(/^91/, '91 ').replace(/(\d{5})(\d{5})$/, '$1 $2')}
                      </span>
                      <span className="text-[10px] text-muted-foreground shrink-0 ml-1">
                        {formatTime(contact.last_seen)}
                      </span>
                    </div>
                    {contact.district && (
                      <div className="flex items-center gap-1 mb-0.5">
                        <MapPin className="h-2.5 w-2.5 text-muted-foreground" />
                        <span className="text-[10px] text-muted-foreground truncate">
                          {[contact.block, contact.district].filter(Boolean).join(', ')}
                        </span>
                      </div>
                    )}
                    <p className={`text-[11px] truncate ${contact.last_direction === 'inbound' ? 'text-foreground' : 'text-muted-foreground'}`}>
                      {contact.last_direction === 'outbound' && <span className="text-primary">Sahayak: </span>}
                      {contact.last_message?.slice(0, 40)}{(contact.last_message?.length || 0) > 40 ? '...' : ''}
                    </p>
                  </div>
                  {contact.total_complaints > 0 && (
                    <div className="h-4 w-4 rounded-full bg-primary text-primary-foreground text-[9px] flex items-center justify-center shrink-0 font-bold">
                      {contact.total_complaints}
                    </div>
                  )}
                </div>
              </motion.button>
            ))
          )}
        </div>

        {/* Footer */}
        <div className="p-2 border-t border-border text-center">
          <p className="text-[10px] text-muted-foreground">
            Updated {formatTime(lastRefresh.toISOString())}
          </p>
        </div>
      </div>

      {/* ── RIGHT: Chat Window ── */}
      {!selectedPhone ? (
        <div className="flex-1 flex items-center justify-center bg-muted/10">
          <div className="text-center">
            <div className="h-16 w-16 rounded-2xl bg-muted flex items-center justify-center mx-auto mb-4">
              <MessageSquare className="h-8 w-8 text-muted-foreground/40" />
            </div>
            <h3 className="font-semibold text-foreground mb-1">Select a conversation</h3>
            <p className="text-sm text-muted-foreground">Choose a citizen from the list to view their chat</p>
          </div>
        </div>
      ) : (
        <div className="flex-1 flex flex-col">
          {/* Chat header */}
          <div className="p-4 border-b border-border bg-card flex items-center justify-between">
            <div className="flex items-center gap-3">
              <div className="h-9 w-9 rounded-full bg-blue-500 flex items-center justify-center text-white text-xs font-bold">
                {selectedPhone.slice(-2)}
              </div>
              <div>
                <p className="font-semibold text-sm">+{selectedPhone}</p>
                {selected?.district && (
                  <p className="text-xs text-muted-foreground flex items-center gap-1">
                    <MapPin className="h-3 w-3" />
                    {[selected.block, selected.district].filter(Boolean).join(', ')}
                  </p>
                )}
              </div>
            </div>
            <div className="flex items-center gap-3">
              {selected && (
                <div className="flex items-center gap-2 text-xs text-muted-foreground">
                  <span className="flex items-center gap-1">
                    <MessageSquare className="h-3 w-3" />
                    {selected.total_messages} msgs
                  </span>
                  <span className="flex items-center gap-1">
                    <CheckCircle className="h-3 w-3 text-blue-500" />
                    {selected.total_complaints} complaints
                  </span>
                </div>
              )}
              <button onClick={() => fetchMessages(selectedPhone)} className="p-1.5 rounded-lg hover:bg-muted transition-colors">
                <RefreshCw className={`h-3.5 w-3.5 text-muted-foreground ${msgLoading ? 'animate-spin' : ''}`} />
              </button>
            </div>
          </div>

          {/* Messages */}
          <div className="flex-1 overflow-y-auto p-4 space-y-2 bg-muted/5">
            {msgLoading && messages.length === 0 ? (
              <div className="text-center text-muted-foreground text-sm py-8">Loading messages...</div>
            ) : messages.length === 0 ? (
              <div className="text-center text-muted-foreground text-sm py-8">No messages found</div>
            ) : (
              <>
                {messages.map((msg, i) => (
                  <motion.div
                    key={msg.id}
                    initial={{ opacity: 0, y: 8 }}
                    animate={{ opacity: 1, y: 0 }}
                    transition={{ delay: Math.min(i * 0.02, 0.3) }}
                    className={`flex ${msg.direction === 'outbound' ? 'justify-start' : 'justify-end'}`}
                  >
                    <div className={`flex items-end gap-1.5 max-w-[75%] ${msg.direction === 'outbound' ? 'flex-row' : 'flex-row-reverse'}`}>
                      {/* Avatar */}
                      <div className={`h-6 w-6 rounded-full flex items-center justify-center shrink-0 mb-1 ${msg.direction === 'outbound' ? 'bg-primary/20' : 'bg-blue-500/20'}`}>
                        {msg.direction === 'outbound'
                          ? <Bot className="h-3 w-3 text-primary" />
                          : <User className="h-3 w-3 text-blue-500" />
                        }
                      </div>
                      {/* Bubble */}
                      <div>
                        <div className={`rounded-2xl px-3 py-2 text-sm leading-relaxed whitespace-pre-wrap break-words ${
                          msg.direction === 'outbound'
                            ? 'bg-primary text-primary-foreground rounded-tl-sm'
                            : 'bg-background border border-border rounded-tr-sm'
                        }`}>
                          {msg.message}
                        </div>
                        <p className={`text-[10px] text-muted-foreground mt-0.5 ${msg.direction === 'outbound' ? 'text-left pl-1' : 'text-right pr-1'}`}>
                          {formatMsgTime(msg.created_at)}
                        </p>
                      </div>
                    </div>
                  </motion.div>
                ))}
                <div ref={messagesEndRef} />
              </>
            )}
          </div>

          {/* Read-only notice */}
          <div className="p-3 border-t border-border bg-muted/30 flex items-center justify-center gap-2">
            <Circle className="h-3 w-3 text-green-500 fill-green-500" />
            <p className="text-xs text-muted-foreground">Read-only view — AI Sahayak handles all responses automatically</p>
          </div>
        </div>
      )}
    </div>
  );
}
