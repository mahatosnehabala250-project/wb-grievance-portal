'use client';

import { useState, useCallback } from 'react';
import {
  Server, Database, Shield, ShieldCheck, Globe, Cloud, Container, Terminal,
  Code, Copy, CheckCircle, AlertTriangle, XCircle, Settings, Cpu, HardDrive,
  Network, Lock, Key, Eye, FileText, ArrowRight, ExternalLink, Package, Box, Layers,
} from 'lucide-react';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Separator } from '@/components/ui/separator';
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs';
import { Progress } from '@/components/ui/progress';
import { motion } from 'framer-motion';
import { useAuthStore } from '@/lib/auth-store';
import { NAVY } from '@/lib/constants';

// ─── Copy-to-clipboard code block ───
function CodeBlock({ code, filename }: { code: string; filename?: string }) {
  const [copied, setCopied] = useState(false);

  const handleCopy = useCallback(() => {
    navigator.clipboard.writeText(code).then(() => {
      setCopied(true);
      setTimeout(() => setCopied(false), 2000);
    });
  }, [code]);

  return (
    <div className="rounded-xl overflow-hidden border border-border/60 shadow-sm">
      {filename && (
        <div className="flex items-center justify-between px-4 py-2 border-b border-border/60" style={{ backgroundColor: '#0c1425' }}>
          <div className="flex items-center gap-2">
            <div className="flex gap-1.5">
              <span className="h-3 w-3 rounded-full bg-red-500/70" />
              <span className="h-3 w-3 rounded-full bg-yellow-500/70" />
              <span className="h-3 w-3 rounded-full bg-green-500/70" />
            </div>
            <span className="text-xs font-mono text-slate-400 ml-2">{filename}</span>
          </div>
          <Button
            variant="ghost"
            size="sm"
            onClick={handleCopy}
            className="h-7 px-2 text-slate-400 hover:text-slate-200 hover:bg-white/10"
          >
            {copied ? <CheckCircle className="h-3.5 w-3.5 text-green-400 mr-1.5" /> : <Copy className="h-3.5 w-3.5 mr-1.5" />}
            <span className="text-[11px]">{copied ? 'Copied!' : 'Copy'}</span>
          </Button>
        </div>
      )}
      {!filename && (
        <div className="flex justify-end px-3 py-1.5" style={{ backgroundColor: '#0c1425' }}>
          <Button
            variant="ghost"
            size="sm"
            onClick={handleCopy}
            className="h-7 px-2 text-slate-400 hover:text-slate-200 hover:bg-white/10"
          >
            {copied ? <CheckCircle className="h-3.5 w-3.5 text-green-400 mr-1.5" /> : <Copy className="h-3.5 w-3.5 mr-1.5" />}
            <span className="text-[11px]">{copied ? 'Copied!' : 'Copy'}</span>
          </Button>
        </div>
      )}
      <pre className="p-4 overflow-x-auto text-[13px] leading-relaxed max-h-[480px] overflow-y-auto" style={{ backgroundColor: '#0f172a' }}>
        <code className="font-mono text-slate-300 whitespace-pre">{code}</code>
      </pre>
    </div>
  );
}

// ─── Checklist item ───
function ChecklistItem({ label, status }: { label: string; status: 'ready' | 'needs-config' | 'critical' | 'pending' }) {
  const config = {
    ready: { Icon: CheckCircle, color: 'text-emerald-500', bg: 'bg-emerald-50 dark:bg-emerald-950/30', border: 'border-emerald-200 dark:border-emerald-800/50', badge: 'bg-emerald-100 text-emerald-700 dark:bg-emerald-900/50 dark:text-emerald-300', badgeText: 'Ready' },
    'needs-config': { Icon: AlertTriangle, color: 'text-amber-500', bg: 'bg-amber-50 dark:bg-amber-950/30', border: 'border-amber-200 dark:border-amber-800/50', badge: 'bg-amber-100 text-amber-700 dark:bg-amber-900/50 dark:text-amber-300', badgeText: 'Needs Config' },
    critical: { Icon: XCircle, color: 'text-red-500', bg: 'bg-red-50 dark:bg-red-950/30', border: 'border-red-200 dark:border-red-800/50', badge: 'bg-red-100 text-red-700 dark:bg-red-900/50 dark:text-red-300', badgeText: 'Critical' },
    pending: { Icon: Box, color: 'text-slate-400', bg: 'bg-slate-50 dark:bg-slate-950/30', border: 'border-slate-200 dark:border-slate-700/50', badge: 'bg-slate-100 text-slate-600 dark:bg-slate-800/50 dark:text-slate-400', badgeText: 'Pending' },
  };
  const c = config[status];
  return (
    <div className={`flex items-center justify-between gap-3 p-3 rounded-xl border ${c.bg} ${c.border} transition-colors`}>
      <div className="flex items-center gap-3 min-w-0">
        <c.Icon className={`h-5 w-5 shrink-0 ${c.color}`} />
        <span className="text-sm font-medium text-foreground truncate">{label}</span>
      </div>
      <span className={`text-[10px] font-bold uppercase tracking-wider px-2.5 py-1 rounded-full shrink-0 ${c.badge}`}>{c.badgeText}</span>
    </div>
  );
}

// ─── Infrastructure card ───
function InfraCard({ icon: Icon, title, description, color }: { icon: React.ElementType; title: string; description: string; color: string }) {
  return (
    <motion.div whileHover={{ y: -2, boxShadow: '0 8px 24px rgba(0,0,0,0.1)' }} transition={{ duration: 0.2 }}>
      <Card className="border-0 shadow-sm h-full hover:shadow-lg transition-shadow">
        <CardContent className="p-5">
          <div className="flex items-start gap-3">
            <div className="flex items-center justify-center rounded-xl p-2.5 shrink-0" style={{ backgroundColor: `${color}15`, color }}>
              <Icon className="h-5 w-5" />
            </div>
            <div className="min-w-0">
              <h4 className="text-sm font-bold text-foreground">{title}</h4>
              <p className="text-xs text-muted-foreground mt-1 leading-relaxed">{description}</p>
            </div>
          </div>
        </CardContent>
      </Card>
    </motion.div>
  );
}

