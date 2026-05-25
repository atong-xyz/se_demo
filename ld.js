require('./load-env');

const { EventEmitter } = require('events');
const LaunchDarkly = require('@launchdarkly/node-server-sdk');

const evaluationEvents = new EventEmitter();

const sdkKey = process.env.LAUNCHDARKLY_SDK_KEY;

/** How many unique contexts to evaluate (keys: example-user-key-1 … example-user-key-N). */
const DEFAULT_CONTEXT_COUNT = 50;
const CONTEXT_COUNT = Math.max(
  1,
  Number(process.env.LD_CONTEXT_COUNT ?? DEFAULT_CONTEXT_COUNT),
);

const METRIC_KEY = 'binary-metric';
/** When variationIndex === TRACK_SAMPLE_VARIATION_INDEX, track() runs at this rate (0.9 = 90%). */
const TRACK_SAMPLE_RATE = 0.10; // 5% will trigger track()
const TRACK_SAMPLE_VARIATION_INDEX = 2; // variationIndex will trigger sampling (purple)
/** Flag whose variationIndex controls whether sampling applies. */
const TRACK_VARIATION_FLAG_KEY = 'flag-color-experience';

/** Order matters for server log output. */
const FLAGS = [
  { key: 'amazing-feature-1', defaultValue: false },
  { key: 'flag-color-experience', defaultValue: 'gray' },
];

const FLAG_KEYS = FLAGS.map((f) => f.key);
const featureFlagKey = FLAGS[0].key;

let client;
let latestEvaluationPayload = null;
let initPromise = null;
const updateCallbacks = [];

function buildContext(index) {
  return {
    kind: 'user',
    key: `sample-user-key-a-${index}`,
    name: `Sample User A ${index}`,
    tier: `premium`,
    region: `us-east-1`,
    platform: `web`,
  };
}

function getContexts() {
  return Array.from({ length: CONTEXT_COUNT }, (_, i) => buildContext(i + 1));
}

function formatEvaluationDetail(flagKey, detail, context) {
  const reason = detail.reason ?? null;
  return {
    flagKey,
    context: { ...context },
    value: detail.value,
    variationIndex: detail.variationIndex,
    reason,
    /** Whether the flag is on in the environment (not the evaluated variation value). */
    flagOn: reason?.kind !== 'OFF',
  };
}

function logFlagEvaluation(flagKey, detail, context) {
  const formatted = formatEvaluationDetail(flagKey, detail, context);
  console.log(`*** '${flagKey}' evaluates to ${JSON.stringify(detail.value)}.`);
  console.log('*** Evaluation context & reason:');
  console.log(JSON.stringify(formatted, null, 2));
  return formatted;
}

function trackMetric(context, variationIndex) {
  const useSampleRate = variationIndex === TRACK_SAMPLE_VARIATION_INDEX;
  if (useSampleRate && Math.random() >= TRACK_SAMPLE_RATE) {
    console.log(
      `*** track('${METRIC_KEY}') skipped for context key: ${context.key} ` +
        `(variationIndex=${TRACK_SAMPLE_VARIATION_INDEX}, sample rate ${TRACK_SAMPLE_RATE * 100}%)`,
    );
    return;
  }
  client.track(METRIC_KEY, context);
  client.flush();
  const rateNote = useSampleRate
    ? `variationIndex=${variationIndex}, sampled`
    : `variationIndex=${variationIndex}, always`;
  console.log(`*** track('${METRIC_KEY}') sent for context key: ${context.key} (${rateNote})`);
}

async function evaluateAllFlags() {
  if (!client) throw new Error('LaunchDarkly SDK not initialized');

  const evaluationsByContext = [];

  for (const context of getContexts()) {
    console.log(`\n*** --- Context: ${context.key} ---`);
    const flags = {};

    for (const { key, defaultValue } of FLAGS) {
      const detail = await client.variationDetail(key, context, defaultValue);
      flags[key] = logFlagEvaluation(key, detail, context);
    }

    trackMetric(context, flags[TRACK_VARIATION_FLAG_KEY].variationIndex);
    evaluationsByContext.push({ context: { ...context }, flags });
  }

  latestEvaluationPayload = {
    contextCount: CONTEXT_COUNT,
    metricKey: METRIC_KEY,
    evaluationsByContext,
  };

  evaluationEvents.emit('update', latestEvaluationPayload);
  return latestEvaluationPayload;
}

function onEvaluationUpdate(listener) {
  evaluationEvents.on('update', listener);
  return () => evaluationEvents.off('update', listener);
}

function getLatestEvaluations() {
  return latestEvaluationPayload;
}

/** First context’s flags only — convenience for legacy callers. */
function getLatestEvaluation() {
  return latestEvaluationPayload?.evaluationsByContext?.[0]?.flags ?? null;
}

async function initLaunchDarkly(onUpdate) {
  if (onUpdate) updateCallbacks.push(onUpdate);
  if (initPromise) return initPromise;

  if (!sdkKey) throw new Error('Set LAUNCHDARKLY_SDK_KEY in .env (see .env.example)');

  initPromise = (async () => {
    client = LaunchDarkly.init(sdkKey);
    await client.waitForInitialization({ timeout: 10 });
    console.log('*** SDK successfully initialized!');
    const keys = getContexts().map((c) => c.key);
    const preview = keys.length <= 5 ? keys.join(', ') : `${keys.slice(0, 3).join(', ')}, …, ${keys[keys.length - 1]} (${keys.length} total)`;
    console.log(`*** CONTEXT_COUNT=${CONTEXT_COUNT} (env LD_CONTEXT_COUNT=${process.env.LD_CONTEXT_COUNT ?? 'not set'}, default=${DEFAULT_CONTEXT_COUNT})`);
    console.log(`*** Context keys: ${preview}`);

    const run = async () => {
      const payload = await evaluateAllFlags();
      for (const cb of updateCallbacks) cb(payload);
      return payload;
    };

    for (const { key } of FLAGS) {
      client.on(`update:${key}`, run);
    }
    return run();
  })();

  return initPromise;
}

module.exports = {
  DEFAULT_CONTEXT_COUNT,
  CONTEXT_COUNT,
  METRIC_KEY,
  TRACK_SAMPLE_RATE,
  FLAGS,
  FLAG_KEYS,
  featureFlagKey,
  buildContext,
  getContexts,
  initLaunchDarkly,
  evaluateAllFlags,
  getLatestEvaluations,
  getLatestEvaluation,
  formatEvaluationDetail,
  onEvaluationUpdate,
};
