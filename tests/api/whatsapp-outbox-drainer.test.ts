// Feature: sahayak-multi-agent-router, Task 26.5 — WhatsApp Outbox Drainer (Req 28.8/28.9, Design §v1.1.9)
//
// Unit tests for the pure `buildOutboundPayload` normalizer exported by the
// outbox-drainer cron route. It maps a stored `whatsapp_outbox.message_body`
// (whose shape is not fully consistent across producers) onto a valid WhatsApp
// Cloud API `messages` payload. The DB-bound drain loop itself needs a live
// Postgres (FOR UPDATE SKIP LOCKED) and is exercised separately.

import { describe, it, expect } from 'vitest';
import { buildOutboundPayload } from '@/app/api/cron/whatsapp-outbox-drainer/route';

const PHONE = '919876543210';

describe('buildOutboundPayload', () => {
  it('always sets the WhatsApp Cloud API envelope fields', () => {
    const payload = buildOutboundPayload(PHONE, { type: 'text', text: 'hi' });
    expect(payload.messaging_product).toBe('whatsapp');
    expect(payload.recipient_type).toBe('individual');
    expect(payload.to).toBe(PHONE);
  });

  it('normalizes the shorthand { type:"text", text:"..." } into text:{ body }', () => {
    // This is exactly the shape /api/handoffs/resolve writes into the outbox.
    const payload = buildOutboundPayload(PHONE, { type: 'text', text: 'Aapka ticket band kar diya gaya hai.' });
    expect(payload).toMatchObject({
      messaging_product: 'whatsapp',
      to: PHONE,
      type: 'text',
      text: { body: 'Aapka ticket band kar diya gaya hai.' },
    });
  });

  it('treats a bare { text: "..." } (no type) as a text message', () => {
    const payload = buildOutboundPayload(PHONE, { text: 'hello' });
    expect(payload.type).toBe('text');
    expect(payload.text).toEqual({ body: 'hello' });
  });

  it('passes through an already-correct text payload unchanged', () => {
    const payload = buildOutboundPayload(PHONE, { type: 'text', text: { body: 'already correct' } });
    expect(payload.text).toEqual({ body: 'already correct' });
  });

  it('preserves non-text message types (e.g. template) as-is', () => {
    const template = { type: 'template', template: { name: 'closing', language: { code: 'hi' } } };
    const payload = buildOutboundPayload(PHONE, template);
    expect(payload.type).toBe('template');
    expect(payload.template).toEqual(template.template);
    // Envelope still applied.
    expect(payload.messaging_product).toBe('whatsapp');
    expect(payload.to).toBe(PHONE);
  });

  it('coerces a primitive / null body into a plain text message', () => {
    expect(buildOutboundPayload(PHONE, null)).toMatchObject({ type: 'text', text: { body: '' } });
    expect(buildOutboundPayload(PHONE, 'raw string')).toMatchObject({ type: 'text', text: { body: 'raw string' } });
  });
});
