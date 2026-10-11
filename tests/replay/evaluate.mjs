// The rules that decide whether a replay passes (docs/http-replay.md, "Rules"). replay.mjs feeds
// them a recording and a run; evaluate.check.mjs tests them with seeded violations.
//
//   1. No privilege gain: a request that 5.17 did not serve (401, 403, 404, 405, or a redirect to
//      the login) and that is served now (2xx) always fails. No registry entry can excuse it.
//   2. Lost access is a breaking change: a request that 5.17 served and that is not served now
//      fails unless a registry entry for its status names an UPGRADING-6.0.md section.
//   3. Entries that change what a user, admin or API client sees ("visible": true) name the
//      UPGRADING-6.0.md section adopters read about them in ("upgrading"), and that section exists.
//   4. A registry entry that matches nothing fails the run, unless it says where it applies
//      ("where", with a reason): an entry for one machine's tools does not apply in CI.
//   5. Every difference the registry does not list fails.
import { compare, outcome, renormalise } from './lib.mjs';

// Auth outcomes (lib.mjs outcome()) in which the portal did not serve the request
export const NOT_SERVED = new Set(['unauthorized', 'forbidden', 'not-found', 'method-not-allowed', 'redirect-to-login']);
export const SERVED = new Set(['allowed']);

export function globToRegExp(glob) {
    return new RegExp(`^${glob.replaceAll(/[.+?^${}()|[\]\\]/g, '\\$&').replaceAll('*', '.*')}$`);
}

/** Registry entries with a matcher and a use count; problems with the entries themselves are listed. */
export function loadRegistry(document, upgradingHeadings = null) {
    const problems = [];
    const entries = document.differences.map((entry) => {
        const id = entry.id ?? '(no id)';
        if (!entry.reason || !entry.log) problems.push(`${id}: every entry needs a "reason" and a "log" reference`);
        if (typeof entry.visible !== 'boolean') problems.push(`${id}: say whether users, admins or API clients see the change ("visible": true or false)`);
        if (entry.visible && !entry.upgrading) problems.push(`${id}: a visible change names its UPGRADING-6.0.md section ("upgrading")`);
        if (entry.upgrading && upgradingHeadings && !upgradingHeadings.has(entry.upgrading)) {
            problems.push(`${id}: UPGRADING-6.0.md has no section "${entry.upgrading}"`);
        }
        if (entry.where && !entry.whereReason) problems.push(`${id}: "where" needs a "whereReason"`);
        return {
            ...entry,
            used: 0,
            matches(exchange, difference) {
                if (!entry.path) return false;
                if (entry.roles && !entry.roles.includes(exchange.role)) return false;
                if (entry.method && entry.method !== exchange.method) return false;
                if (entry.set && entry.set !== exchange.set) return false;
                if (!globToRegExp(entry.path).test(exchange.path)) return false;
                if (entry.field !== '*' && !globToRegExp(entry.field).test(difference.field)) return false;
                if ('from' in entry && JSON.stringify(entry.from) !== JSON.stringify(difference.from)) return false;
                if ('to' in entry && JSON.stringify(entry.to) !== JSON.stringify(difference.to)) return false;
                if (entry.fromMatch && !new RegExp(entry.fromMatch).test(String(difference.from))) return false;
                if (entry.toMatch && !new RegExp(entry.toMatch).test(String(difference.to))) return false;
                // 'detail': a regular expression every changed line of a JSON or HTML body must match
                if (entry.detail) {
                    const pattern = new RegExp(entry.detail);
                    if (!difference.detail || !difference.detail.every((line) => pattern.test(line))) return false;
                }
                return true;
            },
        };
    });
    return { entries, problems };
}

