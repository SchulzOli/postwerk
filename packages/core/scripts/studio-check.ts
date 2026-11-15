/**
 * A live check of the AI studio against the real Claude API: drafts one
 * AppSource listing for an example product through the studio's own request
 * code (same model, prompt, fallback and structured output), then checks the
 * draft against the market's limits. It costs a few cents on your Anthropic
 * account and stores nothing.
 *
 *   ANTHROPIC_API_KEY=… npm run studio:check
 *
 * AI_MODEL picks another model, as on the server. Exits non-zero on failure.
 */
import Anthropic from '@anthropic-ai/sdk';
import { builtinMarket, listingProblems } from '../src/market';
import type { ListingContent } from '../src/marketing';
import { askStudio, draftsFrom, productBrief, studioContext, studioSetup } from '../src/studio';

const setup = studioSetup();
if (!setup) {
  console.error('Set ANTHROPIC_API_KEY first (in .env or the environment).');
  process.exit(1);
}

const market = builtinMarket('business-central')!;
const product = {
  name: 'Deposit Tracker',
  profile: {
    does: 'Books deposits on crates, bottles and pallets by itself: on every sales and purchase document, with a deposit account per customer and vendor.',
    audience: 'Beverage wholesalers and breweries with 10 to 200 people. Order processing uses it daily; the accountant at month end.',
    features: ['Deposit lines on orders, invoices and credit memos', 'A deposit account per customer and vendor, with a statement', 'Returns booked from the delivery note'],
    countries: 'Germany, Austria',
    languages: 'German, English',
    publisher: 'Example Apps GmbH',
    app_version: '2.4.0.0',
    editions: ['essentials', 'premium'],
  },
};
const brand = 'Company: Example Apps GmbH\nTone of voice: plain, competent, friendly; no hype.';
const campaign = { name: 'Deposit Tracker launch', goal: 'leads' as const, audience: '', message: 'Deposits book themselves.', startsOn: null, endsOn: null };
const context = studioContext(brand, campaign, 'en', '', productBrief(product, market));

console.log(`Asking ${setup.model} for one AppSource listing…`);
const started = Date.now();
const answer = await askStudio(new Anthropic({ apiKey: process.env.ANTHROPIC_API_KEY }), setup.model, context, 'listing:listing', 1, market).catch((error: unknown) => {
  console.error(error instanceof Error ? error.message : error);
  process.exit(1);
});
const seconds = ((Date.now() - started) / 1000).toFixed(1);
const { inputTokens, outputTokens, cacheReadTokens, cacheWriteTokens } = answer.usage;
console.log(`Tokens: ${inputTokens} in, ${outputTokens} out, ${cacheReadTokens} read from and ${cacheWriteTokens} written to the cache; ${seconds} s.`);
if ('failure' in answer) {
  console.error(`The request failed: ${answer.failure}.`);
  process.exit(1);
}
console.log(`Served by ${answer.model}.`);

const { pieces } = draftsFrom('listing:listing', answer.output, 1, { website: 'https://example.com', hasCharacter: false }, market);
const draft = pieces[0];
if (!draft) {
  console.error('Claude answered, but not with a listing draft:', JSON.stringify(answer.output).slice(0, 500));
  process.exit(1);
}
const content = draft.content as ListingContent;
for (const field of market.marketplace.listing.texts) {
  const text = content.texts[field.id] ?? '';
  console.log(`\n${field.label.en} (${text.length}/${field.max}):\n${text}`);
}
console.log(`\nKeywords: ${content.keywords.join(', ')}`);

// Screenshots and documents are not the studio's part; count them as present.
const problems = listingProblems(market, { texts: content.texts, keywords: content.keywords, screenshots: [{ caption: 'x' }, { caption: 'x' }, { caption: 'x' }], videos: 0, documents: 1 });
const naming = /\bBC\b|\bD365\b/.test(Object.values(content.texts).join(' '));
if (problems.length || naming) {
  console.error('\nThe draft breaks a rule:', JSON.stringify(problems), naming ? '(it abbreviates Business Central)' : '');
  process.exit(1);
}
console.log('\nThe draft is within AppSource’s limits. The AI studio works with this key and model.');