// ─── Step card for n8n guide ───
function StepCard({ step, title, description, code }: { step: number; title: string; description: string; code?: string }) {
  const [copied, setCopied] = useState(false);
  const handleCopy = useCallback(() => {
    if (!code) return;
    navigator.clipboard.writeText(code).then(() => { setCopied(true); setTimeout(() => setCopied(false), 2000); });
  }, [code]);

  return (
    <div className="flex gap-4 group">
      <div className="flex flex-col items-center shrink-0">
        <div className="h-9 w-9 rounded-full flex items-center justify-center text-sm font-black text-white shadow-md" style={{ backgroundColor: NAVY }}>
          {step}
        </div>
        {step < 9 && <div className="w-0.5 flex-1 mt-2 rounded-full bg-gradient-to-b from-sky-300 to-transparent min-h-[20px]" />}
      </div>
      <div className="flex-1 pb-6">
        <h4 className="text-sm font-bold text-foreground">{title}</h4>
        <p className="text-xs text-muted-foreground mt-1 leading-relaxed">{description}</p>
        {code && (
          <div className="mt-3 rounded-lg overflow-hidden border border-border/60">
            <div className="flex items-center justify-between px-3 py-1.5" style={{ backgroundColor: '#0c1425' }}>
              <Terminal className="h-3 w-3 text-slate-500" />
              <Button variant="ghost" size="sm" onClick={handleCopy} className="h-6 px-1.5 text-slate-400 hover:text-slate-200 hover:bg-white/10">
                {copied ? <CheckCircle className="h-3 w-3 text-green-400 mr-1" /> : <Copy className="h-3 w-3 mr-1" />}
                <span className="text-[10px]">{copied ? 'Copied!' : 'Copy'}</span>
              </Button>
            </div>
            <pre className="p-3 text-[12px] leading-relaxed overflow-x-auto" style={{ backgroundColor: '#0f172a' }}>
              <code className="font-mono text-slate-300">{code}</code>
            </pre>
          </div>
        )}
      </div>
    </div>
  );
}

// ─── Security item ───
function SecurityItem({ label, description, severity }: { label: string; description: string; severity: 'ready' | 'needs-config' | 'critical' }) {
  const config = {
    ready: { Icon: ShieldCheck, color: 'text-emerald-500', bg: 'bg-emerald-50 dark:bg-emerald-950/30', border: 'border-emerald-200 dark:border-emerald-800/50' },
    'needs-config': { Icon: AlertTriangle, color: 'text-amber-500', bg: 'bg-amber-50 dark:bg-amber-950/30', border: 'border-amber-200 dark:border-amber-800/50' },
    critical: { Icon: Shield, color: 'text-red-500', bg: 'bg-red-50 dark:bg-red-950/30', border: 'border-red-200 dark:border-red-800/50' },
  };
  const c = config[severity];
  return (
    <div className={`flex items-start gap-3 p-3.5 rounded-xl border ${c.bg} ${c.border}`}>
      <c.Icon className={`h-5 w-5 shrink-0 mt-0.5 ${c.color}`} />
      <div className="min-w-0">
        <p className="text-sm font-semibold text-foreground">{label}</p>
        <p className="text-[11px] text-muted-foreground mt-0.5 leading-relaxed">{description}</p>
      </div>
    </div>
  );
}

// ─── Monitoring item ───
function MonitoringItem({ icon: Icon, title, description, color }: { icon: React.ElementType; title: string; description: string; color: string }) {
  return (
    <div className="flex items-start gap-3 p-3.5 rounded-xl bg-muted/40 border border-border/50 hover:bg-muted/60 transition-colors">
      <div className="flex items-center justify-center rounded-lg p-2 shrink-0" style={{ backgroundColor: `${color}12`, color }}>
        <Icon className="h-4 w-4" />
      </div>
      <div className="min-w-0">
        <p className="text-sm font-semibold text-foreground">{title}</p>
        <p className="text-[11px] text-muted-foreground mt-0.5 leading-relaxed">{description}</p>
      </div>
    </div>
  );
}

// ─── Section header ───
function SectionHeader({ icon: Icon, title, description, delay }: { icon: React.ElementType; title: string; description: string; delay: number }) {
  return (
    <motion.div initial={{ opacity: 0, y: 12 }} animate={{ opacity: 1, y: 0 }} transition={{ duration: 0.4, delay }}>
      <div className="flex items-center gap-3 mb-1">
        <div className="flex items-center justify-center rounded-lg p-2" style={{ backgroundColor: `${NAVY}12`, color: NAVY }}>
          <Icon className="h-5 w-5" />
        </div>
        <div>
          <h3 className="text-lg font-black text-foreground">{title}</h3>
          <p className="text-xs text-muted-foreground">{description}</p>
        </div>
      </div>
    </motion.div>
  );
}

// ═══════════════════════════════════════════════════════════════════════════════
// ─── ENV VARS ─────────────────────────────────────────────────────────────────
// ═══════════════════════════════════════════════════════════════════════════════

const ENV_VARS_BLOCK = `# Database
DATABASE_URL="postgresql://user:password@host:5432/wb_grievance"

# Authentication
JWT_SECRET="your-256-bit-secret-key-here"
NEXTAUTH_SECRET="your-nextauth-secret"
NEXTAUTH_URL="https://wb-grievance.gov.in"

# n8n Integration
N8N_WEBHOOK_URL="https://your-n8n-instance.com/webhook/grievance"
N8N_API_KEY="your-n8n-api-key"

# Airtable Integration
AIRTABLE_PERSONAL_ACCESS_TOKEN="your-airtable-token"
AIRTABLE_BASE_ID="your-base-id"
AIRTABLE_TABLE_NAME="Complaints"

# SMS/WhatsApp (for citizen notifications)
TWILIO_ACCOUNT_SID="your-twilio-sid"
TWILIO_AUTH_TOKEN="your-twilio-token"
TWILIO_PHONE_NUMBER="+919876543210"

# Email
SMTP_HOST="smtp.gov.in"
SMTP_PORT="587"
SMTP_USER="notifications@wb.gov.in"
SMTP_PASSWORD="your-smtp-password"

# App Settings
NEXT_PUBLIC_APP_URL="https://wb-grievance.gov.in"
NEXT_PUBLIC_APP_NAME="WB Grievance Portal"`;

