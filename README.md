# 🏛️ West Bengal AI Public Support System

> A comprehensive, full-stack government grievance management portal for the State of West Bengal, India. Built with Next.js 16, React 19, TypeScript, Prisma, and Tailwind CSS.

![Next.js](https://img.shields.io/badge/Next.js-16-black?logo=next.js)
![TypeScript](https://img.shields.io/badge/TypeScript-5-blue?logo=typescript)
![Prisma](https://img.shields.io/badge/Prisma-ORM-2D3748?logo=prisma)
![Tailwind CSS](https://img.shields.io/badge/Tailwind_CSS-4-06B6D4?logo=tailwindcss)
![License](https://img.shields.io/badge/License-MIT-green)

---

## 🌟 Features

### Core Functionality
- **Complaint Management** — Full CRUD with status tracking (Open → In Progress → Resolved/Rejected)
- **Multi-Level Role System** — 4 roles: Admin, State, District, Block with role-based data access
- **SLA Monitoring** — 48-hour SLA tracking with breach indicators and complaint aging
- **Escalation Workflow** — Automatic urgency escalation (LOW → MEDIUM → HIGH → CRITICAL)
- **Bulk Actions** — Select multiple complaints and update status in bulk
- **Internal Notes** — Per-complaint notes for inter-department communication
- **Activity Timeline** — Full audit trail for every complaint action

### Dashboard & Analytics
- **Role-Based Dashboards** — KPIs, charts, and metrics tailored to each user role
- **Resolution Rate Ring** — Animated circular progress indicator
- **Complaint Volume Trends** — Area charts with gradient fills
- **District/Block Comparison** — Sortable performance tables
- **Date Range Filters** — Today, This Week, This Month, Last 30/90 Days, All Time
- **Auto-Refresh** — 60-second dashboard data refresh with toggle

### User Experience
- **Command Palette** — Ctrl+K global search for complaints, users, and navigation
- **Keyboard Shortcuts** — 8 shortcuts for quick navigation (D, C, A, N, R, T, ?, Esc)
- **Dark Mode** — Light/Dark/System theme toggle
- **Mobile Responsive** — Bottom navigation, card layouts, touch-friendly design
- **Print/Export** — Generate dashboard reports via browser print
- **Session Timeout** — 30-minute inactivity auto-logout with 25-minute warning

### Integrations
- **n8n Webhook** — POST `/api/webhook/complaint` for automated complaint intake
- **Airtable Sync** — Bi-directional sync with Airtable for external data management
- **Public Status Page** — Citizens can track complaints by ticket number

### Admin Tools
- **User Management** — Create, activate/deactivate users, reset passwords
- **Audit Log** — Complete system action log for accountability
- **Announcements** — Broadcast messages to all users
- **Feedback System** — User satisfaction collection

---

## 🚀 Getting Started

### Prerequisites
- **Node.js** 18+ or **Bun** 1.0+
- **npm** or **bun** package manager

### Installation

```bash
# Clone the repository
git clone https://github.com/YOUR_USERNAME/wb-grievance-portal.git
cd wb-grievance-portal

# Install dependencies
bun install
# or: npm install

# Copy environment file
cp .env.example .env
# Edit .env and set your JWT_SECRET

# Set up database
bun run db:push
bun run db:seed

# Start development server
bun run dev
```

The application will be available at **http://localhost:3000**

### Test Credentials

| Role | Username | Password |
|------|----------|----------|
| **Admin** | admin | admin123 |
| **State** | state_wb | state123 |
| **District (Nadia)** | district_nadia | nadia123 |
| **Block (Krishnanagar)** | block_krishnanagar | krish123 |

---

## 📁 Project Structure

```
wb-grievance-portal/
├── prisma/
│   ├── schema.prisma      # Database models (User, Complaint, ActivityLog, Feedback, Comment)
│   └── seed.ts             # Seed data (12 users, 174 complaints)
├── src/
│   ├── app/
│   │   ├── page.tsx        # Main app shell (login + all views)
│   │   ├── layout.tsx      # Root layout with ThemeProvider
│   │   ├── globals.css     # Global styles + 20+ custom animations
│   │   └── api/
│   │       ├── auth/       # Login, session verification
│   │       ├── complaints/ # CRUD, bulk, escalate, activity, comments
│   │       ├── dashboard/  # Role-based statistics
│   │       ├── search/     # Global search (command palette)
│   │       ├── users/      # User management
│   │       ├── export/     # CSV export
│   │       ├── feedback/   # Feedback collection
│   │       ├── audit-log/  # System audit trail
│   │       ├── leaderboard/# Performance rankings
│   │       ├── webhook/    # n8n webhook receiver
│   │       └── health/     # Health check endpoint
│   ├── components/
│   │   ├── ui/             # shadcn/ui component library
│   │   ├── LoginView.tsx
│   │   ├── DashboardView.tsx
│   │   ├── ComplaintsView.tsx
│   │   ├── ComplaintDetailDialog.tsx
│   │   ├── NewComplaintDialog.tsx
│   │   ├── UserManagementView.tsx
│   │   ├── AnalyticsView.tsx
│   │   ├── AuditLogView.tsx
│   │   ├── SettingsView.tsx
│   │   ├── CommandPalette.tsx
│   │   ├── AnnouncementBanner.tsx
│   │   ├── FeedbackDialog.tsx
│   │   ├── HydrationGate.tsx
│   │   └── common.tsx      # Shared components
│   ├── hooks/              # Custom React hooks
│   └── lib/
│       ├── auth-store.ts   # Zustand auth state
│       ├── jwt.ts          # JWT sign/verify utilities
│       ├── db.ts           # Prisma client
│       ├── types.ts        # TypeScript interfaces
│       ├── constants.ts    # App constants
│       ├── helpers.ts      # Utility functions
│       └── i18n.ts         # Internationalization (EN/BN)
└── mini-services/
    └── notification-service/ # Real-time notification service
```

---

## 🛠️ Tech Stack

| Technology | Purpose |
|-----------|---------|
| **Next.js 16** | React framework with App Router & Turbopack |
| **React 19** | UI component library |
| **TypeScript 5** | Type-safe development |
| **Prisma ORM** | Database modeling & queries |
| **SQLite** | Lightweight embedded database |
| **Tailwind CSS 4** | Utility-first styling |
| **shadcn/ui** | Pre-built UI components |
| **Zustand** | Client-side state management |
| **Framer Motion** | Animations & transitions |
| **Recharts** | Data visualization charts |
| **Lucide Icons** | Icon library |
| **Jose** | JWT authentication |
| **Bcrypt.js** | Password hashing |

---

## 🔌 API Endpoints

| Method | Endpoint | Description |
|--------|----------|-------------|
| POST | `/api/auth/login` | User authentication |
| GET | `/api/auth/me` | Session verification |
| GET | `/api/dashboard` | Dashboard statistics (date range filter) |
| GET | `/api/complaints` | List complaints (paginated, filterable) |
| POST | `/api/complaints` | Create new complaint |
| GET | `/api/complaints/[id]` | Complaint detail |
| PATCH | `/api/complaints/[id]` | Update complaint |
| PATCH | `/api/complaints/[id]/escalate` | Escalate urgency |
| GET | `/api/complaints/[id]/activity` | Activity timeline |
| POST | `/api/complaints/[id]/comments` | Add comment |
| PATCH | `/api/complaints/bulk` | Bulk status update |
| GET | `/api/search?q=` | Global search |
| GET/POST/PATCH | `/api/users` | User management |
| GET | `/api/export` | CSV export |
| POST | `/api/webhook/complaint` | n8n webhook receiver |
| GET | `/api/audit-log` | System audit log |
| GET | `/api/health` | Health check |

---

## 🔐 Security Notes

- **JWT tokens** expire after 24 hours
- **Passwords** are hashed with bcrypt (10 salt rounds)
- **Role-based access control** on all API endpoints
- **Session timeout** — 30-minute inactivity auto-logout
- **SLA monitoring** — Breached complaints are highlighted
- ⚠️ **Change `JWT_SECRET`** in `.env` before production deployment
- ⚠️ **Never commit `.env` files** to version control

---

## 📋 License

This project is licensed under the MIT License.

---

## 🙏 Acknowledgments

Built for the **Government of West Bengal** — Department of Public Grievances.

*পশ্চিমবঙ্গ সরকার — জন অভিযোগ নিষ্পত্তি পোর্টাল*
