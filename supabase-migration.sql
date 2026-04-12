-- ============================================
-- West Bengal Grievance Portal - Supabase Migration
-- Run this in Supabase Dashboard → SQL Editor → New Query
-- ============================================

-- Enable UUID extension
CREATE EXTENSION IF NOT EXISTS "pgcrypto";

-- 1. Users Table
CREATE TABLE IF NOT EXISTS users (
  id TEXT PRIMARY KEY DEFAULT gen_random_uuid()::text,
  username TEXT UNIQUE NOT NULL,
  "passwordHash" TEXT NOT NULL,
  role TEXT NOT NULL DEFAULT 'BLOCK',
  name TEXT NOT NULL,
  location TEXT NOT NULL,
  district TEXT,
  "isActive" BOOLEAN NOT NULL DEFAULT true,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP
);

-- 2. Complaints Table
CREATE TABLE IF NOT EXISTS complaints (
  id TEXT PRIMARY KEY DEFAULT gen_random_uuid()::text,
  "ticketNo" TEXT UNIQUE NOT NULL,
  "citizenName" TEXT,
  phone TEXT,
  issue TEXT NOT NULL,
  category TEXT NOT NULL,
  block TEXT NOT NULL,
  district TEXT NOT NULL,
  urgency TEXT NOT NULL DEFAULT 'MEDIUM',
  status TEXT NOT NULL DEFAULT 'OPEN',
  description TEXT,
  resolution TEXT,
  "assignedToId" TEXT,
  source TEXT NOT NULL DEFAULT 'WHATSAPP',
  "satisfactionRating" INTEGER,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP
);

-- 3. Activity Logs Table
CREATE TABLE IF NOT EXISTS activity_logs (
  id TEXT PRIMARY KEY DEFAULT gen_random_uuid()::text,
  "complaintId" TEXT NOT NULL REFERENCES complaints(id) ON DELETE CASCADE,
  action TEXT NOT NULL,
  description TEXT NOT NULL,
  "actorId" TEXT,
  "actorName" TEXT,
  metadata TEXT,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP
);

-- 4. Comments Table
CREATE TABLE IF NOT EXISTS comments (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  "complaintId" TEXT NOT NULL REFERENCES complaints(id) ON DELETE CASCADE,
  content TEXT NOT NULL,
  "actorId" TEXT,
  "actorName" TEXT,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP
);

-- 5. Feedback Table
CREATE TABLE IF NOT EXISTS feedback (
  id TEXT PRIMARY KEY DEFAULT gen_random_uuid()::text,
  name TEXT NOT NULL,
  email TEXT,
  message TEXT NOT NULL,
  category TEXT NOT NULL DEFAULT 'General',
  rating INTEGER NOT NULL DEFAULT 5,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP
);

-- Indexes for performance
CREATE INDEX IF NOT EXISTS idx_complaints_district ON complaints(district);
CREATE INDEX IF NOT EXISTS idx_complaints_block ON complaints(block);
CREATE INDEX IF NOT EXISTS idx_complaints_status ON complaints(status);
CREATE INDEX IF NOT EXISTS idx_complaints_urgency ON complaints(urgency);
CREATE INDEX IF NOT EXISTS idx_complaints_category ON complaints(category);
CREATE INDEX IF NOT EXISTS idx_complaints_createdAt ON complaints("createdAt");
CREATE INDEX IF NOT EXISTS idx_activity_logs_complaintId ON activity_logs("complaintId");
CREATE INDEX IF NOT EXISTS idx_activity_logs_createdAt ON activity_logs("createdAt");
CREATE INDEX IF NOT EXISTS idx_comments_complaintId ON comments("complaintId");

-- Auto-update updatedAt trigger
CREATE OR REPLACE FUNCTION update_updated_at_column()
RETURNS TRIGGER AS $$
BEGIN
  NEW."updatedAt" = CURRENT_TIMESTAMP;
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

CREATE TRIGGER users_updated_at BEFORE UPDATE ON users
  FOR EACH ROW EXECUTE FUNCTION update_updated_at_column();

CREATE TRIGGER complaints_updated_at BEFORE UPDATE ON complaints
  FOR EACH ROW EXECUTE FUNCTION update_updated_at_column();

-- Enable Row Level Security (optional - can be disabled for simplicity)
ALTER TABLE users ENABLE ROW LEVEL SECURITY;
ALTER TABLE complaints ENABLE ROW LEVEL SECURITY;
ALTER TABLE activity_logs ENABLE ROW LEVEL SECURITY;
ALTER TABLE comments ENABLE ROW LEVEL SECURITY;
ALTER TABLE feedback ENABLE ROW LEVEL SECURITY;

-- Allow service_role to bypass RLS (for backend API)
CREATE POLICY "Service role bypass" ON users FOR ALL USING (true) WITH CHECK (true);
CREATE POLICY "Service role bypass" ON complaints FOR ALL USING (true) WITH CHECK (true);
CREATE POLICY "Service role bypass" ON activity_logs FOR ALL USING (true) WITH CHECK (true);
CREATE POLICY "Service role bypass" ON comments FOR ALL USING (true) WITH CHECK (true);
CREATE POLICY "Service role bypass" ON feedback FOR ALL USING (true) WITH CHECK (true);

-- Success message
SELECT '✅ All tables created successfully!' AS status;
