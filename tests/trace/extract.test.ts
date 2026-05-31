// Feature: sahayak-multi-agent-router, Task 25.2 — Trace-id extraction (Req 27.3, 27.4, Design §v1.1.8)
//
// Unit tests for extractTraceId / withTraceId. Verifies the route-handler
// contract: reuse a valid inbound X-Trace-Id, otherwise mint a fresh uuid7();
// case-insensitive header reads from Request / Headers / plain objects; and
// that withTraceId stamps the canonical header without duplicating it.
//
// Pure-logic tests — no DB, no network.

import { describe, it, expect } from 'vitest';
import {
  extractTraceId,
  extractOrCreateTraceId,
  withTraceId,
} from '../../src/lib/trace/extract';
import { uuid7, isUuid7 } from '../../src/lib/trace/uuid7';

describe('extractTraceId — reuse valid inbound id', () => {
  it('reuses a valid uuid7 from a Request', () => {
    const id = uuid7();
    const req = new Request('https://x/api/foo', {
      headers: { 'X-Trace-Id': id },
    });
    expect(extractTraceId(req)).toBe(id);
  });

  it('reuses a valid uuid7 from a Headers instance', () => {
    const id = uuid7();
    const headers = new Headers({ 'x-trace-id': id });
    expect(extractTraceId(headers)).toBe(id);
  });

  it('reuses a valid uuid7 from a plain object case-insensitively', () => {
    const id = uuid7();
    expect(extractTraceId({ 'X-TRACE-ID': id })).toBe(id);
  });

  it('trims surrounding whitespace before validating', () => {
    const id = uuid7();
    expect(extractTraceId({ 'x-trace-id': `  ${id}  ` })).toBe(id);
  });
});

describe('extractTraceId — mint fresh id on miss/invalid', () => {
  it('generates a fresh uuid7 when the header is absent', () => {
    const req = new Request('https://x/api/foo');
    const out = extractTraceId(req);
    expect(isUuid7(out)).toBe(true);
  });

  it('generates a fresh uuid7 when the header is blank', () => {
    const out = extractTraceId({ 'x-trace-id': '   ' });
    expect(isUuid7(out)).toBe(true);
  });

  it('generates a fresh uuid7 when the header is a UUIDv4 (wrong version)', () => {
    const v4 = 'f47ac10b-58cc-4372-a567-0e02b2c3d479';
    const out = extractTraceId({ 'x-trace-id': v4 });
    expect(out).not.toBe(v4);
    expect(isUuid7(out)).toBe(true);
  });

  it('generates a fresh uuid7 when the header is garbage', () => {
    const out = extractTraceId({ 'x-trace-id': 'not-a-trace-id' });
    expect(isUuid7(out)).toBe(true);
  });

  it('returns distinct ids across repeated misses', () => {
    const a = extractTraceId(new Request('https://x/a'));
    const b = extractTraceId(new Request('https://x/b'));
    expect(a).not.toBe(b);
  });
});

describe('extractOrCreateTraceId — alias parity', () => {
  it('behaves identically to extractTraceId for a valid id', () => {
    const id = uuid7();
    expect(extractOrCreateTraceId({ 'x-trace-id': id })).toBe(id);
  });

  it('mints a uuid7 on miss like extractTraceId', () => {
    expect(isUuid7(extractOrCreateTraceId({}))).toBe(true);
  });
});

describe('withTraceId — outbound propagation', () => {
  it('sets the canonical X-Trace-Id header', () => {
    const id = uuid7();
    expect(withTraceId(undefined, id)).toEqual({ 'X-Trace-Id': id });
  });

  it('preserves other base headers from a plain object', () => {
    const id = uuid7();
    const out = withTraceId({ 'Content-Type': 'application/json' }, id);
    expect(out['Content-Type']).toBe('application/json');
    expect(out['X-Trace-Id']).toBe(id);
  });

  it('drops a pre-existing (differently-cased) trace header to avoid duplicates', () => {
    const id = uuid7();
    const out = withTraceId({ 'x-trace-id': 'stale-old-id' }, id);
    const traceKeys = Object.keys(out).filter(
      (k) => k.toLowerCase() === 'x-trace-id',
    );
    expect(traceKeys).toEqual(['X-Trace-Id']);
    expect(out['X-Trace-Id']).toBe(id);
  });

  it('copies headers from a Headers instance', () => {
    const id = uuid7();
    const base = new Headers({ Authorization: 'Bearer t', 'x-trace-id': 'old' });
    const out = withTraceId(base, id);
    expect(out['authorization'] ?? out['Authorization']).toBe('Bearer t');
    expect(out['X-Trace-Id']).toBe(id);
    expect(out['x-trace-id']).toBeUndefined();
  });

  it('round-trips with extractTraceId (propagation continuity)', () => {
    const id = uuid7();
    const outbound = withTraceId(undefined, id);
    // Simulate the downstream handler reading the propagated header.
    expect(extractTraceId(outbound)).toBe(id);
  });
});
