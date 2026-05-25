// Standalone SDK demo (no HTTP UI). Use `npm start` for the full demo (server.js).
require('./load-env');
const ld = require('./ld');

function showBanner() {
  console.log(
    `      ██
          ██
      ████████
         ███████
██ LAUNCHDARKLY █
         ███████
      ████████
          ██
        ██
`,
  );
}

ld.initLaunchDarkly((payload) => {
  const anyOn = payload.evaluationsByContext?.some(
    (entry) => entry.flags['amazing-feature-1']?.value,
  );
  if (anyOn) showBanner();

  if (typeof process.env.CI !== 'undefined') {
    process.exit(0);
  }
}).catch((error) => {
  console.log(`*** SDK failed to initialize: ${error}`);
  process.exit(1);
});
