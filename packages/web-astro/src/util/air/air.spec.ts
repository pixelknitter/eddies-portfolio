import { describe, it, expect } from 'vitest';
import { selectContext, scoreEntry, terms, RELEVANCE_FLOOR } from './retrieval.mjs';
import { verifyAnswer, validateQuestion, buildUserMessage, MAX_QUESTION_LENGTH } from './prompt.mjs';
import { safeEqual, isAuthorised, createRateLimiter } from './access.mjs';

const corpus = [
  {
    id: 'platform-migration',
    data: {
      title: 'Migrated a build pipeline with zero downtime',
      situation: 'The deploy pipeline was failing silently and nobody trusted it.',
      task: 'Move hosting without an outage.',
      action: 'Built a smoke test that ran against the deployed site.',
      result: 'Cut failed deploys to zero over six weeks.',
      tags: ['infrastructure', 'deployment'],
    },
  },
  {
    id: 'team-growth',
    data: {
      title: 'Shortened onboarding for new engineers',
      situation: 'Setup knowledge lived in people heads.',
      task: 'Make the path from clone to first change short.',
      action: 'Wrote a runbook from real failures.',
      result: 'Onboarding dropped from three weeks to four days.',
      tags: ['leadership', 'mentoring'],
    },
  },
];

describe('retrieval', () => {
  it('strips stopwords and short tokens', () => {
    expect(terms('How did he do the work at a company?')).toEqual(['work', 'company']);
  });

  it('scores a relevant entry above the floor', () => {
    const score = scoreEntry(terms('deployment pipeline'), corpus[0].data);
    expect(score).toBeGreaterThanOrEqual(RELEVANCE_FLOOR);
  });

  it('retrieves the story that matches the question', () => {
    const selected = selectContext('how does he handle onboarding new engineers', corpus);
    expect(selected.map((entry) => entry.id)).toEqual(['team-growth']);
  });

  // The most important behaviour in the module: no match means no context,
  // which is what forces the endpoint to decline instead of asking the model
  // to answer a question nothing in the corpus addresses.
  it('returns nothing when the corpus does not address the question', () => {
    expect(selectContext('what is his favourite pizza topping', corpus)).toEqual([]);
    expect(selectContext('', corpus)).toEqual([]);
  });

  it('respects the entry limit', () => {
    const many = Array.from({ length: 10 }, (_, i) => ({
      id: `entry-${i}`,
      data: { title: 'deployment pipeline', tags: ['deployment'] },
    }));
    expect(selectContext('deployment pipeline', many, { limit: 3 })).toHaveLength(3);
  });

  // Unstable ordering across identical requests would show up in a drift eval
  // as a regression that is really just tie-break noise.
  it('orders ties deterministically', () => {
    const tied = [
      { id: 'b', data: { title: 'deployment pipeline' } },
      { id: 'a', data: { title: 'deployment pipeline' } },
    ];
    expect(selectContext('deployment pipeline', tied).map((e) => e.id)).toEqual(['a', 'b']);
  });
});

describe('question validation', () => {
  it('rejects empty and non-string input', () => {
    expect(validateQuestion('   ').ok).toBe(false);
    expect(validateQuestion(undefined).ok).toBe(false);
    expect(validateQuestion(42).ok).toBe(false);
  });

  it('rejects a question past the length cap', () => {
    expect(validateQuestion('x'.repeat(MAX_QUESTION_LENGTH + 1)).ok).toBe(false);
  });

  it('accepts and trims a normal question', () => {
    const result = validateQuestion('  Why should I work with Eddie?  ');
    expect(result).toEqual({ ok: true, question: 'Why should I work with Eddie?' });
  });
});

