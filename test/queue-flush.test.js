import { describe, it, expect } from 'vitest';
import { markJournalOrigin, isJournalOrigin, planQueueFlush } from '../lib/queue-flush.js';

const text = (t) => [{ type: 'text', text: t }];
const media = (name) => [{ type: 'image', source: name }];

describe('markJournalOrigin / isJournalOrigin', () => {
  it('marks and detects a blocks array', () => {
    const blocks = text('hi');
    expect(isJournalOrigin(blocks)).toBe(false);
    expect(markJournalOrigin(blocks)).toBe(blocks); // returns the same array
    expect(isJournalOrigin(blocks)).toBe(true);
  });

  it('is safe on null/undefined', () => {
    expect(isJournalOrigin(null)).toBe(false);
    expect(isJournalOrigin(undefined)).toBe(false);
  });
});

// New contract (post mixed-origin-garble fix, Bugbot finding #1): planQueueFlush
// always produces a SINGLE merged send for the whole queue — the PTY's
// sendText only tracks one pending Enter timer, so two back-to-back
// sendToSession calls in iv mode cancel each other's Enter and submit one
// concatenated, garbled message (see lib/interactive-session.js sendText).
// Journal mirroring is now computed out-of-band as a separate `mirrorText`
// string (the Matrix-origin text subset, in queue order) instead of driving
// a second send — callers send `blocks` with skipJournalMirror true and
// mirror `mirrorText` themselves via journalPublishUserItem.
describe('planQueueFlush', () => {
  it('returns an empty send for an empty/null/undefined queue', () => {
    expect(planQueueFlush([])).toEqual({ blocks: [], mirrorText: '' });
    expect(planQueueFlush(null)).toEqual({ blocks: [], mirrorText: '' });
    expect(planQueueFlush(undefined)).toEqual({ blocks: [], mirrorText: '' });
  });

  it('all-Matrix queue: one merged send, mirrors everything (unchanged external behavior)', () => {
    const { blocks, mirrorText } = planQueueFlush([text('one'), text('two'), text('three')]);
    expect(blocks).toEqual([{ type: 'text', text: 'one\n\ntwo\n\nthree' }]);
    expect(mirrorText).toBe('one\n\ntwo\n\nthree');
  });

  it('all-Matron (journal-origin) queue: one merged send, mirrors nothing', () => {
    const { blocks, mirrorText } = planQueueFlush([
      markJournalOrigin(text('a')),
      markJournalOrigin(text('b')),
    ]);
    expect(blocks).toEqual([{ type: 'text', text: 'a\n\nb' }]);
    expect(mirrorText).toBe('');
  });

  it('mixed origin: still ONE merged send (not split), mirror-text is only the Matrix-origin subset, in order', () => {
    const { blocks, mirrorText } = planQueueFlush([
      text('matrix-1'),
      markJournalOrigin(text('matron-1')),
      markJournalOrigin(text('matron-2')),
      text('matrix-2'),
    ]);
    // Single send: every entry's text merged in original queue order,
    // regardless of origin — origin no longer partitions the send.
    expect(blocks).toEqual([{ type: 'text', text: 'matrix-1\n\nmatron-1\n\nmatron-2\n\nmatrix-2' }]);
    // Mirror payload: Matrix-origin entries only, in queue order.
    expect(mirrorText).toBe('matrix-1\n\nmatrix-2');
  });

  it('media entries flush accumulated text first, then ride in the same (single) send', () => {
    const { blocks, mirrorText } = planQueueFlush([text('caption'), media('pic.png'), text('after')]);
    expect(blocks).toEqual([
      { type: 'text', text: 'caption' },
      { type: 'image', source: 'pic.png' },
      { type: 'text', text: 'after' },
    ]);
    expect(mirrorText).toBe('caption\n\nafter');
  });

  it('multiple text blocks within one entry merge with \\n, entries with \\n\\n (existing behavior)', () => {
    const twoBlocks = [{ type: 'text', text: 'l1' }, { type: 'text', text: 'l2' }];
    const { blocks, mirrorText } = planQueueFlush([twoBlocks, text('next')]);
    expect(blocks).toEqual([{ type: 'text', text: 'l1\nl2\n\nnext' }]);
    expect(mirrorText).toBe('l1\nl2\n\nnext');
  });

  it('an origin flip next to a media entry: still one send; mirror-text skips the journal-origin entry', () => {
    const { blocks, mirrorText } = planQueueFlush([
      media('a.png'),
      markJournalOrigin(text('matron')),
    ]);
    expect(blocks).toEqual([
      { type: 'image', source: 'a.png' },
      { type: 'text', text: 'matron' },
    ]);
    expect(mirrorText).toBe('');
  });

  it('a mixed-content entry (text + media in the SAME entry) mirrors its text portion when Matrix-origin', () => {
    const entry = [{ type: 'text', text: 'File saved to /x' }, { type: 'image', source: 'x.png' }];
    const { blocks, mirrorText } = planQueueFlush([entry]);
    expect(blocks).toEqual(entry);
    expect(mirrorText).toBe('File saved to /x');
  });

  it('a mixed-content entry does not mirror when journal-origin', () => {
    const entry = markJournalOrigin([{ type: 'text', text: 'from matron' }, { type: 'image', source: 'x.png' }]);
    const { blocks, mirrorText } = planQueueFlush([entry]);
    expect(blocks).toEqual([{ type: 'text', text: 'from matron' }, { type: 'image', source: 'x.png' }]);
    expect(mirrorText).toBe('');
  });
});
