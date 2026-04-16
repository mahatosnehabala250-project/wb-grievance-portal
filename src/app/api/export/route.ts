import { NextRequest, NextResponse } from 'next/server';
import { db } from '@/lib/db';
import { verifyToken } from '@/lib/jwt';

// GET /api/export?format=csv&status=xxx&token=xxx — export complaints as CSV
export async function GET(request: NextRequest) {
  // Auth via query param token (since window.open can't set headers)
  const { searchParams } = new URL(request.url);
  const token = searchParams.get('token');
  if (!token) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });

  const payload = await verifyToken(token);
  if (!payload) return NextResponse.json({ error: 'Invalid token' }, { status: 401 });

  const format = searchParams.get('format') || 'csv';
  const status = searchParams.get('status');

  if (format !== 'csv') {
    return NextResponse.json({ error: 'Only CSV format is supported' }, { status: 400 });
  }

  // Build where clause based on role
  const where: Record<string, unknown> = {};

  if (payload.role === 'BLOCK') {
    where.block = payload.block;
  } else if (payload.role === 'DISTRICT') {
    where.district = payload.block;
  }

  if (status) where.status = status;

  try {
    const complaints = await db.complaint.findMany({
      where,
      orderBy: { createdAt: 'desc' },
    });

    // Build CSV
    const headers = ['Ticket #', 'Citizen Name', 'Phone', 'Issue', 'Category', 'Block', 'District', 'Urgency', 'Status', 'Source', 'Created At', 'Assigned'];
    const rows = complaints.map((c) => [
      c.ticketNo,
      c.citizenName || '',
      c.phone || '',
      c.issue,
      c.category,
      c.block,
      c.district,
      c.urgency,
      c.status,
      c.source,
      new Date(c.createdAt).toLocaleDateString('en-IN', { day: '2-digit', month: 'short', year: 'numeric' }),
      c.assignedToId ? 'Yes' : 'No',
    ]);

    const csvContent = [
      headers.map((h) => `"${h}"`).join(','),
      ...rows.map((r) => r.map((v) => `"${String(v).replace(/"/g, '""')}"`).join(',')),
    ].join('\n');

    const filename = `wb-complaints-export-${new Date().toISOString().split('T')[0]}.csv`;

    return new NextResponse(csvContent, {
      headers: {
        'Content-Type': 'text/csv; charset=utf-8',
        'Content-Disposition': `attachment; filename="${filename}"`,
      },
    });
  } catch (error) {
    console.error('Export error:', error);
    return NextResponse.json({ error: 'Export failed' }, { status: 500 });
  }
}
