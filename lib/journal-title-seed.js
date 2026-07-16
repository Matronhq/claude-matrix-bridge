import path from 'path';

// Seed a journal convo title from the session's workdir (basename), unless a
// live title hint already won. Fails open — a title is cosmetic.
//
// `incomingHint` carries the title from this convo's PRIOR life across a
// restart/resume (the good Gemini summary lived on the old session object).
// When present it is adopted onto the fresh session SILENTLY — no upsert —
// because that title already exists server-side. Publishing the workdir
// basename here instead would clobber it via the journal's COALESCE upsert
// (the title-revert bug: a respawn re-seeded the bare repo name over the
// good title). Note `undefined` means "no prior title"; '' is a real,
// deliberately-chosen title and is adopted like any other.
export async function seedJournalTitle(session, { workdir, incomingHint, reattaching = false, upsertConvo, warn = () => {} }) {
  try {
    if (incomingHint !== undefined) {
      session._journalTitleHint = incomingHint;
      return false;
    }
    if (session._journalTitleHint !== undefined) return false;
    // Reattaching to an existing conversation (a journalConvoId was supplied):
    // it already exists server-side with whatever title it earned, so seeding
    // the workdir basename could only clobber it. Only a brand-new convo seeds.
    if (reattaching) return false;
    const base = workdir ? path.basename(path.resolve(workdir)) : '';
    const title = base || 'session';
    upsertConvo(session, { title });
    return true;
  } catch (e) {
    warn(`seedJournalTitle failed: ${e?.message || e}`);
    return false;
  }
}
