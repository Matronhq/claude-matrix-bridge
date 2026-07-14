import { describe, it, expect } from 'vitest';
import { parseUsageLimits, parseResetsAt, formatLimits } from '../lib/usage-limits.js';

// Real `claude -p "/usage" --output-format text` output (subscription account).
// Note the middot separator (·) is the literal character Claude Code emits.
const SUBSCRIPTION_SAMPLE = `You are currently using your subscription to power your Claude Code usage

Current session: 39% used · resets Jul 9, 12:59am (UTC)
Current week (all models): 66% used · resets Jul 12, 6:59pm (UTC)
Current week (Fable): 100% used · resets Jul 12, 6:59pm (UTC)

What's contributing to your limits usage?
Approximate, based on local sessions on this machine — does not include other devices or claude.ai.

Last 24h · 1732 requests · 3 sessions
  74% of your usage was at >150k context
`;

// Real output from the same command after claude switched the reset text to
// "at" + the machine's IANA zone (captured 2026-07-14 on a Europe/London
// machine, during BST = UTC+1).
const LOCAL_ZONE_SAMPLE = `You are currently using your subscription to power your Claude Code usage

Current session: 23% used · resets Jul 15 at 12:19am (Europe/London)
Current week (all models): 13% used · resets Jul 20 at 9:59pm (Europe/London)
Current week (Fable): 21% used · resets Jul 20 at 9:59pm (Europe/London)

What's contributing to your limits usage?
Approximate, based on local sessions on this machine — does not include other devices or claude.ai.
`;

const GREEN = '#3fb950';
const ORANGE = '#f0883e';
const RED = '#f85149';

describe('parseUsageLimits', () => {
  it('extracts the Current session / week headline lines', () => {
    const { ok, lines } = parseUsageLimits(SUBSCRIPTION_SAMPLE, new Date('2026-07-08T00:00:00Z'));
    expect(ok).toBe(true);
    expect(lines).toEqual([
      { label: 'Session', percent: 39, resets: 'Jul 9, 12:59am (UTC)', resets_at: '2026-07-09T00:59:00.000Z' },
      { label: 'Week (all models)', percent: 66, resets: 'Jul 12, 6:59pm (UTC)', resets_at: '2026-07-12T18:59:00.000Z' },
      { label: 'Week (Fable)', percent: 100, resets: 'Jul 12, 6:59pm (UTC)', resets_at: '2026-07-12T18:59:00.000Z' },
    ]);
  });

  it('does not include the intro line or the "what\'s contributing" breakdown', () => {
    const { lines } = parseUsageLimits(SUBSCRIPTION_SAMPLE);
    expect(lines).toHaveLength(3);
    for (const l of lines) {
      expect(l.label).not.toMatch(/contributing|requests|subscription/i);
    }
  });

  it('reports ok:false with no lines when nothing matches', () => {
    const { ok, lines } = parseUsageLimits('Some unrelated output about an API key.\nNo limits here.');
    expect(ok).toBe(false);
    expect(lines).toEqual([]);
  });

  it('handles empty / nullish input without throwing', () => {
    expect(parseUsageLimits('')).toEqual({ ok: false, lines: [] });
    expect(parseUsageLimits(null)).toEqual({ ok: false, lines: [] });
    expect(parseUsageLimits(undefined)).toEqual({ ok: false, lines: [] });
  });

  it('adds resets_at to lines when the reset text parses', () => {
    const { lines } = parseUsageLimits(SUBSCRIPTION_SAMPLE, new Date('2026-07-08T00:00:00Z'));
    expect(lines.map((l) => l.resets_at)).toEqual([
      '2026-07-09T00:59:00.000Z',
      '2026-07-12T18:59:00.000Z',
      '2026-07-12T18:59:00.000Z',
    ]);
  });

  it('omits resets_at when the reset text does not parse', () => {
    const { lines } = parseUsageLimits('Current session: 39% used · resets soon\n');
    expect(lines).toHaveLength(1);
    expect('resets_at' in lines[0]).toBe(false);
  });

  it('parses the "at" + local IANA zone format to UTC timestamps', () => {
    const { ok, lines } = parseUsageLimits(LOCAL_ZONE_SAMPLE, new Date('2026-07-14T22:00:00Z'));
    expect(ok).toBe(true);
    expect(lines).toEqual([
      // BST is UTC+1: 12:19am Jul 15 London = 11:19pm Jul 14 UTC.
      { label: 'Session', percent: 23, resets: 'Jul 15 at 12:19am (Europe/London)', resets_at: '2026-07-14T23:19:00.000Z' },
      { label: 'Week (all models)', percent: 13, resets: 'Jul 20 at 9:59pm (Europe/London)', resets_at: '2026-07-20T20:59:00.000Z' },
      { label: 'Week (Fable)', percent: 21, resets: 'Jul 20 at 9:59pm (Europe/London)', resets_at: '2026-07-20T20:59:00.000Z' },
    ]);
  });
});

