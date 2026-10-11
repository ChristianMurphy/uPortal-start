// Seeded violations of the replay's rules (tests/replay/evaluate.mjs), so each rule is shown to
// fail a run. Run with: node --test tests/replay/evaluate.check.mjs
import assert from 'node:assert/strict';
import { test } from 'node:test';
import { evaluate, headingsOf, loadRegistry } from './evaluate.mjs';
import { outcome } from './lib.mjs';

const response = (status, location, body = { kind: 'empty' }) => ({ status, ...(location ? { location } : {}), headers: {}, body });
const exchange = (role, path, status, location) => ({ set: 'crawl', role, method: 'GET', path, response: response(status, location) });
const keyOf = (e) => `${e.set} ${e.role} ${e.method} ${e.path}`;
const matrixOf = (exchanges) => {
    const matrix = {};
    for (const e of exchanges) {
        matrix[`${e.method} ${e.path}`] ??= {};
        matrix[`${e.method} ${e.path}`][e.role] = `${e.response.status} ${outcome(e.response)}`;
    }
    return matrix;
};
const headings = headingsOf('# Upgrading\n\n## Servlet controllers are mapped by RequestMappingHandlerMapping\n\n## The `/resources/*` servlet is gone\n');
const security = { logins: {}, loginCookies: [], headers: {}, csrf: [] };

function run(recorded, actual, differences, options = {}) {
    const registry = loadRegistry({ differences }, headings);
    return evaluate({
        recorded,
        actual,
        keyOf,
        recordedMatrix: matrixOf(recorded),
        actualMatrix: matrixOf(actual),
        recordedSecurity: options.recordedSecurity ?? security,
        security: options.security ?? security,
        registry,
        selfCheck: options.selfCheck ?? false,
    });
}

const entry = (fields) => ({ reason: 'test', log: 'MOD-D29', visible: false, ...fields });

test('a run without differences passes', () => {
    const recorded = [exchange('guest', '/uPortal/api/permissions/owners.json', 403)];
    assert.equal(run(recorded, recorded, []).failed, false);
});

test('rule 1: a guest-visible admin route fails even when a registry entry excuses it', () => {
    const recorded = [exchange('guest', '/uPortal/api/permissions/owners.json', 403)];
    const actual = [exchange('guest', '/uPortal/api/permissions/owners.json', 200)];
    const result = run(recorded, actual, [
        entry({
            id: 'excuse-the-gain',
            path: '/uPortal/api/permissions/*',
            field: 'status',
            from: 403,
            to: 200,
            visible: true,
            upgrading: 'Servlet controllers are mapped by RequestMappingHandlerMapping',
        }),
    ]);
    assert.equal(result.failed, true);
    assert.equal(result.privilegeGains.length, 1);
    assert.equal(result.failures.length, 0, 'the status difference itself is registered');
    assert.equal(result.matrixChanges[0].registered, false, 'and the matrix cell still counts as unexplained');
});

test('rule 1: a redirect to the login page that turns into a page is a gain too', () => {
    const recorded = [exchange('guest', '/uPortal/p/portlet-admin/max/render.uP', 302, '/cas/login?service=x')];
    const actual = [exchange('guest', '/uPortal/p/portlet-admin/max/render.uP', 200)];
    assert.equal(run(recorded, actual, [entry({ id: 'e', path: '*', field: '*' })]).privilegeGains.length, 1);
});

test('rule 2: lost access needs an entry that names its UPGRADING-6.0.md section', () => {
    const recorded = [exchange('admin', '/uPortal/resources/spring/Spring.js', 200)];
    const actual = [exchange('admin', '/uPortal/resources/spring/Spring.js', 404)];
    const without = run(recorded, actual, [entry({ id: 'no-section', path: '/uPortal/resources/*', field: '*' })]);
    assert.equal(without.failed, true);
    assert.equal(without.lostAccess.length, 1);
    const withSection = run(recorded, actual, [
        entry({ id: 'with-section', path: '/uPortal/resources/*', field: '*', visible: true, upgrading: 'The /resources/* servlet is gone' }),
    ]);
    assert.equal(withSection.failed, false);
});

test('rule 3: a visible entry without a section, or with a section UPGRADING-6.0.md lacks, is a problem', () => {
    const recorded = [exchange('guest', '/uPortal/api/x', 405)];
    const actual = [exchange('guest', '/uPortal/api/x', 404)];
    const noSection = run(recorded, actual, [entry({ id: 'visible-no-section', path: '/uPortal/api/*', field: 'status', visible: true })]);
    assert.equal(noSection.failed, true);
    assert.match(noSection.problems[0], /names its UPGRADING-6.0.md section/);
    const wrongSection = run(recorded, actual, [entry({ id: 'wrong', path: '/uPortal/api/*', field: 'status', visible: true, upgrading: 'No such section' })]);
    assert.match(wrongSection.problems[0], /has no section/);
    const unclassified = run(recorded, actual, [{ id: 'unclassified', path: '/uPortal/api/*', field: 'status', reason: 'r', log: 'l' }]);
    assert.match(unclassified.problems[0], /"visible"/);
});

