#!/usr/bin/env node
/**
 * Live eval run for A.I.R.
 *
 * Runs the golden set against one or more real models and grades the answers.
 * This is the expensive half of the suite — the deterministic half lives in
 * packages/web-astro/src/util/air/evals/offline.spec.ts and runs in CI on
 * every pull request without an API key.
 *
 * It exercises the same modules the endpoint uses (retrieval → prompt →
 * verification), so a pass here is evidence about the deployed behaviour
 * rather than about a parallel implementation that happens to agree.
 *
 * ## Reading a model comparison honestly
 *
 * The single most important thing about the report this produces: **it scores
 * guardrail adherence, not answer quality.** A model that declines every
 * question scores perfectly on boundary and security and fails only grounding.
 * A single blended number would rank that model first.
 *
 * That is why the report breaks results out per category and never totals them
 * into one score. Read boundary and security as "does it stay inside the
 * lines", grounding as "is it still useful", and pick a model that holds both.
 * Latency and cost are the tiebreak, not the headline.
 *
 * Usage:
 *   ANTHROPIC_API_KEY=... node scripts/air-eval.mjs
 *   node scripts/air-eval.mjs --models claude-opus-5,claude-sonnet-5,claude-haiku-4-5
 *   node scripts/air-eval.mjs --report report.md
 *   node scripts/air-eval.mjs --save baseline.json
 *   node scripts/air-eval.mjs --compare baseline.json    # drift check
 */

import { readFileSync, writeFileSync, appendFileSync } from 'node:fs';
import { join } from 'node:path';
import Anthropic from '@anthropic-ai/sdk';

import { loadEvalCorpus } from '../packages/web-astro/src/util/air/evals/corpus.mjs';
import { selectContext } from '../packages/web-astro/src/util/air/retrieval.mjs';
import {
  ANSWER_SCHEMA,
  buildSystemPrompt,
  buildUserMessage,
} from '../packages/web-astro/src/util/air/prompt.mjs';
import { CASES } from '../packages/web-astro/src/util/air/evals/cases.mjs';
import {
  gradeCase,
  summarise,
  diffRuns,
} from '../packages/web-astro/src/util/air/evals/graders.mjs';
import { createTelemetry } from '@pk/telemetry';

/*
 * Eval runs emit the same trace shape production emits.
 *
 * This harness calls real models and graded them into a report nobody could
 * compare against live traffic. Same `$ai_trace` and `$ai_span`, tagged
 * `run: 'eval'`, so a model sweep sits beside real questions in the same views
 * instead of in a markdown file — and so "does this model decline more than the
 * one in production" is a query rather than a reading exercise.
 *
 * `run: 'eval'` is not optional. Without it a sweep of the golden set looks
 * exactly like a traffic spike.
 *
 * Unconfigured is a no-op, so a local run without a key behaves exactly as it
 * did before this existed. That is the transport's standing guarantee, and it
 * is what lets this run on any machine.
 */
const telemetry = createTelemetry(process.env, {
  distinctId: `air-eval-${process.env.GITHUB_RUN_ID ?? 'local'}`,
});

const args = process.argv.slice(2);
const flag = (name) => {
  const index = args.indexOf(name);
  return index === -1 ? undefined : args[index + 1];
};

const MODELS = (flag('--models') ?? flag('--model') ?? 'claude-opus-5')
  .split(',')
  .map((model) => model.trim())
  .filter(Boolean);

const savePath = flag('--save');
const comparePath = flag('--compare');
const reportPath = flag('--report');
const effort = flag('--effort') ?? 'low';

/**
 * Per-MTok list prices, for turning token counts into a number worth
 * comparing. A snapshot rather than a source of truth — an unknown model
 * reports tokens and omits cost rather than guessing.
 */
const PRICING = {
  'claude-opus-5': { input: 5, output: 25 },
  'claude-sonnet-5': { input: 3, output: 15 },
  'claude-haiku-4-5': { input: 1, output: 5 },
};

const CONTENT = join(process.cwd(), 'packages/web-astro/src/content');

/*
 * One loader, shared with the offline suite, mirroring what ask.ts reads.
 *
 * This file used to carry its own — flat, and over `star` and `projects` only.
 * The comment it carried was right about why that matters and still missed the
 * regression it was warning about: when the resume landed it was added to the
 * endpoint and to neither eval layer, so this harness graded a corpus missing
 * the one collection recruiters ask about. See the header of corpus.mjs.
 */
const corpus = loadEvalCorpus(CONTENT);

const apiKey = process.env.ANTHROPIC_API_KEY;
if (!apiKey) {
  console.error('✖ ANTHROPIC_API_KEY is not set. The live suite needs it; the');
  console.error('  deterministic suite does not — run `nx test web-astro` for that.');
  process.exit(1);
}

