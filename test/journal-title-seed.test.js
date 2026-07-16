import { describe, it, expect, vi } from 'vitest';
import { seedJournalTitle } from '../lib/journal-title-seed.js';

describe('seedJournalTitle (workdir-sourced)', () => {
  it('titles the convo from the workdir basename when no hint is set', async () => {
    const session = { _journalTitleHint: undefined };
    const upsertConvo = vi.fn();
    const ok = await seedJournalTitle(session, { workdir: '/home/dan/yearbook-app', upsertConvo, warn: () => {} });
    expect(ok).toBe(true);
    expect(upsertConvo).toHaveBeenCalledWith(session, { title: expect.stringContaining('yearbook-app') });
  });

  it('does not overwrite an existing title hint', async () => {
    const session = { _journalTitleHint: 'kept' };
    const upsertConvo = vi.fn();
    await seedJournalTitle(session, { workdir: '/tmp/x', upsertConvo, warn: () => {} });
    expect(upsertConvo).not.toHaveBeenCalled();
  });

  // Restart/resume: the good Gemini title lived on the OLD session object and
  // is handed in as incomingHint. The fresh session must adopt it BEFORE any
  // publish — otherwise the workdir seed publishes the bare repo name and the
  // journal's COALESCE upsert clobbers the good title on the server (the
  // title-revert bug). Adopting silently (no upsert) is the fix: the title
  // already exists server-side, so there is nothing to publish.
  it('adopts an incoming hint onto a fresh session without publishing', async () => {
    const session = { _journalTitleHint: undefined };
    const upsertConvo = vi.fn();
    const ok = await seedJournalTitle(session, {
      workdir: '/home/dan/yearbook-app',
      incomingHint: 'mac:a1b2 Fix the photo upload race',
      upsertConvo,
      warn: () => {},
    });
    expect(ok).toBe(false);
    expect(upsertConvo).not.toHaveBeenCalled();
    expect(session._journalTitleHint).toBe('mac:a1b2 Fix the photo upload race');
  });

  it('never seeds the workdir name when reattaching to an existing convo', async () => {
    // Reattach paths (/restart, /model, /mode, resume-after-bridge-restart)
    // pass journalConvoId. The convo already exists server-side with whatever
    // title it earned; even with no in-memory hint, seeding the repo basename
    // here would clobber that title via COALESCE. Only a brand-new convo seeds.
    const session = { _journalTitleHint: undefined };
    const upsertConvo = vi.fn();
    const ok = await seedJournalTitle(session, {
      workdir: '/home/dan/yearbook-app',
      reattaching: true,
      upsertConvo,
      warn: () => {},
    });
    expect(ok).toBe(false);
    expect(upsertConvo).not.toHaveBeenCalled();
  });

  it('still seeds the workdir name for a brand-new convo (not reattaching)', async () => {
    const session = { _journalTitleHint: undefined };
    const upsertConvo = vi.fn();
    const ok = await seedJournalTitle(session, {
      workdir: '/home/dan/yearbook-app',
      reattaching: false,
      upsertConvo,
      warn: () => {},
    });
    expect(ok).toBe(true);
    expect(upsertConvo).toHaveBeenCalledWith(session, { title: expect.stringContaining('yearbook-app') });
  });

  it('an empty-string incoming hint is a real title and is still adopted silently', async () => {
    // undefined means "no prior title"; '' is a title the user/agent chose.
    // Only undefined should fall through to the workdir seed.
    const session = { _journalTitleHint: undefined };
    const upsertConvo = vi.fn();
    const ok = await seedJournalTitle(session, {
      workdir: '/home/dan/yearbook-app',
      incomingHint: '',
      upsertConvo,
      warn: () => {},
    });
    expect(ok).toBe(false);
    expect(upsertConvo).not.toHaveBeenCalled();
    expect(session._journalTitleHint).toBe('');
  });
});