test('rule 4: an entry that matches nothing fails the run', () => {
    const recorded = [exchange('guest', '/uPortal/', 302)];
    const result = run(recorded, recorded, [entry({ id: 'unused', path: '/uPortal/api/never/*', field: 'status' })]);
    assert.equal(result.failed, true);
    assert.deepEqual(
        result.stale.map((s) => s.id),
        ['unused'],
    );
});

test('rule 4: an unused entry that says where it applies, with a reason, passes', () => {
    const recorded = [exchange('guest', '/uPortal/', 302)];
    const result = run(recorded, recorded, [entry({ id: 'local-only', path: '/uPortal/media/*', field: 'body', where: 'local', whereReason: 'npm versions' })]);
    assert.equal(result.failed, false);
    assert.equal(result.unusedElsewhere.length, 1);
    const noReason = run(recorded, recorded, [entry({ id: 'local-no-reason', path: '/uPortal/media/*', field: 'body', where: 'local' })]);
    assert.equal(noReason.failed, true);
});

test('rule 4 does not apply to the reference replayed against itself', () => {
    const recorded = [exchange('guest', '/uPortal/', 302)];
    assert.equal(run(recorded, recorded, [entry({ id: 'unused', path: '/x', field: 'status' })], { selfCheck: true }).failed, false);
});

test('a CSRF change needs an entry with an UPGRADING-6.0.md section (MOD-I130)', () => {
    const recorded = [exchange('guest', '/uPortal/', 302)];
    const probe = { role: 'guest', method: 'POST', path: '/uPortal/api/layout' };
    const before = { ...security, csrf: [{ ...probe, status: 401, outcome: 'unauthorized' }] };
    const after = { ...security, csrf: [{ ...probe, status: 403, outcome: 'forbidden' }] };
    const options = { recordedSecurity: before, security: after };
    assert.deepEqual(run(recorded, recorded, [], options).securityChanges, [
        { path: 'csrf.guest POST /uPortal/api/layout', from: '401 unauthorized', to: '403 forbidden' },
    ]);
    assert.equal(run(recorded, recorded, [entry({ id: 'csrf-no-section', security: 'csrf.*' })], options).failed, true);
    const cited = entry({
        id: 'csrf',
        security: 'csrf.* /uPortal/api/*',
        to: '403 forbidden',
        log: 'MOD-I130',
        visible: true,
        upgrading: 'Servlet controllers are mapped by RequestMappingHandlerMapping',
    });
    assert.equal(run(recorded, recorded, [cited], options).failed, false);
});

test('an unregistered difference fails', () => {
    const recorded = [exchange('guest', '/uPortal/api/session.json', 200)];
    const actual = [exchange('guest', '/uPortal/api/session.json', 500)];
    const result = run(recorded, actual, []);
    assert.equal(result.failed, true);
    assert.equal(result.failures.length, 1);
});

test('a body that changed for two registered reasons needs an entry for every changed line', () => {
    const page = (outline) => response(200, null, { kind: 'html', outline });
    const recorded = [{ ...exchange('guest', '/uPortal/f/welcome/normal/render.uP', 200), response: page(['a#login[href=/cas/login]']) }];
    const actual = [{ ...exchange('guest', '/uPortal/f/welcome/normal/render.uP', 200), response: page(['a#login[href=/uPortal/p/login]', 'meta[name=_csrf]']) }];
    const login = entry({ id: 'login', path: '/uPortal/*', field: 'body', detail: 'a#login' });
    const csrf = entry({ id: 'csrf-meta', path: '/uPortal/*', field: 'body', detail: 'meta\\[name=_csrf' });
    assert.equal(run(recorded, actual, [login]).failed, true, 'one entry explains only some lines');
    const both = run(recorded, actual, [login, csrf]);
    assert.equal(both.failed, false);
    assert.deepEqual(
        both.intended.map((i) => i.entry.id),
        ['login', 'csrf-meta']
    );
});

test('"methods" and "status" limit an entry to the requests that answer that status now', () => {
    const recorded = [exchange('guest', '/uPortal/api/layout', 401), exchange('guest', '/uPortal/api/session.json', 401)];
    const actual = [exchange('guest', '/uPortal/api/layout', 403), exchange('guest', '/uPortal/api/session.json', 500)];
    recorded[0].method = actual[0].method = 'POST';
    const csrf = entry({ id: 'csrf', path: '/uPortal/api/*', methods: ['POST', 'PUT', 'PATCH', 'DELETE'], status: 403, field: '*' });
    const result = run(recorded, actual, [csrf]);
    assert.deepEqual(
        result.failures.map((f) => f.exchange.path),
        ['/uPortal/api/session.json']
    );
});

test('a matrix cell whose redirect now points at the login form needs its location change registered', () => {
    const recorded = [exchange('guest', '/uPortal/Login?userName=admin&password=wrong', 302, '/uPortal/f/welcome/normal/render.uP')];
    const actual = [exchange('guest', '/uPortal/Login?userName=admin&password=wrong', 302, '/uPortal/p/login')];
    assert.equal(run(recorded, actual, []).matrixChanges[0].registered, false);
    const form = entry({ id: 'form', path: '/uPortal/Login*', field: 'location', to: '/uPortal/p/login' });
    const result = run(recorded, actual, [form]);
    assert.equal(result.matrixChanges[0].registered, true);
    assert.equal(result.failed, false);
});
