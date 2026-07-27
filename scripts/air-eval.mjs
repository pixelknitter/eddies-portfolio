#!/usr/bin/env node
/**
 * Live eval run for A.I.R.
 *
 * Runs the golden set against the real model and grades the answers. This is
 * the expensive half of the suite — the deterministic half lives in
 * packages/web-astro/src/util/air/evals/offline.spec.ts and runs in CI on
 * every pull request without an API key.
 *
 * It exercises the same modules the endpoint uses (retrieval → prompt →
 * verification), so a pass here is evidence about the deployed behaviour
 * rather than about a parallel implementation that happens to agree.
 *
 * Usage:
 *   ANTHROPIC_API_KEY=... node scripts/air-eval.mjs
 *   node scripts/air-eval.mjs --save baseline.json
 *   node scripts/air-eval.mjs --compare baseline.json      # drift check
 *   node scripts/air-eval.mjs --model claude-sonnet-5      # cross-model drift
 */

import { readdirSync, readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import Anthropic from '@anthropic-ai/sdk';

import { parseFrontmatter } from '../packages/obsidian-publish-core/src/index.mjs';
import { selectContext } from '../packages/web-astro/src/util/air/retrieval.mjs';
import {
  ANSWER_SCHEMA,
  buildSystemPrompt,
  buildUserMessage,
} from '../packages/web-astro/src/util/air/prompt.mjs';
import { CASES } from '../packages/web-astro/src/util/air/evals/cases.mjs';
import { gradeCase, summarise, diffRuns } from '../packages/web-astro/src/util/air/evals/graders.mjs';

const args = process.argv.slice(2);
const flag = (name) => {
  const index = args.indexOf(name);
  return index === -1 ? undefined : args[index + 1];
};

const MODEL = flag('--model') ?? 'claude-opus-5';
const savePath = flag('--save');
const comparePath = flag('--compare');

const CONTENT = join(process.cwd(), 'packages/web-astro/src/content');

function loadCollection(name) {
  const dir = join(CONTENT, name);
  return readdirSync(dir)
    .filter((file) => file.endsWith('.md') && !file.startsWith('_'))
    .map((file) => ({
      id: file.replace(/\.md$/, ''),
      data: parseFrontmatter(readFileSync(join(dir, file), 'utf8')).frontmatter,
    }));
}

const corpus = [...loadCollection('star'), ...loadCollection('projects')];

const apiKey = process.env.ANTHROPIC_API_KEY;
if (!apiKey) {
  console.error('✖ ANTHROPIC_API_KEY is not set. The live suite needs it; the');
  console.error('  deterministic suite does not — run `nx test web-astro` for that.');
  process.exit(1);
}

const client = new Anthropic({ apiKey });

/**
 * Answer one case exactly the way the endpoint would, including the
 * no-context decline that never reaches the model.
 */
async function answer(testCase) {
  const selected = selectContext(testCase.question, corpus);

  if (selected.length === 0) {
    return {
      result: { grounded: false, answer: 'Not something the stories cover.', citations: [] },
      retrievedIds: [],
      calledModel: false,
    };
  }

  const response = await client.messages.create({
    model: MODEL,
    max_tokens: 2000,
    output_config: {
      effort: 'low',
      format: { type: 'json_schema', schema: ANSWER_SCHEMA },
    },
    system: buildSystemPrompt(),
    messages: [{ role: 'user', content: buildUserMessage(testCase.question, selected) }],
  });

  const retrievedIds = selected.map((entry) => entry.id);

  if (response.stop_reason === 'refusal') {
    return {
      result: { grounded: false, answer: 'Declined by safety classifier.', citations: [] },
      retrievedIds,
      calledModel: true,
    };
  }

  const text = response.content.find((block) => block.type === 'text')?.text ?? '';

  try {
    return { result: JSON.parse(text), retrievedIds, calledModel: true };
  } catch {
    // Unparseable output is a real failure, not a harness error — grade it as
    // one rather than crashing the run and losing every other verdict.
    return {
      result: { grounded: true, answer: text, citations: ['<unparseable>'] },
      retrievedIds,
      calledModel: true,
    };
  }
}

async function main() {
  console.log(`Running ${CASES.length} cases against ${MODEL}`);
  console.log(`Corpus: ${corpus.length} stories\n`);

  const verdicts = [];
  let modelCalls = 0;

  for (const testCase of CASES) {
    const { result, retrievedIds, calledModel } = await answer(testCase);
    if (calledModel) modelCalls += 1;

    const verdict = gradeCase(testCase, result, retrievedIds);
    verdicts.push(verdict);

    const mark = verdict.pass ? '✓' : '✖';
    const route = calledModel ? '' : ' (declined at retrieval — no model call)';
    console.log(`${mark} ${testCase.id}${route}`);
    for (const failure of verdict.failures) console.log(`    ${failure}`);
  }

  const summary = summarise(verdicts);

  console.log('');
  for (const [category, counts] of Object.entries(summary.byCategory)) {
    console.log(`  ${category}: ${counts.passed}/${counts.total}`);
  }
  console.log(`\n${summary.passed}/${summary.total} passed — ${modelCalls} model calls`);

  if (savePath) {
    writeFileSync(savePath, JSON.stringify({ model: MODEL, verdicts }, null, 2));
    console.log(`Baseline written to ${savePath}`);
  }

  if (comparePath) {
    const baseline = JSON.parse(readFileSync(comparePath, 'utf8'));
    const { regressions, fixes } = diffRuns(baseline.verdicts, verdicts);

    console.log(`\nDrift vs ${baseline.model}:`);
    if (regressions.length === 0 && fixes.length === 0) {
      console.log('  none — every case held its verdict');
    }
    for (const verdict of regressions) console.log(`  ✖ regressed: ${verdict.id}`);
    for (const verdict of fixes) console.log(`  ✓ newly passing: ${verdict.id}`);

    if (regressions.length > 0) process.exit(1);
  }

  if (summary.failed > 0) process.exit(1);
}

main().catch((error) => {
  console.error(`✖ eval run crashed: ${error.stack || error.message}`);
  process.exit(1);
});