// ═══════════════════════════════════════════════════════════════════════════════
// ─── DOCKER COMPOSE ──────────────────────────────────────────────────────────
// ═══════════════════════════════════════════════════════════════════════════════

const DOCKER_COMPOSE_BLOCK = `version: '3.8'

services:
  app:
    build:
      context: .
      dockerfile: Dockerfile
    ports:
      - "3000:3000"
    environment:
      - DATABASE_URL=postgresql://grievance:grievance123@db:5432/wb_grievance
      - JWT_SECRET=\${JWT_SECRET}
      - NEXTAUTH_SECRET=\${NEXTAUTH_SECRET}
      - NEXTAUTH_URL=https://wb-grievance.gov.in
      - N8N_WEBHOOK_URL=http://n8n:5678/webhook/grievance
      - REDIS_URL=redis://redis:6379
    depends_on:
      db:
        condition: service_healthy
      redis:
        condition: service_healthy
    restart: unless-stopped
    networks:
      - grievance-net

  db:
    image: postgres:16-alpine
    environment:
      POSTGRES_DB: wb_grievance
      POSTGRES_USER: grievance
      POSTGRES_PASSWORD: grievance123
    volumes:
      - postgres_data:/var/lib/postgresql/data
    ports:
      - "5432:5432"
    healthcheck:
      test: ["CMD-SHELL", "pg_isready -U grievance"]
      interval: 5s
      timeout: 5s
      retries: 5
    restart: unless-stopped
    networks:
      - grievance-net

  redis:
    image: redis:7-alpine
    ports:
      - "6379:6379"
    volumes:
      - redis_data:/data
    healthcheck:
      test: ["CMD", "redis-cli", "ping"]
      interval: 5s
      timeout: 5s
      retries: 5
    restart: unless-stopped
    networks:
      - grievance-net

  n8n:
    image: docker.n8n.io/n8nio/n8n
    ports:
      - "5678:5678"
    environment:
      - N8N_BASIC_AUTH_ACTIVE=true
      - N8N_BASIC_AUTH_USER=admin
      - N8N_BASIC_AUTH_PASSWORD=\${N8N_PASSWORD}
      - WEBHOOK_URL=https://n8n.wb-grievance.gov.in
    volumes:
      - n8n_data:/home/node/.n8n
    restart: unless-stopped
    networks:
      - grievance-net

  caddy:
    image: caddy:2-alpine
    ports:
      - "80:80"
      - "443:443"
    volumes:
      - ./Caddyfile:/etc/caddy/Caddyfile
      - caddy_data:/data
      - caddy_config:/config
    depends_on:
      - app
    restart: unless-stopped
    networks:
      - grievance-net

volumes:
  postgres_data:
  redis_data:
  n8n_data:
  caddy_data:
  caddy_config:

networks:
  grievance-net:
    driver: bridge`;

const DOCKERFILE_BLOCK = `FROM node:20-alpine AS base

# Install dependencies
FROM base AS deps
WORKDIR /app
COPY package.json bun.lockb ./
RUN corepack enable && bun install --frozen-lockfile

# Build
FROM base AS builder
WORKDIR /app
COPY --from=deps /app/node_modules ./node_modules
COPY . .
ENV NEXT_TELEMETRY_DISABLED=1
RUN corepack enable && bun run build

# Production
FROM base AS runner
WORKDIR /app
ENV NODE_ENV=production
ENV NEXT_TELEMETRY_DISABLED=1

RUN addgroup --system --gid 1001 nodejs
RUN adduser --system --uid 1001 nextjs

COPY --from=builder /app/public ./public
COPY --from=builder --chown=nextjs:nodejs /app/.next/standalone ./
COPY --from=builder --chown=nextjs:nodejs /app/.next/static ./.next/static

USER nextjs
EXPOSE 3000
ENV PORT=3000
ENV HOSTNAME="0.0.0.0"

CMD ["node", "server.js"]`;

const CADDYFILE_BLOCK = `wb-grievance.gov.in {
    reverse_proxy app:3000

    encode gzip zstd

    header {
        X-Frame-Options "SAMEORIGIN"
        X-Content-Type-Options "nosniff"
        X-XSS-Protection "1; mode=block"
        Referrer-Policy "strict-origin-when-cross-origin"
        Permissions-Policy "camera=(), microphone=(), geolocation=()"
    }

    log {
        output file /var/log/caddy/access.log
        format json
    }
}

n8n.wb-grievance.gov.in {
    reverse_proxy n8n:5678
}`;

// ═══════════════════════════════════════════════════════════════════════════════
// ─── VERCEL + SUPABASE ───────────────────────────────────────────────────────
// ═══════════════════════════════════════════════════════════════════════════════

const VERCEL_DEPLOY_BLOCK = `# 1. Install Vercel CLI
npm i -g vercel

# 2. Login to Vercel
vercel login

# 3. Set up environment variables
vercel env add DATABASE_URL production
vercel env add JWT_SECRET production
vercel env add NEXTAUTH_SECRET production
vercel env add NEXTAUTH_URL production
vercel env add N8N_WEBHOOK_URL production

# 4. Deploy to production
vercel --prod

# 5. Set up Supabase PostgreSQL
#    - Go to https://supabase.com
#    - Create a new project
#    - Copy the connection string
#    - Update DATABASE_URL env var
#    - Run: npx prisma db push
#    - Run: npx prisma db seed`;

// ═══════════════════════════════════════════════════════════════════════════════
// ─── VPS SETUP ───────────────────────────────────────────────────────────────
// ═══════════════════════════════════════════════════════════════════════════════