describe('parseResetsAt', () => {
  const now = new Date('2026-07-08T00:00:00Z');

  it('parses an am time to a UTC ISO timestamp', () => {
    expect(parseResetsAt('Jul 9, 12:59am (UTC)', now)).toBe('2026-07-09T00:59:00.000Z');
  });

  it('parses a pm time', () => {
    expect(parseResetsAt('Jul 12, 6:59pm (UTC)', now)).toBe('2026-07-12T18:59:00.000Z');
  });

  it('rolls to next year when the month/day is far in the past', () => {
    expect(parseResetsAt('Jan 2, 3:00am (UTC)', new Date('2026-12-30T00:00:00Z')))
      .toBe('2027-01-02T03:00:00.000Z');
  });

  it('keeps a reset less than 24h in the past in the current year', () => {
    expect(parseResetsAt('Jul 9, 12:59am (UTC)', new Date('2026-07-09T06:00:00Z')))
      .toBe('2026-07-09T00:59:00.000Z');
  });

  it('returns null on unparseable input', () => {
    expect(parseResetsAt('soon', now)).toBeNull();
    expect(parseResetsAt('', now)).toBeNull();
    expect(parseResetsAt(null, now)).toBeNull();
    expect(parseResetsAt('Julember 9, 12:59am (UTC)', now)).toBeNull();
    expect(parseResetsAt('Jul 9, 12:59am (PST)', now)).toBeNull();
  });

  it('fails open on stale mid-year text more than 24h in the past', () => {
    expect(parseResetsAt('Jul 9, 12:59am (UTC)', new Date('2026-08-15T00:00:00Z')))
      .toBeNull();
  });

  it('still rolls Dec->Jan when the reset is imminent', () => {
    expect(parseResetsAt('Jan 1, 12:59am (UTC)', new Date('2026-12-31T12:00:00Z')))
      .toBe('2027-01-01T00:59:00.000Z');
  });

  it('parses a previous-year date just past midnight within tolerance', () => {
    expect(parseResetsAt('Dec 31, 11:59pm (UTC)', new Date('2027-01-01T06:00:00Z')))
      .toBe('2026-12-31T23:59:00.000Z');
  });

  it('fails open when the date is beyond the 8-day future horizon', () => {
    expect(parseResetsAt('Jul 20, 12:00pm (UTC)', new Date('2026-07-01T00:00:00Z')))
      .toBeNull();
  });

  it('parses the "at" separator with a UTC zone', () => {
    expect(parseResetsAt('Jul 9 at 12:59am (UTC)', now)).toBe('2026-07-09T00:59:00.000Z');
  });

  it('converts a summer-time IANA zone to UTC (BST = UTC+1)', () => {
    expect(parseResetsAt('Jul 15 at 12:19am (Europe/London)', new Date('2026-07-14T22:00:00Z')))
      .toBe('2026-07-14T23:19:00.000Z');
  });

  it('converts the same zone in winter without the DST offset (GMT)', () => {
    expect(parseResetsAt('Jan 10 at 3:00pm (Europe/London)', new Date('2027-01-10T00:00:00Z')))
      .toBe('2027-01-10T15:00:00.000Z');
  });

  it('converts a US zone across the date line to the right UTC day', () => {
    // EDT is UTC-4: 12:19am Jul 15 New York = 4:19am Jul 15 UTC.
    expect(parseResetsAt('Jul 15 at 12:19am (America/New_York)', new Date('2026-07-14T22:00:00Z')))
      .toBe('2026-07-15T04:19:00.000Z');
  });

  it('rolls the year correctly for a zoned Dec->Jan reset', () => {
    // GMT in winter: 12:59am Jan 1 London = 12:59am Jan 1 UTC, next year.
    expect(parseResetsAt('Jan 1 at 12:59am (Europe/London)', new Date('2026-12-31T12:00:00Z')))
      .toBe('2027-01-01T00:59:00.000Z');
  });

  it('fails open on zone names Intl rejects or legacy abbreviations', () => {
    expect(parseResetsAt('Jul 9 at 12:59am (Not/AZone)', now)).toBeNull();
    expect(parseResetsAt('Jul 9 at 12:59am (BST)', now)).toBeNull();
  });
});