describe('answer verification', () => {
  const context = [{ id: 'platform-migration' }, { id: 'team-growth' }];

  it('accepts an answer citing supplied stories', () => {
    expect(
      verifyAnswer(
        { grounded: true, answer: 'He cut failed deploys to zero.', citations: ['platform-migration'] },
        context
      )
    ).toEqual({ ok: true });
  });

  // The check the whole design exists for: a citation to something retrieval
  // never supplied means the model named a source it was not given.
  it('rejects a citation that was never supplied', () => {
    const result = verifyAnswer(
      { grounded: true, answer: 'He led the Acme rewrite.', citations: ['acme-rewrite'] },
      context
    );
    expect(result.ok).toBe(false);
    expect(result.reason).toContain('acme-rewrite');
  });

  it('rejects a grounded answer with no citations', () => {
    expect(
      verifyAnswer({ grounded: true, answer: 'He is great.', citations: [] }, context).ok
    ).toBe(false);
  });

  it('accepts an honest decline', () => {
    expect(
      verifyAnswer(
        { grounded: false, answer: 'That is not something these stories cover.', citations: [] },
        context
      )
    ).toEqual({ ok: true });
  });

  // A decline that still cites something is how an invented claim rides along
  // behind an apparently honest answer.
  it('rejects a decline that carries citations', () => {
    expect(
      verifyAnswer({ grounded: false, answer: 'Cannot say.', citations: ['team-growth'] }, context).ok
    ).toBe(false);
  });

  it('rejects an empty answer', () => {
    expect(verifyAnswer({ grounded: true, answer: '   ', citations: ['team-growth'] }, context).ok).toBe(false);
  });
});

describe('user message', () => {
  it('wraps every story in a tagged block carrying its id', () => {
    const message = buildUserMessage('how does he onboard people', [corpus[1]]);
    expect(message).toContain('<story id="team-growth">');
    expect(message).toContain('Onboarding dropped from three weeks to four days.');
    expect(message).toContain('<question>');
  });
});

describe('access', () => {
  it('compares equal and unequal strings correctly', () => {
    expect(safeEqual('secret', 'secret')).toBe(true);
    expect(safeEqual('secret', 'secrets')).toBe(false);
    expect(safeEqual('secret', 'Secret')).toBe(false);
    expect(safeEqual('', '')).toBe(true);
  });

  // Failing closed on a missing secret is deliberate: an unset AIR_ACCESS_CODE
  // is the likeliest misconfiguration, and it must lock the door, not remove it.
  it('denies everything when no code is configured', () => {
    expect(isAuthorised('anything', undefined)).toBe(false);
    expect(isAuthorised('anything', '')).toBe(false);
    expect(isAuthorised(undefined, undefined)).toBe(false);
  });

  it('authorises only the configured code', () => {
    expect(isAuthorised('conf-2026', 'conf-2026')).toBe(true);
    expect(isAuthorised('wrong', 'conf-2026')).toBe(false);
  });
});

describe('rate limiter', () => {
  it('allows up to the limit then blocks', () => {
    const limiter = createRateLimiter({ limit: 2, windowMs: 1000, now: () => 0 });
    expect(limiter.check('ip').allowed).toBe(true);
    expect(limiter.check('ip').allowed).toBe(true);

    const blocked = limiter.check('ip');
    expect(blocked.allowed).toBe(false);
    expect(blocked.retryAfterSeconds).toBe(1);
  });

  it('tracks clients independently', () => {
    const limiter = createRateLimiter({ limit: 1, windowMs: 1000, now: () => 0 });
    expect(limiter.check('a').allowed).toBe(true);
    expect(limiter.check('b').allowed).toBe(true);
    expect(limiter.check('a').allowed).toBe(false);
  });

  it('resets after the window passes', () => {
    let time = 0;
    const limiter = createRateLimiter({ limit: 1, windowMs: 1000, now: () => time });
    expect(limiter.check('ip').allowed).toBe(true);
    expect(limiter.check('ip').allowed).toBe(false);

    time = 1001;
    expect(limiter.check('ip').allowed).toBe(true);
  });
});