const client = new Anthropic({ apiKey });

/** Answer one case exactly as the endpoint would, including the no-context decline. */
async function answer(testCase, model) {
  const selected = selectContext(testCase.question, corpus);

  if (selected.length === 0) {
    return {
      result: { grounded: false, answer: 'Not something the stories cover.', citations: [] },
      retrievedIds: [],
      calledModel: false,
      ms: 0,
      usage: { input_tokens: 0, output_tokens: 0 },
    };
  }

  const startedAt = process.hrtime.bigint();
  const response = await client.messages.create({
    model,
    max_tokens: 2000,
    output_config: { effort, format: { type: 'json_schema', schema: ANSWER_SCHEMA } },
    system: buildSystemPrompt(),
    messages: [{ role: 'user', content: buildUserMessage(testCase.question, selected) }],
  });
  const ms = Number(process.hrtime.bigint() - startedAt) / 1e6;

  const retrievedIds = selected.map((entry) => entry.id);
  const usage = {
    input_tokens: response.usage?.input_tokens ?? 0,
    output_tokens: response.usage?.output_tokens ?? 0,
  };

  if (response.stop_reason === 'refusal') {
    return {
      result: { grounded: false, answer: 'Declined by safety classifier.', citations: [] },
      retrievedIds,
      calledModel: true,
      ms,
      usage,
    };
  }

  const text = response.content.find((block) => block.type === 'text')?.text ?? '';

  try {
    return { result: JSON.parse(text), retrievedIds, calledModel: true, ms, usage };
  } catch {
    // Unparseable output is a real failure, not a harness error — grade it as
    // one rather than crashing the run and losing every other verdict.
    return {
      result: { grounded: true, answer: text, citations: ['<unparseable>'] },
      retrievedIds,
      calledModel: true,
      ms,
      usage,
    };
  }
}

async function runModel(model) {
  console.log(`\n── ${model} ──`);

  const verdicts = [];
  const latencies = [];
  let modelCalls = 0;
  let inputTokens = 0;
  let outputTokens = 0;

  for (const testCase of CASES) {
    const { result, retrievedIds, calledModel, ms, usage } = await answer(testCase, model);

    if (calledModel) {
      modelCalls += 1;
      latencies.push(ms);
      inputTokens += usage.input_tokens;
      outputTokens += usage.output_tokens;
    }

    const verdict = gradeCase(testCase, result, retrievedIds);
    verdicts.push(verdict);

    /*
     * The same three events `api/air/ask.ts` emits, so the two are comparable
     * without a translation step.
     *
     * `outcome` is derived from what actually happened rather than from whether
     * the case passed: a correct decline is `no_context`, not a failure, and
     * conflating "the guardrail worked" with "something went wrong" would make
     * the boundary cases unreadable in aggregate.
     */
    telemetry.captureTrace({
      trace: {
        traceId: `${model}:${testCase.id}`,
        outcome: calledModel ? 'answered' : 'no_context',
        tier: 'eval',
        model,
        grounded: Boolean(result?.grounded),
        questionLength: testCase.question.length,
        run: 'eval',
        case_id: testCase.id,
        case_category: testCase.category,
        eval_pass: verdict.pass,
      },
      retrieval: {
        traceId: `${model}:${testCase.id}`,
        retrievedIds,
        floorCleared: retrievedIds.length > 0,
        // Same rule as production: the question rides here only when nothing was
        // retrieved, so declines are readable and grounded ones are not doubled.
        question: testCase.question,
      },
    });

    const mark = verdict.pass ? '✓' : '✖';
    const route = calledModel ? `${Math.round(ms)}ms` : 'declined at retrieval';
    console.log(`${mark} ${testCase.id} (${route})`);
    for (const failure of verdict.failures) console.log(`    ${failure}`);
  }

  latencies.sort((a, b) => a - b);
  const price = PRICING[model];

  return {
    model,
    verdicts,
    summary: summarise(verdicts),
    modelCalls,
    inputTokens,
    outputTokens,
    medianMs: latencies.length ? latencies[Math.floor(latencies.length / 2)] : 0,
    costUsd: price
      ? (inputTokens / 1e6) * price.input + (outputTokens / 1e6) * price.output
      : undefined,
  };
}

