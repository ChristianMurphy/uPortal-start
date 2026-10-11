/* global process */
// Runs the whole Playwright suite (tests/uportal-pw.config.ts) with a network trace for every test,
// so tests/replay/harvest.mjs can list the requests it makes (docs/http-replay.md). Used only
// when the reference is recorded.
import base from '../uportal-pw.config.ts';

export default {
    ...base,
    testDir: '..',
    outputDir: '../../build/replay/suite-results',
    // A line for every passing test buries the failures in a CI job log (MOD-D53)
    reporter: process.env.CI ? [['dot'], ['github']] : [['list']],
    // A failed test still made its requests; retries would only repeat them.
    retries: 0,
    use: {
        ...base.use,
        // Network entries are written only when snapshots are on; screenshots are not needed.
        trace: { mode: 'on', snapshots: true, screenshots: false, sources: false },
        video: 'off',
        screenshot: 'off',
        ...(process.env.REPLAY_CHROMIUM ? { launchOptions: { executablePath: process.env.REPLAY_CHROMIUM } } : {}),
    },
};