const VPS_SETUP_BLOCK = `#!/bin/bash
# ══════════════════════════════════════════════════════
# WB Grievance Portal — VPS Deployment Script (Ubuntu 22.04)
# ══════════════════════════════════════════════════════

# 1. Update system packages
sudo apt update && sudo apt upgrade -y

# 2. Install Node.js 20 LTS
curl -fsSL https://deb.nodesource.com/setup_20.x | sudo -E bash -
sudo apt install -y nodejs

# 3. Install PM2 globally
sudo npm install -g pm2

# 4. Install PostgreSQL 16
sudo sh -c 'echo "deb http://apt.postgresql.org/pub/repos/apt $(lsb_release -cs)-pgdg main" > /etc/apt/sources.list.d/pgdg.list'
wget --quiet -O - https://www.postgresql.org/media/keys/ACCC4CF8.asc | sudo apt-key add -
sudo apt update
sudo apt install -y postgresql-16

# 5. Create database and user
sudo -u postgres psql <<EOF
CREATE USER grievance WITH PASSWORD 'your-secure-password';
CREATE DATABASE wb_grievance OWNER grievance;
GRANT ALL PRIVILEGES ON DATABASE wb_grievance TO grievance;
EOF

# 6. Install Nginx
sudo apt install -y nginx

# 7. Install Certbot for SSL
sudo apt install -y certbot python3-certbot-nginx

# 8. Clone and build the application
cd /var/www
sudo git clone https://github.com/your-org/wb-grievance-portal.git
cd wb-grievance-portal
sudo npm install --production
sudo npx prisma db push
sudo npx prisma db seed
sudo npm run build

# 9. Configure PM2
pm2 start npm --name "wb-grievance" -- start
pm2 startup
pm2 save

# 10. Configure Nginx (see nginx.conf below)
sudo cp nginx.conf /etc/nginx/sites-available/wb-grievance
sudo ln -s /etc/nginx/sites-available/wb-grievance /etc/nginx/sites-enabled/
sudo nginx -t
sudo systemctl reload nginx

# 11. Obtain SSL certificate
sudo certbot --nginx -d wb-grievance.gov.in`;

const NGINX_CONF_BLOCK = `server {
    listen 80;
    server_name wb-grievance.gov.in;
    return 301 https://$server_name$request_uri;
}

server {
    listen 443 ssl http2;
    server_name wb-grievance.gov.in;

    ssl_certificate /etc/letsencrypt/live/wb-grievance.gov.in/fullchain.pem;
    ssl_certificate_key /etc/letsencrypt/live/wb-grievance.gov.in/privkey.pem;
    ssl_protocols TLSv1.2 TLSv1.3;
    ssl_ciphers HIGH:!aNULL:!MD5;

    # Security headers
    add_header X-Frame-Options "SAMEORIGIN" always;
    add_header X-Content-Type-Options "nosniff" always;
    add_header X-XSS-Protection "1; mode=block" always;
    add_header Referrer-Policy "strict-origin-when-cross-origin" always;

    # Rate limiting
    limit_req_zone $binary_remote_addr zone=api:10m rate=30r/m;

    location / {
        proxy_pass http://127.0.0.1:3000;
        proxy_http_version 1.1;
        proxy_set_header Upgrade $http_upgrade;
        proxy_set_header Connection 'upgrade';
        proxy_set_header Host $host;
        proxy_set_header X-Real-IP $remote_addr;
        proxy_set_header X-Forwarded-For $proxy_add_x_forwarded_for;
        proxy_set_header X-Forwarded-Proto $scheme;
        proxy_cache_bypass $http_upgrade;
    }

    location /api/ {
        limit_req zone=api burst=20 nodelay;
        proxy_pass http://127.0.0.1:3000;
        proxy_http_version 1.1;
        proxy_set_header Host $host;
        proxy_set_header X-Real-IP $remote_addr;
        proxy_set_header X-Forwarded-For $proxy_add_x_forwarded_for;
        proxy_set_header X-Forwarded-Proto $scheme;
    }

    # Gzip compression
    gzip on;
    gzip_types text/plain text/css application/json application/javascript text/xml;
    gzip_min_length 256;
}`;

// ═══════════════════════════════════════════════════════════════════════════════
// ─── MAIN COMPONENT ─────────────────────────────────────────────────────────
// ═══════════════════════════════════════════════════════════════════════════════

