import { NextRequest, NextResponse } from 'next/server';
import { db } from '@/lib/db';

// ── Types ────────────────────────────────────────────────────────────────────

interface BulkCategorizeRequest {
  complaintIds: string[];
}

interface AIResult {
  complaintId: string;
  ticketNo: string;
  category: string;
  urgency: string;
  confidence: number;
  sentiment: string;
  department: string;
}

// ── Mock AI Categories ────────────────────────────────────────────────────────

const CATEGORIES = [
  'Water Supply', 'Road Damage', 'Electricity', 'Healthcare',
  'Education', 'Sanitation', 'Public Transport', 'Street Lighting',
];

const URGENCIES = ['LOW', 'MEDIUM', 'HIGH', 'CRITICAL'];

const DEPARTMENTS: Record<string, string> = {
  'Water Supply': 'PHE',
  'Road Damage': 'PWD',
  'Electricity': 'WBSEDCL',
  'Healthcare': 'Health Dept',
  'Education': 'Education Dept',
  'Sanitation': 'Municipal',
  'Public Transport': 'Transport Dept',
  'Street Lighting': 'Municipal',
};

function mockAIAnalysis(): Omit<AIResult, 'complaintId' | 'ticketNo'> {
  const category = CATEGORIES[Math.floor(Math.random() * CATEGORIES.length)];
  const urgency = URGENCIES[Math.floor(Math.random() * URGENCIES.length)];
  const confidence = Math.floor(85 + Math.random() * 14);
  const sentiment = Math.random() > 0.3 ? 'NEGATIVE' : 'NEUTRAL';
  return {
    category,
    urgency,
    confidence,
    sentiment,
    department: DEPARTMENTS[category] || 'General',
  };
}

// ── Route Handler ────────────────────────────────────────────────────────────

export async function POST(request: NextRequest) {
  try {
    const body: BulkCategorizeRequest = await request.json();

    if (!body.complaintIds || !Array.isArray(body.complaintIds) || body.complaintIds.length === 0) {
      return NextResponse.json(
        { error: 'complaintIds array is required and must not be empty' },
        { status: 400 },
      );
    }

    if (body.complaintIds.length > 50) {
      return NextResponse.json(
        { error: 'Maximum 50 complaints can be analyzed at once' },
        { status: 400 },
      );
    }

    // Fetch complaints from DB
    const complaints = await db.complaint.findMany({
      where: { id: { in: body.complaintIds } },
      select: {
        id: true,
        ticketNo: true,
        issue: true,
        category: true,
        urgency: true,
      },
    });

    if (complaints.length === 0) {
      return NextResponse.json(
        { error: 'No complaints found with the provided IDs' },
        { status: 404 },
      );
    }

    // Simulate AI analysis for each complaint with a 15-second timeout per complaint
    const results: AIResult[] = [];

    for (const complaint of complaints) {
      const analysis = await Promise.race([
        Promise.resolve(mockAIAnalysis()),
        new Promise<never>((_, reject) =>
          setTimeout(() => reject(new Error('Analysis timed out')), 15_000),
        ),
      ]);

      results.push({
        complaintId: complaint.id,
        ticketNo: complaint.ticketNo,
        ...analysis,
      });
    }

    // Optionally update complaints in DB with new category/urgency
    // For now, just return the analysis results
    // In production, you would call the LLM here and update:
    // await db.complaint.updateMany({ ... })

    return NextResponse.json({
      success: true,
      analyzed: results.length,
      results,
    });
  } catch (error) {
    const message = error instanceof Error ? error.message : 'Unknown error';
    console.error('[AI Bulk Categorize] Error:', message);

    return NextResponse.json(
      { error: 'Bulk AI categorization failed', details: message },
      { status: 500 },
    );
  }
}
