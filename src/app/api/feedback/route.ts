import { NextRequest, NextResponse } from 'next/server';
import { db } from '@/lib/db';

// POST /api/feedback — submit citizen feedback
export async function POST(request: NextRequest) {
  try {
    const body = await request.json();
    const { name, email, message, category, rating } = body;

    if (!name || !name.trim()) {
      return NextResponse.json({ error: 'Name is required' }, { status: 400 });
    }

    if (!message || !message.trim()) {
      return NextResponse.json({ error: 'Message is required' }, { status: 400 });
    }

    const validCategories = ['General', 'Bug Report', 'Feature Request', 'Performance', 'UI/UX', 'Other'];
    const feedbackCategory = validCategories.includes(category) ? category : 'General';
    const feedbackRating = Math.min(5, Math.max(1, parseInt(String(rating)) || 5));

    const feedback = await db.feedback.create({
      data: {
        name: name.trim(),
        email: email?.trim() || null,
        message: message.trim(),
        category: feedbackCategory,
        rating: feedbackRating,
      },
    });

    return NextResponse.json({ feedback, success: true }, { status: 201 });
  } catch (error) {
    console.error('Feedback submission error:', error);
    return NextResponse.json({ error: 'Failed to submit feedback' }, { status: 500 });
  }
}