export default function DeploymentGuideView() {
  const user = useAuthStore((s) => s.user);

  // Only ADMIN can access this page
  if (user?.role !== 'ADMIN') {
    return (
      <div className="flex flex-col items-center justify-center py-20 text-center">
        <div className="h-16 w-16 rounded-full bg-red-50 dark:bg-red-950/30 flex items-center justify-center mb-4">
          <Shield className="h-8 w-8 text-red-500" />
        </div>
        <h2 className="text-xl font-black text-foreground">Access Restricted</h2>
        <p className="text-sm text-muted-foreground mt-1 max-w-md">
          This deployment guide is only available to system administrators. Please contact your IT team for access.
        </p>
      </div>
    );
  }

  const checklistItems: { label: string; status: 'ready' | 'needs-config' | 'critical' | 'pending' }[] = [
    { label: 'Environment Variables configured (DATABASE_URL, JWT_SECRET, NEXTAUTH_SECRET)', status: 'ready' },
    { label: 'Database migrated to PostgreSQL/MySQL (SQLite is dev only)', status: 'needs-config' },
    { label: 'SSL/TLS certificate installed', status: 'ready' },
    { label: 'Domain name configured', status: 'ready' },
    { label: 'Reverse proxy (Nginx/Caddy) set up', status: 'ready' },
    { label: 'n8n instance deployed and connected', status: 'needs-config' },
    { label: 'Airtable base created and synced', status: 'pending' },
    { label: 'Monitoring and logging enabled', status: 'needs-config' },
    { label: 'Backup strategy configured', status: 'needs-config' },
    { label: 'Load testing completed', status: 'pending' },
    { label: 'Security audit passed', status: 'pending' },
    { label: 'Performance optimization (code splitting, caching)', status: 'pending' },
  ];

  const readyCount = checklistItems.filter(i => i.status === 'ready').length;
  const totalCount = checklistItems.length;
  const readinessPercent = Math.round((readyCount / totalCount) * 100);

  const infraCards = [
    { icon: Server, title: 'Server', description: 'Minimum 2 vCPU, 4GB RAM, 50GB SSD (AWS EC2 t3.medium or equivalent)', color: '#0A2463' },
    { icon: Database, title: 'Database', description: 'PostgreSQL 14+ (recommended) or MySQL 8+ with 10GB storage', color: '#16A34A' },
    { icon: Box, title: 'Runtime', description: 'Node.js 20+, npm or bun for package management', color: '#EA580C' },
    { icon: Globe, title: 'Web Server', description: 'Nginx or Caddy as reverse proxy with SSL termination', color: '#0284C7' },
    { icon: Layers, title: 'n8n', description: 'Self-hosted n8n instance (Docker recommended) — 1 vCPU, 2GB RAM', color: '#D97706' },
    { icon: Network, title: 'Domain', description: 'Custom domain with SSL certificate (Let\'s Encrypt)', color: '#7C3AED' },
    { icon: Cloud, title: 'CDN', description: 'CloudFlare or AWS CloudFront (optional but recommended)', color: '#DC2626' },
    { icon: HardDrive, title: 'Storage', description: 'S3-compatible storage for file uploads (future feature)', color: '#2563EB' },
  ];

  const securityItems = [
    { label: 'Rate limiting on all API endpoints', description: 'Implement rate limiting (30 req/min) on /api/* routes to prevent abuse', severity: 'ready' as const },
    { label: 'CORS configuration', description: 'Restrict allowed origins to official domain(s) only', severity: 'ready' as const },
    { label: 'CSP headers', description: 'Configure Content-Security-Policy to prevent XSS and injection attacks', severity: 'needs-config' as const },
    { label: 'Helmet.js for security headers', description: 'Use helmet middleware for X-Frame-Options, HSTS, and other headers', severity: 'needs-config' as const },
    { label: 'Input validation and sanitization', description: 'Validate all user inputs server-side with Zod schema validation', severity: 'ready' as const },
    { label: 'SQL injection prevention', description: 'Prisma ORM handles parameterized queries — no raw SQL used', severity: 'ready' as const },
    { label: 'XSS prevention', description: 'React auto-escapes output; additional sanitization on rich text fields', severity: 'ready' as const },
    { label: 'CSRF protection', description: 'SameSite cookies + token-based API authentication via JWT', severity: 'ready' as const },
    { label: 'Regular dependency audits', description: 'Run npm audit weekly; auto-block PRs with critical vulnerabilities', severity: 'needs-config' as const },
    { label: 'Secret rotation policy', description: 'Rotate JWT_SECRET, NEXTAUTH_SECRET, and API keys every 90 days', severity: 'critical' as const },
  ];

  const monitoringItems = [
    { icon: Eye, title: 'Health Check Endpoint', description: 'GET /api/health — returns uptime, DB status, memory usage, and version info', color: '#16A34A' },
    { icon: Cpu, title: 'Grafana + Prometheus', description: 'Set up Grafana dashboards for real-time metrics (CPU, memory, request latency)', color: '#DC2626' },
    { icon: Shield, title: 'Sentry Error Tracking', description: 'Capture and track JavaScript errors with source maps for production debugging', color: '#7C3AED' },
    { icon: FileText, title: 'ELK Stack / CloudWatch', description: 'Centralized log aggregation for API requests, errors, and system events', color: '#0284C7' },
    { icon: Database, title: 'Daily Database Backups', description: 'Automated pg_dump to S3-compatible storage with 30-day retention', color: '#EA580C' },
    { icon: Network, title: 'Uptime Monitoring', description: 'UptimeRobot or Pingdom — alert on downtime > 2 minutes via email/Slack', color: '#0A2463' },
    { icon: Lock, title: 'SSL Auto-Renewal', description: 'Certbot cron job for automatic Let\'s Encrypt certificate renewal', color: '#D97706' },
  ];

  return (
    <div className="space-y-6 max-w-5xl">
      {/* ═══ Page Header ═══ */}
      <motion.div initial={{ opacity: 0, y: 12 }} animate={{ opacity: 1, y: 0 }} transition={{ duration: 0.4 }}>
        <div className="flex items-start gap-3 mb-1">
          <div className="flex items-center justify-center rounded-lg p-2" style={{ backgroundColor: `${NAVY}12`, color: NAVY }}>
            <Package className="h-5 w-5" />
          </div>
          <div>
            <h2 className="text-xl sm:text-2xl font-black tracking-tight text-foreground">Production Deployment Guide</h2>
            <p className="text-xs text-muted-foreground flex items-center gap-1 mt-0.5">
              <Settings className="h-3.5 w-3.5" />
              Complete guide for deploying the WB Grievance Portal to production
            </p>
          </div>
        </div>
      </motion.div>

      {/* ═══ Production Readiness Progress ═══ */}
      <motion.div initial={{ opacity: 0, y: 12 }} animate={{ opacity: 1, y: 0 }} transition={{ duration: 0.4, delay: 0.05 }}>
        <Card className="border-0 shadow-sm overflow-hidden">
          <div className="h-[3px] w-full" style={{ background: `linear-gradient(90deg, ${NAVY}, ${readinessPercent >= 80 ? '#16A34A' : readinessPercent >= 50 ? '#D97706' : '#DC2626'}, transparent)` }} />
          <CardContent className="p-5">
            <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3 mb-3">
              <div className="flex items-center gap-3">
                <div className="flex items-center justify-center rounded-xl p-2.5" style={{ backgroundColor: readinessPercent >= 80 ? '#16A34A18' : readinessPercent >= 50 ? '#D9770618' : '#DC262618' }}>
                  <ShieldCheck className={`h-5 w-5 ${readinessPercent >= 80 ? 'text-emerald-500' : readinessPercent >= 50 ? 'text-amber-500' : 'text-red-500'}`} />
                </div>
                <div>
                  <h3 className="text-sm font-bold text-foreground">Production Readiness</h3>
                  <p className="text-[11px] text-muted-foreground">{readyCount} of {totalCount} items configured</p>
                </div>
              </div>
              <Badge variant="outline" className={`text-xs font-bold px-3 py-1 ${readinessPercent >= 80 ? 'border-emerald-300 text-emerald-700 bg-emerald-50 dark:border-emerald-700 dark:text-emerald-300 dark:bg-emerald-950/40' : readinessPercent >= 50 ? 'border-amber-300 text-amber-700 bg-amber-50 dark:border-amber-700 dark:text-amber-300 dark:bg-amber-950/40' : 'border-red-300 text-red-700 bg-red-50 dark:border-red-700 dark:text-red-300 dark:bg-red-950/40'}`}>
                {readinessPercent}% Ready
              </Badge>
            </div>
            <div className="space-y-2">
              <Progress value={readinessPercent} className="h-2.5" />
              <div className="flex items-center justify-between gap-4 text-[10px] text-muted-foreground">
                <div className="flex items-center gap-4">
                  <span className="flex items-center gap-1"><span className="h-2 w-2 rounded-full bg-emerald-500" />{checklistItems.filter(i => i.status === 'ready').length} Ready</span>
                  <span className="flex items-center gap-1"><span className="h-2 w-2 rounded-full bg-amber-500" />{checklistItems.filter(i => i.status === 'needs-config').length} Needs Config</span>
                  <span className="flex items-center gap-1"><span className="h-2 w-2 rounded-full bg-red-500" />{checklistItems.filter(i => i.status === 'critical').length} Critical</span>
                  <span className="flex items-center gap-1"><span className="h-2 w-2 rounded-full bg-slate-400" />{checklistItems.filter(i => i.status === 'pending').length} Pending</span>
                </div>
                <span>Target: 100%</span>
              </div>
            </div>
          </CardContent>
        </Card>
      </motion.div>

      {/* ═══ 1. Production Readiness Checklist ═══ */}
      <motion.div initial={{ opacity: 0, y: 12 }} animate={{ opacity: 1, y: 0 }} transition={{ duration: 0.4, delay: 0.1 }}>
        <SectionHeader icon={CheckCircle} title="Production Readiness Checklist" description="Verify all items before going live" delay={0.1} />
        <Card className="border-0 shadow-sm mt-3">
          <CardContent className="p-4">
            <div className="grid grid-cols-1 md:grid-cols-2 gap-2.5">
              {checklistItems.map((item) => (
                <ChecklistItem key={item.label} label={item.label} status={item.status} />
              ))}
            </div>
          </CardContent>
        </Card>
      </motion.div>

      <Separator />

      {/* ═══ 2. Infrastructure Requirements ═══ */}
      <motion.div initial={{ opacity: 0, y: 12 }} animate={{ opacity: 1, y: 0 }} transition={{ duration: 0.4, delay: 0.15 }}>
        <SectionHeader icon={Server} title="Infrastructure Requirements" description="Minimum specifications for production deployment" delay={0.15} />
        <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-3 mt-3">
          {infraCards.map((card) => (
            <InfraCard key={card.title} {...card} />
          ))}
        </div>
      </motion.div>

      <Separator />

      {/* ═══ 3. Environment Variables Reference ═══ */}
      <motion.div initial={{ opacity: 0, y: 12 }} animate={{ opacity: 1, y: 0 }} transition={{ duration: 0.4, delay: 0.2 }}>
        <SectionHeader icon={Key} title="Environment Variables Reference" description="All required environment variables for production" delay={0.2} />
        <div className="mt-3 space-y-2">
          <div className="flex items-center gap-2 mb-1">
            <Badge variant="outline" className="text-[10px] font-semibold bg-red-50 text-red-700 border-red-200 dark:bg-red-950/30 dark:text-red-300 dark:border-red-800/50">
              <AlertTriangle className="h-3 w-3 mr-1" /> SENSITIVE
            </Badge>
            <span className="text-[11px] text-muted-foreground">Never commit .env files to version control. Use secrets manager in production.</span>
          </div>
          <CodeBlock code={ENV_VARS_BLOCK} filename=".env.production" />
        </div>
      </motion.div>

      <Separator />

      {/* ═══ 4. Deployment Methods ═══ */}
      <motion.div initial={{ opacity: 0, y: 12 }} animate={{ opacity: 1, y: 0 }} transition={{ duration: 0.4, delay: 0.25 }}>
        <SectionHeader icon={Container} title="Deployment Methods" description="Choose the deployment strategy that best fits your infrastructure" delay={0.25} />
        <Tabs defaultValue="docker" className="mt-3">
          <TabsList className="grid w-full grid-cols-3">
            <TabsTrigger value="docker" className="text-xs gap-1.5">
              <Container className="h-3.5 w-3.5" />
              <span className="hidden sm:inline">Docker Compose</span>
              <span className="sm:hidden">Docker</span>
              <Badge variant="outline" className="text-[9px] px-1.5 py-0 text-emerald-600 border-emerald-300 dark:text-emerald-400 dark:border-emerald-700">Recommended</Badge>
            </TabsTrigger>
            <TabsTrigger value="vercel" className="text-xs gap-1.5">
              <Cloud className="h-3.5 w-3.5" />
              <span className="hidden sm:inline">Vercel + Supabase</span>
              <span className="sm:hidden">Vercel</span>
            </TabsTrigger>
            <TabsTrigger value="vps" className="text-xs gap-1.5">
              <Terminal className="h-3.5 w-3.5" />
              <span className="hidden sm:inline">Traditional VPS</span>
              <span className="sm:hidden">VPS</span>
            </TabsTrigger>
          </TabsList>

          {/* ── Tab 1: Docker Compose ── */}
          <TabsContent value="docker" className="space-y-4 mt-4">
            <div className="flex items-start gap-3 p-3 rounded-xl bg-emerald-50 dark:bg-emerald-950/20 border border-emerald-200/60 dark:border-emerald-800/40">
              <CheckCircle className="h-5 w-5 text-emerald-500 shrink-0 mt-0.5" />
              <div>
                <p className="text-sm font-semibold text-foreground">Recommended for Production</p>
                <p className="text-xs text-muted-foreground mt-0.5 leading-relaxed">Docker Compose provides containerized isolation, easy scaling, reproducible builds, and simplified maintenance. All services are defined in a single configuration file.</p>
              </div>
            </div>
            <CodeBlock code={DOCKER_COMPOSE_BLOCK} filename="docker-compose.yml" />
            <CodeBlock code={DOCKERFILE_BLOCK} filename="Dockerfile" />
            <CodeBlock code={CADDYFILE_BLOCK} filename="Caddyfile" />
            <div className="flex items-start gap-3 p-3 rounded-xl bg-sky-50 dark:bg-sky-950/20 border border-sky-200/60 dark:border-sky-800/40">
              <InfoIcon className="h-5 w-5 text-sky-500 shrink-0 mt-0.5" />
              <div>
                <p className="text-sm font-semibold text-foreground">Quick Start Commands</p>
                <div className="mt-2 rounded-lg overflow-hidden border border-border/60">
                  <pre className="p-3 text-[12px] leading-relaxed overflow-x-auto" style={{ backgroundColor: '#0f172a' }}>
                    <code className="font-mono text-slate-300">{`# Create .env file with secrets
cp .env.example .env
nano .env

# Start all services
docker compose up -d

# View logs
docker compose logs -f app

# Run database migrations
docker compose exec app npx prisma db push

# Restart a single service
docker compose restart app`}</code>
                  </pre>
                </div>
              </div>
            </div>
          </TabsContent>

          {/* ── Tab 2: Vercel + Supabase ── */}
          <TabsContent value="vercel" className="space-y-4 mt-4">
            <div className="flex items-start gap-3 p-3 rounded-xl bg-violet-50 dark:bg-violet-950/20 border border-violet-200/60 dark:border-violet-800/40">
              <Cloud className="h-5 w-5 text-violet-500 shrink-0 mt-0.5" />
              <div>
                <p className="text-sm font-semibold text-foreground">Vercel + Supabase</p>
                <p className="text-xs text-muted-foreground mt-0.5 leading-relaxed">Best for teams that want fully managed infrastructure with zero DevOps overhead. Vercel handles the frontend and API routes, while Supabase provides PostgreSQL, authentication, and real-time features.</p>
              </div>
            </div>
            <CodeBlock code={VERCEL_DEPLOY_BLOCK} filename="deploy-vercel.sh" />
            <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
              <Card className="border-0 shadow-sm">
                <CardContent className="p-4">
                  <div className="flex items-center gap-2 mb-3">
                    <div className="h-8 w-8 rounded-lg bg-sky-100 dark:bg-sky-900/40 flex items-center justify-center">
                      <Cloud className="h-4 w-4 text-sky-600 dark:text-sky-400" />
                    </div>
                    <div>
                      <p className="text-sm font-bold text-foreground">Vercel</p>
                      <p className="text-[10px] text-muted-foreground">Frontend & API</p>
                    </div>
                  </div>
                  <ul className="space-y-1.5 text-xs text-muted-foreground">
                    <li className="flex items-center gap-1.5"><CheckCircle className="h-3 w-3 text-emerald-500" />Automatic deployments from Git</li>
                    <li className="flex items-center gap-1.5"><CheckCircle className="h-3 w-3 text-emerald-500" />Edge functions for API routes</li>
                    <li className="flex items-center gap-1.5"><CheckCircle className="h-3 w-3 text-emerald-500" />Built-in CDN with 100+ PoPs</li>
                    <li className="flex items-center gap-1.5"><CheckCircle className="h-3 w-3 text-emerald-500" />Preview deployments for PRs</li>
                  </ul>
                </CardContent>
              </Card>
              <Card className="border-0 shadow-sm">
                <CardContent className="p-4">
                  <div className="flex items-center gap-2 mb-3">
                    <div className="h-8 w-8 rounded-lg bg-emerald-100 dark:bg-emerald-900/40 flex items-center justify-center">
                      <Database className="h-4 w-4 text-emerald-600 dark:text-emerald-400" />
                    </div>
                    <div>
                      <p className="text-sm font-bold text-foreground">Supabase</p>
                      <p className="text-[10px] text-muted-foreground">PostgreSQL Database</p>
                    </div>
                  </div>
                  <ul className="space-y-1.5 text-xs text-muted-foreground">
                    <li className="flex items-center gap-1.5"><CheckCircle className="h-3 w-3 text-emerald-500" />Managed PostgreSQL 15+</li>
                    <li className="flex items-center gap-1.5"><CheckCircle className="h-3 w-3 text-emerald-500" />Automatic daily backups</li>
                    <li className="flex items-center gap-1.5"><CheckCircle className="h-3 w-3 text-emerald-500" />Real-time subscriptions</li>
                    <li className="flex items-center gap-1.5"><CheckCircle className="h-3 w-3 text-emerald-500" />Free tier: 500MB database</li>
                  </ul>
                </CardContent>
              </Card>
            </div>
          </TabsContent>

          {/* ── Tab 3: Traditional VPS ── */}
          <TabsContent value="vps" className="space-y-4 mt-4">
            <div className="flex items-start gap-3 p-3 rounded-xl bg-amber-50 dark:bg-amber-950/20 border border-amber-200/60 dark:border-amber-800/40">
              <Terminal className="h-5 w-5 text-amber-500 shrink-0 mt-0.5" />
              <div>
                <p className="text-sm font-semibold text-foreground">Traditional VPS Deployment</p>
                <p className="text-xs text-muted-foreground mt-0.5 leading-relaxed">For teams that need full control over their infrastructure. This guide covers AWS EC2 / DigitalOcean deployment on Ubuntu 22.04 LTS with Nginx, PM2, and PostgreSQL.</p>
              </div>
            </div>
            <CodeBlock code={VPS_SETUP_BLOCK} filename="deploy-vps.sh" />
            <CodeBlock code={NGINX_CONF_BLOCK} filename="nginx.conf" />
            <div className="flex items-start gap-3 p-3 rounded-xl bg-sky-50 dark:bg-sky-950/20 border border-sky-200/60 dark:border-sky-800/40">
              <ExternalLink className="h-5 w-5 text-sky-500 shrink-0 mt-0.5" />
              <div>
                <p className="text-sm font-semibold text-foreground">Post-Deployment Checklist</p>
                <ul className="mt-2 space-y-1 text-xs text-muted-foreground">
                  <li className="flex items-center gap-2"><ArrowRight className="h-3 w-3 text-sky-500" />Verify the site loads at https://wb-grievance.gov.in</li>
                  <li className="flex items-center gap-2"><ArrowRight className="h-3 w-3 text-sky-500" />Test login with admin credentials</li>
                  <li className="flex items-center gap-2"><ArrowRight className="h-3 w-3 text-sky-500" />Run pm2 logs to check for errors</li>
                  <li className="flex items-center gap-2"><ArrowRight className="h-3 w-3 text-sky-500" />Verify SSL certificate with ssllabs.com</li>
                  <li className="flex items-center gap-2"><ArrowRight className="h-3 w-3 text-sky-500" />Set up cron for certbot auto-renewal</li>
                </ul>
              </div>
            </div>
          </TabsContent>
        </Tabs>
      </motion.div>

      <Separator />

      {/* ═══ 5. n8n Setup Guide ═══ */}
      <motion.div initial={{ opacity: 0, y: 12 }} animate={{ opacity: 1, y: 0 }} transition={{ duration: 0.4, delay: 0.3 }}>
        <SectionHeader icon={Code} title="n8n Setup Guide" description="Step-by-step workflow automation configuration for grievance intake" delay={0.3} />
        <Card className="border-0 shadow-sm mt-3">
          <CardContent className="p-5 pt-4">
            <div className="space-y-0">
              <StepCard step={1} title="Install n8n via Docker" description="Pull and run the official n8n Docker image with persistent data volume." code="docker run -d --restart unless-stopped --name n8n -p 5678:5678 -v n8n_data:/home/node/.n8n docker.n8n.io/n8nio/n8n" />
              <StepCard step={2} title="Access n8n Dashboard" description="Open the n8n editor in your browser and create an admin account." code="http://your-server:5678" />
              <StepCard step={3} title="Create a New Workflow" description="Click &quot;New Workflow&quot; and name it &quot;WB Grievance Intake&quot;." />
              <StepCard step={4} title="Add Webhook Trigger Node" description="Configure a POST webhook at /webhook/grievance. Set authentication to &quot;Header Auth&quot; using the N8N_API_KEY." />
              <StepCard step={5} title="Add Function Node to Format Data" description="Transform incoming citizen complaint data into the format expected by the API. Map fields: issue, category, citizenName, phone, block, district." />
              <StepCard step={6} title="Add HTTP Request Node" description="Configure an HTTP POST request to your Next.js API endpoint with the formatted payload." code={`POST https://wb-grievance.gov.in/api/webhook/complaint
Headers:
  Authorization: Bearer \${N8N_API_KEY}
  Content-Type: application/json
Body: { formatted complaint data }`} />
              <StepCard step={7} title="Add WhatsApp/SMS Notification Node" description="Use the Twilio node or WhatsApp Business API node to send a confirmation message to the citizen with their ticket number." />
              <StepCard step={8} title="Activate the Workflow" description="Click the toggle switch in the top-right to activate the workflow. The webhook URL will be generated." />
              <StepCard step={9} title="Test with Sample Data" description="Send a test POST request to the webhook URL and verify the complaint appears in the portal." code={`curl -X POST https://your-n8n-instance.com/webhook/grievance \\
  -H "Content-Type: application/json" \\
  -d '{
    "citizenName": "Test Citizen",
    "phone": "+919876543210",
    "issue": "Water supply disruption in my area",
    "category": "Water Supply",
    "block": "Krishnanagar-I",
    "district": "Nadia"
  }'`} />
            </div>
          </CardContent>
        </Card>
      </motion.div>

      <Separator />

      {/* ═══ 6. Security Hardening Checklist ═══ */}
      <motion.div initial={{ opacity: 0, y: 12 }} animate={{ opacity: 1, y: 0 }} transition={{ duration: 0.4, delay: 0.35 }}>
        <SectionHeader icon={Shield} title="Security Hardening Checklist" description="Essential security measures for a government-facing application" delay={0.35} />
        <Card className="border-0 shadow-sm mt-3">
          <CardContent className="p-4">
            <div className="grid grid-cols-1 md:grid-cols-2 gap-2.5">
              {securityItems.map((item) => (
                <SecurityItem key={item.label} {...item} />
              ))}
            </div>
          </CardContent>
        </Card>
      </motion.div>

      <Separator />

      {/* ═══ 7. Monitoring & Maintenance ═══ */}
      <motion.div initial={{ opacity: 0, y: 12 }} animate={{ opacity: 1, y: 0 }} transition={{ duration: 0.4, delay: 0.4 }}>
        <SectionHeader icon={Eye} title="Monitoring & Maintenance" description="Ensure system reliability with proper monitoring and maintenance procedures" delay={0.4} />
        <div className="grid grid-cols-1 md:grid-cols-2 gap-3 mt-3">
          {monitoringItems.map((item) => (
            <MonitoringItem key={item.title} {...item} />
          ))}
        </div>
      </motion.div>

      {/* ═══ Final Footer Note ═══ */}
      <motion.div initial={{ opacity: 0, y: 12 }} animate={{ opacity: 1, y: 0 }} transition={{ duration: 0.4, delay: 0.45 }}>
        <Card className="border-0 shadow-sm" style={{ background: `linear-gradient(135deg, ${NAVY}08, ${NAVY}04)` }}>
          <CardContent className="p-5">
            <div className="flex items-start gap-3">
              <div className="flex items-center justify-center rounded-xl p-2.5 shrink-0" style={{ backgroundColor: `${NAVY}15` }}>
                <FileText className="h-5 w-5" style={{ color: NAVY }} />
              </div>
              <div>
                <h4 className="text-sm font-bold text-foreground">Need Help?</h4>
                <p className="text-xs text-muted-foreground mt-1 leading-relaxed">
                  Contact the WB Grievance Portal technical team at{' '}
                  <span className="font-semibold text-foreground">support@wb-grievance.gov.in</span> or raise a ticket
                  in the internal support channel. For urgent production issues, use the on-call rotation at{' '}
                  <span className="font-semibold text-foreground">+91-33-XXXX-XXXX</span>.
                </p>
                <div className="flex items-center gap-2 mt-3">
                  <Button size="sm" className="h-8 text-xs gap-1.5" style={{ backgroundColor: NAVY, color: 'white' }}>
                    <ExternalLink className="h-3.5 w-3.5" /> View Architecture Docs
                  </Button>
                  <Button size="sm" variant="outline" className="h-8 text-xs gap-1.5">
                    <FileText className="h-3.5 w-3.5" /> Download as PDF
                  </Button>
                </div>
              </div>
            </div>
          </CardContent>
        </Card>
      </motion.div>
    </div>
  );
}

// ─── Inline info icon (used in Docker tab) ───
function InfoIcon({ className }: { className?: string }) {
  return (
    <svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" className={className}>
      <circle cx="12" cy="12" r="10" />
      <path d="M12 16v-4" />
      <path d="M12 8h.01" />
    </svg>
  );
}