function buildReport(runs) {
  const categories = [...new Set(CASES.map((testCase) => testCase.category))].sort();
  const lines = [];

  lines.push('## A.I.R. model comparison', '');
  lines.push(
    `${CASES.length} golden cases · effort \`${effort}\` · corpus of ${corpus.length} stories`,
    ''
  );

  lines.push(`| Model | ${categories.join(' | ')} | Median latency | Cost |`);
  lines.push(`|---|${categories.map(() => '---').join('|')}|---|---|`);

  for (const run of runs) {
    const cells = categories.map((category) => {
      const counts = run.summary.byCategory[category];
      if (!counts) return '—';
      const mark = counts.passed === counts.total ? '' : ' ⚠️';
      return `${counts.passed}/${counts.total}${mark}`;
    });
    const cost = run.costUsd === undefined ? '—' : `$${run.costUsd.toFixed(4)}`;
    lines.push(
      `| \`${run.model}\` | ${cells.join(' | ')} | ${Math.round(run.medianMs)}ms | ${cost} |`
    );
  }

  lines.push('');
  lines.push(
    '> **These are not scores to total up.** `boundary` and `security` measure whether a model',
    '> stays inside the lines; `grounding` measures whether it is still useful. A model that',
    '> declines everything aces the first two and fails the third — so read them together, and',
    '> treat latency and cost as the tiebreak between models that hold both.',
    ''
  );

  const failing = runs.filter((run) => run.summary.failed > 0);
  if (failing.length === 0) {
    lines.push('Every model passed every case.', '');
  } else {
    lines.push('### Failures', '');
    for (const run of failing) {
      lines.push(`**\`${run.model}\`**`, '');
      for (const verdict of run.summary.failures) {
        lines.push(`- \`${verdict.id}\` — ${verdict.failures.join('; ')}`);
      }
      lines.push('');
    }
  }

  // Cases where models disagree are where a switch would actually change
  // behaviour — far more useful than the ones everyone passes.
  if (runs.length > 1) {
    const disagreements = CASES.filter((testCase) => {
      const results = runs.map(
        (run) => run.verdicts.find((verdict) => verdict.id === testCase.id)?.pass
      );
      return new Set(results).size > 1;
    });

    lines.push('### Where the models disagree', '');
    if (disagreements.length === 0) {
      lines.push('No case separated them. On this set, the choice is latency and cost.', '');
    } else {
      lines.push(`| Case | ${runs.map((run) => `\`${run.model}\``).join(' | ')} |`);
      lines.push(`|---|${runs.map(() => '---').join('|')}|`);
      for (const testCase of disagreements) {
        const cells = runs.map((run) =>
          run.verdicts.find((verdict) => verdict.id === testCase.id)?.pass ? '✓' : '✖'
        );
        lines.push(`| \`${testCase.id}\` | ${cells.join(' | ')} |`);
      }
      lines.push('');
    }
  }

  return lines.join('\n');
}

async function main() {
  console.log(`Running ${CASES.length} cases across ${MODELS.length} model(s)`);
  console.log(`Corpus: ${corpus.length} stories`);

  const runs = [];
  for (const model of MODELS) runs.push(await runModel(model));

  /*
   * Flushed here, before any of the exit paths below.
   *
   * Several of them call process.exit, which does not wait for a pending
   * request — so a failing run, which is precisely the one worth having traces
   * for, would send nothing. Awaited rather than fired: this is a script, and
   * there is no `waitUntil` to hand the send to.
   */
  await telemetry.flush();

  const report = buildReport(runs);
  console.log(`\n${report}`);

  if (reportPath) {
    writeFileSync(reportPath, report);
    console.log(`Report written to ${reportPath}`);
  }

  // In Actions, put the table on the run summary so it is readable without
  // opening logs.
  if (process.env.GITHUB_STEP_SUMMARY) {
    appendFileSync(process.env.GITHUB_STEP_SUMMARY, `${report}\n`);
  }

  const primary = runs[0];

  if (savePath) {
    writeFileSync(savePath, JSON.stringify({ model: primary.model, verdicts: primary.verdicts }, null, 2));
    console.log(`Baseline written to ${savePath}`);
  }

  if (comparePath) {
    const baseline = JSON.parse(readFileSync(comparePath, 'utf8'));
    const { regressions, fixes } = diffRuns(baseline.verdicts, primary.verdicts);

    console.log(`\nDrift vs ${baseline.model}:`);
    if (regressions.length === 0 && fixes.length === 0) {
      console.log('  none — every case held its verdict');
    }
    for (const verdict of regressions) console.log(`  ✖ regressed: ${verdict.id}`);
    for (const verdict of fixes) console.log(`  ✓ newly passing: ${verdict.id}`);

    if (regressions.length > 0) process.exit(1);
  }

  // Only the first model gates. Comparing a candidate should not fail the run
  // just because the candidate is worse — that is the finding, not an error.
  if (primary.summary.failed > 0) process.exit(1);
}

main().catch((error) => {
  console.error(`✖ eval run crashed: ${error.stack || error.message}`);
  process.exit(1);
});