/** The headings (## and deeper) of UPGRADING-6.0.md, without the hashes. */
export function headingsOf(markdown) {
    return new Set([...markdown.matchAll(/^#{2,6}\s+(.+?)\s*$/gm)].map((m) => m[1].replaceAll('`', '')));
}

function walkChanges(a, b, path, out) {
    if (JSON.stringify(a) === JSON.stringify(b)) return;
    if (a && b && typeof a === 'object' && typeof b === 'object' && !Array.isArray(a)) {
        for (const key of new Set([...Object.keys(a), ...Object.keys(b)])) walkChanges(a[key], b[key], `${path}.${key}`, out);
    } else {
        out.push({ path, from: a, to: b });
    }
}

/**
 * Compares a run with its recording.
 *   recorded, actual: exchanges; keyOf: their identity
 *   recordedMatrix, actualMatrix: role x route outcomes; recordedSecurity, security: the checks
 *   registry: from loadRegistry; selfCheck: a replay of the reference against itself, in which
 *   no registry entry is expected to match
 */
export function evaluate({ recorded, actual, keyOf, recordedMatrix, actualMatrix, recordedSecurity, security, registry, selfCheck = false }) {
    const expectedByKey = new Map(recorded.map((e) => [keyOf(e), e]));
    const failures = [];
    const intended = [];
    const privilegeGains = [];
    const lostAccess = [];
    let compared = 0;
    for (const exchange of actual) {
        const key = keyOf(exchange);
        const before = expectedByKey.get(key);
        if (!before) {
            failures.push({ exchange, differences: [{ field: 'fixture', from: null, to: 'not recorded (re-record after changing routes.json)' }] });
            continue;
        }
        compared++;
        expectedByKey.delete(key);
        // The masks and sorting rules apply to the recording too, so a rule added later needs no re-record
        const expectedResponse = renormalise(before.response, before.path);
        const from = outcome(expectedResponse);
        const to = outcome(exchange.response);
        const unexplained = [];
        for (const difference of compare(expectedResponse, exchange.response)) {
            const entry = registry.entries.find((r) => r.matches(exchange, difference));
            if (entry) {
                entry.used++;
                intended.push({ exchange, difference, entry });
            } else {
                unexplained.push(difference);
            }
        }
        // Rule 1: no registry entry excuses a request that is served now and was not before
        if (NOT_SERVED.has(from) && SERVED.has(to)) {
            privilegeGains.push({ exchange, from: `${expectedResponse.status} ${from}`, to: `${exchange.response.status} ${to}` });
        }
        // Rule 2: lost access needs a status entry that names its UPGRADING-6.0.md section
        if (SERVED.has(from) && NOT_SERVED.has(to)) {
            const excused = intended.some((i) => i.exchange === exchange && i.difference.field === 'status' && i.entry.upgrading);
            if (!excused) lostAccess.push({ exchange, from: `${expectedResponse.status} ${from}`, to: `${exchange.response.status} ${to}` });
        }
        if (unexplained.length > 0) failures.push({ exchange, differences: unexplained, recorded: before });
    }

    // The security matrix: every cell keeps its outcome unless its status change is registered
    const matrixChanges = [];
    for (const [route, cells] of Object.entries(recordedMatrix)) {
        for (const [role, cell] of Object.entries(cells)) {
            const now = actualMatrix[route]?.[role] ?? '(not requested)';
            if (now === cell) continue;
            const [method, ...path] = route.split(' ');
            const registered = intended.some(
                (i) =>
                    i.exchange.set === 'crawl' &&
                    i.exchange.role === role &&
                    i.exchange.method === method &&
                    i.exchange.path === path.join(' ') &&
                    i.difference.field === 'status',
            );
            const gain = NOT_SERVED.has(cell.split(' ').slice(1).join(' ')) && SERVED.has(now.split(' ').slice(1).join(' '));
            matrixChanges.push({ route, role, from: cell, to: now, registered: registered && !gain, gain });
        }
    }

    // Logins, CSRF and the header snapshot. A CSRF change needs an entry that names its
    // UPGRADING-6.0.md section, like any other change in what clients may do.
    const securityChanges = [];
    for (const part of ['logins', 'loginCookies', 'headers', 'csrf']) walkChanges(recordedSecurity[part], security[part], part, securityChanges);
    const securityFailures = securityChanges.filter((change) => {
        const entry = registry.entries.find(
            (r) => r.security && globToRegExp(r.security).test(change.path) && (!('to' in r) || JSON.stringify(r.to) === JSON.stringify(change.to)),
        );
        if (!entry) return true;
        entry.used++;
        return change.path.startsWith('csrf') && !entry.upgrading;
    });

    // Rule 4: entries that matched nothing, unless they say where they apply
    const stale = selfCheck ? [] : registry.entries.filter((r) => r.used === 0 && !r.where);
    const unusedElsewhere = selfCheck ? [] : registry.entries.filter((r) => r.used === 0 && r.where);

    const failed =
        failures.length > 0 ||
        privilegeGains.length > 0 ||
        lostAccess.length > 0 ||
        matrixChanges.some((c) => !c.registered) ||
        securityFailures.length > 0 ||
        stale.length > 0 ||
        registry.problems.length > 0;
    return {
        failed,
        compared,
        failures,
        intended,
        privilegeGains,
        lostAccess,
        matrixChanges,
        securityChanges,
        securityFailures,
        stale,
        unusedElsewhere,
        missing: [...expectedByKey.values()],
        problems: registry.problems,
    };
}