describe('formatLimits', () => {
  it('produces a plain-text headline block', () => {
    const parsed = parseUsageLimits(SUBSCRIPTION_SAMPLE);
    const { plain } = formatLimits(parsed, SUBSCRIPTION_SAMPLE);
    expect(plain).toContain('Subscription Usage');
    expect(plain).toContain('Session: 39% · resets Jul 9, 12:59am (UTC)');
    expect(plain).toContain('Week (all models): 66% · resets Jul 12, 6:59pm (UTC)');
    expect(plain).toContain('Week (Fable): 100% · resets Jul 12, 6:59pm (UTC)');
    // The breakdown must not leak into the formatted output.
    expect(plain).not.toContain('requests');
  });

  it('color-codes percentages by threshold in HTML', () => {
    const parsed = parseUsageLimits(SUBSCRIPTION_SAMPLE);
    const { html } = formatLimits(parsed, SUBSCRIPTION_SAMPLE);
    expect(html).toContain(`<font color="${GREEN}">39%</font>`);   // < 50
    expect(html).toContain(`<font color="${ORANGE}">66%</font>`);  // < 80
    expect(html).toContain(`<font color="${RED}">100%</font>`);    // >= 80
  });

  it('maps threshold boundaries to the right colors', () => {
    const mk = (percent) => formatLimits(
      { ok: true, lines: [{ label: 'Session', percent, resets: 'soon' }] },
      '',
    ).html;
    expect(mk(49)).toContain(`<font color="${GREEN}">49%</font>`);
    expect(mk(50)).toContain(`<font color="${ORANGE}">50%</font>`);
    expect(mk(79)).toContain(`<font color="${ORANGE}">79%</font>`);
    expect(mk(80)).toContain(`<font color="${RED}">80%</font>`);
  });

  it('falls back to the raw text when parsing found nothing', () => {
    const raw = 'Login required. Run `claude` to authenticate.';
    const parsed = parseUsageLimits(raw);
    const { plain, html } = formatLimits(parsed, raw);
    expect(plain).toContain('Login required');
    expect(html).toContain('Login required');
  });

  it('escapes HTML-special characters in the fallback', () => {
    const raw = 'error: <bad> & "stuff"';
    const { html } = formatLimits(parseUsageLimits(raw), raw);
    expect(html).toContain('&lt;bad&gt;');
    expect(html).toContain('&amp;');
    expect(html).toContain('&quot;stuff&quot;');
    expect(html).not.toContain('<bad>');
    expect(html).not.toContain('"stuff"');
  });

  it('escapes double quotes in parsed labels and reset times', () => {
    const { html } = formatLimits(
      { ok: true, lines: [{ label: 'week ("all" models)', percent: 10, resets: 'Jul 9, "noon"' }] },
      '',
    );
    expect(html).toContain('week (&quot;all&quot; models)');
    expect(html).toContain('Jul 9, &quot;noon&quot;');
  });
});
