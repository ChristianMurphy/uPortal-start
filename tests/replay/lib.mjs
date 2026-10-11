// Shared code of the HTTP differential replay (docs/http-replay.md): an HTTP session with a cookie
// jar, the login helpers, and the normalisers that turn a response into the host-neutral, masked
// form that is stored in tests/replay/fixtures/ and compared on every replay.
//
// The recorder and the replayer both normalise with this file, so a change to a normaliser
// changes what is compared: bump NORMALISER_VERSION and re-record (see docs/http-replay.md).
import { createHash } from 'node:crypto';

export const NORMALISER_VERSION = 2;

// The quickstart roles, each with its local account (data/base/user, data/quickstart/user; the
// password of every quickstart account is its user name). Guest is the anonymous session.
export const ROLES = ['guest', 'student', 'staff', 'faculty', 'admin'];

// Every local account in the 5.17 data that has a password; all are stored as uPortal's salted
// "(MD5)" hash. Each must still log in with its password and be refused with a wrong one.
export const LOCAL_ACCOUNTS = ['admin', 'student', 'staff', 'faculty', 'developer'];

// ---------------------------------------------------------------------------------------------
// HTTP session
// ---------------------------------------------------------------------------------------------

/** A sequence of requests that shares cookies, like one browser; never follows redirects itself. */
export class Session {
    constructor(origin) {
        this.origin = origin.replace(/\/$/, '');
        this.jar = new Map();
    }

    cookieHeader(path) {
        const pairs = [];
        for (const cookie of this.jar.values()) {
            if (path.startsWith(cookie.path)) pairs.push(`${cookie.name}=${cookie.value}`);
        }
        return pairs.join('; ');
    }

    store(setCookies, requestPath) {
        for (const header of setCookies) {
            const [pair, ...attributes] = header.split(';');
            const eq = pair.indexOf('=');
            const name = pair.slice(0, eq).trim();
            const value = pair.slice(eq + 1).trim();
            let path = requestPath.replace(/\/[^/]*$/, '') || '/';
            let expired = false;
            for (const attribute of attributes) {
                const [key, attributeValue = ''] = attribute.split('=');
                const lower = key.trim().toLowerCase();
                if (lower === 'path') path = attributeValue.trim();
                if (lower === 'max-age' && Number(attributeValue) <= 0) expired = true;
                if (lower === 'expires' && Date.parse(attributeValue) < Date.now()) expired = true;
            }
            const key = `${name}|${path}`;
            if (expired || value === '') this.jar.delete(key);
            else this.jar.set(key, { name, value, path });
        }
    }

    /** Sends one request; returns { status, headers, setCookies, body (Buffer) } or { status: 0, error }. */
    async send(method, path, { body, headers = {} } = {}) {
        const url = new URL(path, `${this.origin}/`);
        const requestHeaders = { 'user-agent': 'uportal-http-replay', 'accept-language': 'en-US', ...headers };
        const cookie = this.cookieHeader(url.pathname);
        if (cookie) requestHeaders.cookie = cookie;
        try {
            const response = await fetch(url, { method, headers: requestHeaders, body, redirect: 'manual', signal: AbortSignal.timeout(60_000) });
            const setCookies = response.headers.getSetCookie();
            this.store(setCookies, url.pathname);
            const buffer = Buffer.from(await response.arrayBuffer());
            return { status: response.status, headers: response.headers, setCookies, body: buffer };
        } catch (error) {
            return { status: 0, error: String(error.cause ?? error), headers: new Headers(), setCookies: [], body: Buffer.alloc(0) };
        }
    }

    /** Sends a GET and follows redirects (login flows only); returns the last response and the hops. */
    async follow(path, options = {}, hops = 10) {
        let response = await this.send('GET', path, options);
        const visited = [path];
        while (response.status >= 300 && response.status < 400 && response.headers.get('location') && visited.length <= hops) {
            const next = new URL(response.headers.get('location'), `${this.origin}${visited.at(-1)}`);
            const local = `${next.pathname}${next.search}`;
            visited.push(local);
            response = await this.send('GET', local);
        }
        return { response, visited };
    }
}

/** Logs a session in through uPortal's local login (/uPortal/Login?userName=&password=). */
export async function login(session, username, password = username) {
    const query = new URLSearchParams({ userName: username, password });
    const { response } = await session.follow(`/uPortal/Login?${query}`);
    return { status: response.status, ok: (await currentUser(session)) === username };
}

/** The user name the portal has for this session (guest when nobody is logged in). */
export async function currentUser(session) {
    const response = await session.send('GET', '/uPortal/api/session.json');
    try {
        return JSON.parse(response.body.toString('utf8')).person?.userName ?? null;
    } catch {
        return null;
    }
}

/** A fresh session for a role: guest stays anonymous, the others log in. */
export async function sessionFor(origin, role) {
    const session = new Session(origin);
    if (role === 'guest') {
        // Starting a guest session the way a browser does keeps guest exchanges independent of
        // whether the first crawled URL happens to create the session.
        await session.follow('/uPortal/');
        return session;
    }
    const result = await login(session, role);
    if (!result.ok) throw new Error(`Could not log in as ${role} (status ${result.status})`);
    return session;
}

// ---------------------------------------------------------------------------------------------
// Masks. Every value replaced here differs between two runs of the same build, so comparing it
// would only report noise. Each mask states why it is safe.
// ---------------------------------------------------------------------------------------------

// Every mask and sorting rule below says what showed that 5.17 itself varies there ("Seen:").
// The runs named are: the local stand-in's self-checks on 2026-10-10 and 2026-10-11 (5.17.9 on
// Tomcat 8.5, replayed against its own recording after a reset), the reference recorded from
// master in CI (runs 38096550769 and later) compared with the stand-in, and CI replay run
// 38100658549. "By construction" means the value is random or the time by design, so no run was
// needed. docs/http-replay.md lists what the masks hide ("Unreported changes").
const STRING_MASKS = [
    // Generated ids. uPortal imports the files of one entity type in parallel, in the order the
    // file system lists them (JaxbPortalDataHandlerService with ConcurrentDirectoryScanner), so
    // user, group, portlet and portlet-type ids differ from machine to machine. The node part of a
    // layout node id (l1n210) comes from the fragment's data; the user part (u26) does not.
    // Inside generated names such as rateThisPortletu26l1n7 the whole id varies (the node is the
    // one the marketplace subscribes the portlet to), so all of it is masked there.
    // Seen: 5.17.9 recorded in CI had u26l1s200 where the stand-in had u22l1s200 for the same
    // fragment; CI run 38100658549 failed on it.
    [/(?<=[A-Za-z])(u\d+l\d+[ns]\d+|ctf\d+)(?!\d)/g, '{node}'],
    [/u\d+(l\d+[ns]\d+)(?!\d)/g, 'u{id}$1'],
    // Pluto namespaces carry the portlet entity and window ids: Pluto_43_u26l1n210_11_
    // Seen: Pluto_43 in the CI recording, Pluto_46 on the stand-in, same portlet.
    [/\bPluto_\d+_/g, 'Pluto_{id}_'],
    [/(l\d+n\d+|ctf\{n\})_\d+_/g, '$1_{id}_'],
    // group keys (local.14), principal keys (12.local.14) and portlet ids (PORTLET_ID.25)
    // Seen: local.14 in the CI recording, local.21 on the stand-in for the same category.
    [/\blocal\.\d+/g, 'local.{id}'],
    [/\bPORTLET_ID\.\d+/g, 'PORTLET_ID.{id}'],
    [/_local__\d+/g, '_local__{id}'],
    // error portlet namespaces (Pluto_..._-20_ctf3_12-). Seen: -3 and -20 in two CI runs of 5.17.
    [/_-\d+_ctf\{n\}_\d+-/g, '_-{id}_ctf{n}_{id}-'],
    // the entity type in a principal key (12.local.3, 13.pags.Authenticated Users)
    // Seen: 13.local.20 in the CI recording, 12.local.x on the stand-in.
    [/\b\d+\.(local|pags)\./g, '{type}.$1.'],
    // Session ids are random per session (Tomcat's SecureRandom); URL rewriting embeds them.
    // By construction.
    [/(;jsessionid=)[0-9A-Za-z._-]+/gi, '$1{session}'],
    [/(JSESSIONID=)[0-9A-Za-z._-]+/g, '$1{session}'],
    // CAS tickets (service, proxy-granting, login) are random and single-use. By construction.
    [/\b(ST|PT|PGT|PGTIOU|TGT|LT)-\d+-[0-9A-Za-z-]+(-cas)?/g, '$1-{ticket}'],
    // CAS 3.6 login flow execution keys are encrypted, random blobs. By construction.
    [/(execution=)[0-9a-f-]{8,}_[0-9A-Za-z+/=%_-]+/g, '$1{execution}'],
    // UUIDs are generated (analytics event ids, request ids, CSRF tokens in some forms).
    // By construction (UUID.randomUUID); the CSRF token in action URLs is one.
    [/[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}\b/gi, '{uuid}'],
    // Transient portlet subscribe ids (search.ctf1) count up per session in the order portlets are
    // first rendered, and portlets render on parallel worker threads.
    // Seen: search.ctf1 and search.ctf2 for faculty in the stand-in's self-check on 2026-10-10.
    [/(?<![A-Za-z])ctf\d+(?=\b|_)/g, 'ctf{n}'],
    // The portal's own host and port, also inside other URLs (CAS service=, encoded or not)
    // By construction: each run chooses its port (8080 in CI, 8180 for the stand-in).
    [/https?:\/\/(localhost|127\.0\.0\.1)(:\d+)?/g, '{origin}'],
    [/https?%3A%2F%2F(localhost|127\.0\.0\.1)(%3A\d+)?/gi, '{origin}'],
    // Aggregated skin resources are named by a hash of their content, which changes with every
    // build that changes a skin script; the page outline still shows which aggregates load.
    // Not a 5.17 variation: the name follows the build, so this is a blind spot by design.
    [/[\w-]{22}\.aggr\.min\.(js|css)\b/g, '{content-hash}.aggr.min.$1'],
    // jQuery's cache-busting `_=<epoch ms>` parameter and other epoch-millisecond values in URLs
    // are the time of the request. By construction.
    [/([?&]_=)\d{10,13}/g, '$1{epoch-ms}'],
];

// Date and time strings keep their shape (every digit becomes 9), so a changed format is still
// reported while the value, which is the time of the request, is not. HTTP dates (RFC 9110
// IMF-fixdate, with a weekday that changes at midnight) become {http-date}; a date in another
// format does not match and still shows. By construction (the time of the request or of the
// data import). Seen for HTTP dates: Sat and Sun for the same Expires header in the stand-in's
// self-check across midnight on 2026-10-11.
const DATE_TIME = /\b\d{4}-\d{2}-\d{2}([T ]\d{2}:\d{2}(:\d{2}(\.\d+)?)?(Z|[+-]\d{2}:?\d{2})?)?\b/g;
const HTTP_DATE = /\b(Mon|Tue|Wed|Thu|Fri|Sat|Sun), \d{2} [A-Z][a-z]{2} \d{4} \d{2}:\d{2}:\d{2} GMT\b/g;
const shape = (text) => text.replaceAll(/\d/g, '9');

export function maskString(text) {
    // Some masks only match after others have run (ctf12_20_ needs ctf{n} first), so the masks
    // are applied until nothing changes: masking once more must not change a masked value.
    let masked = text;
    for (let previous = null; previous !== masked; ) {
        previous = masked;
        for (const [pattern, replacement] of STRING_MASKS) masked = masked.replace(pattern, replacement);
    }
    // JAXB writes no fraction when the milliseconds are zero, so whether there is one depends on
    // the time. In ISO timestamps with a T (xsd:dateTime) the fraction's presence is therefore not
    // compared; other formats, such as the portlet-list audit dates, keep it strict.
    // Seen: a portlet's PUBLISHED date in an entity export with and without its fraction in two
    // local runs on 2026-10-11.
    masked = masked.replace(DATE_TIME, (match) => (match.includes('T') ? shape(match).replace(/(99:99:99)(?!\.)/, '$1.999') : shape(match)));
    masked = masked.replace(HTTP_DATE, '{http-date}');
    return masked;
}

/** Makes an absolute URL on the portal host relative and masks volatile parts. */
export function normaliseUrl(url, origin) {
    let text = url;
    if (origin && text.startsWith(origin)) text = text.slice(origin.length);
    text = text.replace(/^https?:\/\/(localhost|127\.0\.0\.1)(:\d+)?/, '{origin}');
    return maskString(text);
}

// ---------------------------------------------------------------------------------------------
// Response normalisation
// ---------------------------------------------------------------------------------------------

// Headers compared on every exchange. Date, Content-Length, Server and Keep-Alive are left out:
// the first is the time, the others follow from the body and the connection.
const COMPARED_HEADERS = [
    'content-type',
    'content-encoding',
    'content-disposition',
    'content-language',
    'cache-control',
    'pragma',
    'expires',
    'last-modified',
    'etag',
    'vary',
    'allow',
    'www-authenticate',
    'access-control-allow-origin',
    'access-control-allow-credentials',
    // security headers
    'x-frame-options',
    'x-content-type-options',
    'x-xss-protection',
    'strict-transport-security',
    'content-security-policy',
    'content-security-policy-report-only',
    'referrer-policy',
    'permissions-policy',
    'cross-origin-opener-policy',
    'cross-origin-embedder-policy',
    'cross-origin-resource-policy',
];

export const SECURITY_HEADERS = COMPARED_HEADERS.slice(COMPARED_HEADERS.indexOf('x-frame-options'));

function normaliseHeaderValue(name, value) {
    // ETags are hashes: of the body for /api (ShallowEtagHeaderFilter), so they follow every masked
    // value in it, or of the size and modification time of a deployed file. Only whether the tag
    // is weak and how long its hash is are compared; the body is compared on its own.
    // Seen: /api/v5-1/userinfo and the entity exports changed ETags in the stand-in's self-check.
    if (name === 'etag') {
        if (value.includes('{hash')) return value;
        return value.includes('"') ? value.replace(/"[^"]*"/, (tag) => `"{hash:${tag.length - 2}}"`) : '{hash}';
    }
    return maskString(value);
}

/** Set-Cookie: the name, the attributes, and whether the value is empty; never the value. */
export function normaliseCookie(header) {
    const [pair, ...attributes] = header.split(';');
    const eq = pair.indexOf('=');
    const cookie = { name: pair.slice(0, eq).trim(), value: pair.slice(eq + 1).trim() === '' ? 'empty' : 'set' };
    for (const attribute of attributes) {
        const [key, value] = attribute.split('=');
        const lower = key.trim().toLowerCase();
        if (!lower) continue;
        // Expires is a time; keep only its presence. Max-Age and Path are configuration.
        if (lower === 'expires') cookie.expires = 'set';
        else if (value === undefined) cookie[lower] = true;
        else cookie[lower] = lower === 'domain' ? '{host}' : value.trim();
    }
    return cookie;
}

const sortCookies = (cookies) => cookies.sort((a, b) => `${a.name}|${a.path}`.localeCompare(`${b.name}|${b.path}`));

/** Turns a raw response into the comparable, fixture form. */
export function normaliseResponse(response, origin, path = '') {
    if (response.status === 0) return { status: 0, error: response.error.replaceAll(/\d+/g, '9') };
    const normalised = { status: response.status };
    const location = response.headers.get('location');
    if (location) normalised.location = normaliseUrl(location, origin);
    const headers = {};
    for (const name of COMPARED_HEADERS) {
        const value = response.headers.get(name);
        if (value !== null) headers[name] = normaliseHeaderValue(name, value);
    }
    normalised.headers = headers;
    if (response.setCookies.length > 0) normalised.cookies = sortCookies(response.setCookies.map((c) => normaliseCookie(c)));
    normalised.body = normaliseBody(response.body, headers['content-type'] ?? '', origin, path);
    return normalised;
}

// ---------------------------------------------------------------------------------------------
// Bodies
// ---------------------------------------------------------------------------------------------

const MAX_JSON = 100_000;
const hash = (buffer) => createHash('sha256').update(buffer).digest('hex').slice(0, 16);

export function normaliseBody(buffer, contentType, origin, path = '') {
    if (buffer.length === 0) return { kind: 'empty' };
    const type = contentType.toLowerCase();
    const text = () => buffer.toString('utf8');
    if (type.includes('application/jwt')) return normaliseJwt(text(), origin);
    if (type.includes('json') || (/^\s*[[{]/.test(text().slice(0, 64)) && !type.includes('html'))) {
        try {
            const value = unorder(maskJson(JSON.parse(text()), origin), path);
            const serialised = JSON.stringify(value);
            if (serialised.length > MAX_JSON) return { kind: 'json-shape', shape: jsonShape(value), sha: hash(serialised) };
            return { kind: 'json', value };
        } catch {
            // not JSON after all; fall through
        }
    }
    // An error page can come with the content type of the API it replaces (a 500 from a JSON route)
    const looksHtml = /^\s*(<!--[\s\S]*?-->\s*)*<(!doctype html|html)/i.test(text().slice(0, 4096));
    if (type.includes('html') || looksHtml) return { kind: 'html', outline: htmlOutline(text(), origin) };
    // Entity exports are XML without a Content-Type; they are text as far as masks go.
    const xml = /^\s*<\?xml/.test(text().slice(0, 64));
    if (xml || type.startsWith('text/') || type.includes('xml') || type.includes('javascript')) {
        const masked = maskString(text()).replaceAll(origin ?? '\0', '{origin}');
        return { kind: 'text', length: lengthBucket(masked.length), sha: hash(masked) };
    }
    return { kind: 'binary', length: lengthBucket(buffer.length), sha: hash(buffer) };
}

// A signed token (/api/v5-1/userinfo) differs on every request: it is issued now, expires later,
// and is signed. Its header and claims are compared, with the times and the signature masked.
// Seen: a different token on every request in the stand-in's self-check.
const JWT_TIMES = new Set(['iat', 'exp', 'nbf', 'auth_time']);

function normaliseJwt(token, origin) {
    const [header, claims] = token
        .trim()
        .split('.')
        .slice(0, 2)
        .map((part) => {
            try {
                return JSON.parse(Buffer.from(part, 'base64url').toString('utf8'));
            } catch {
                return null;
            }
        });
    if (!header || !claims) return { kind: 'text', length: lengthBucket(token.length), sha: hash(token) };
    const masked = Object.fromEntries(
        Object.entries(claims).map(([k, v]) => [k, JWT_TIMES.has(k) && typeof v === 'number' ? '{epoch-s:number}' : k === 'jti' ? '{id}' : v]),
    );
    return { kind: 'json', value: { jwtHeader: maskJson(header, origin), jwtClaims: maskJson(masked, origin) } };
}

// Arrays that 5.17 itself returns in a different order from run to run, because they are built
// from hash sets: they are sorted before they are compared. Found by replaying 5.17 against
// itself. A '*' step walks every element of an array; inner arrays are sorted first.
const UNORDERED = [
    // the current user's groups (GroupRESTController, a Set of entity groups)
    // Seen: Guests and All Users swapped places in the stand-in's self-check on 2026-10-10.
    [/^\/uPortal\/api\/groups/, ['groups']],
    // permission assignments (PermissionsListController, from a Set)
    // Seen: Portal Administrators and Portal Developers swapped in the same self-check.
    [/^\/uPortal\/api\/permissionAssignments/, ['permissionsList']],
    // a group's members (EntitiesRESTController, a Set of children)
    // Seen: Tenants and Staff swapped in the same self-check.
    [/^\/uPortal\/api\/entities\//, ['jsonEntityBean', 'children']],
    // entity search results (EntitiesRESTController, a Set filtered by @PostFilter)
    // Seen: admin-lo and tenant-admin-lo swapped in a self-check of the current build.
    [/^\/uPortal\/api\/entities\.json/, ['jsonEntityBeanList']],
    // marketplace entries and their categories (MarketplaceRESTController, Sets)
    // Seen: the entries' order changed in every self-check.
    [/^\/uPortal\/api\/marketplace\/entries/, ['portlets', '*', 'categories']],
    [/^\/uPortal\/api\/marketplace\/entries/, ['portlets']],
    // the portlet lists a user can see (PortletListRESTController); lists created in the same
    // second have no fixed order. Seen: admin's two lists swapped in the stand-in's last pass.
    [/^\/uPortal\/api\/portlet-list\/(\?|$)/, []],
];

// Values that 5.17 itself returns differently from run to run for the same data.
const UNSTABLE = [
    // PermissionsListController names a target by its key alone, so a group (local.25) and a
    // portlet (PORTLET_ID.25) with the same number can get each other's name. See
    // docs/developer/modernization/notes/http-replay.md. Seen: target local.25 named
    // "Demonstration" in one self-check and "Toggle Resources Aggregation" in the next.
    [/^\/uPortal\/api\/permissionAssignments/, ['permissionsList', '*', 'targetName']],
    // MarketplacePortletDefinition.getRandomSamplingRelatedPortlets shuffles on purpose; only how
    // many related portlets there are is compared. Seen: by construction (Collections.shuffle),
    // and in every self-check.
    [/^\/uPortal\/api\/marketplace\/entries/, ['portlets', '*', 'relatedPortlets']],
    [/^\/uPortal\/api\/marketplace\/entry\//, ['relatedPortlets']],
    // The calendar demo's events are placed relative to today, and the suite asks for the day it
    // ran on, so the whole answer depends on the day of the run. Seen: recorded on 2026-10-10,
    // replayed on 2026-10-11, the events moved.
    [/\/p\/calendar\.[^/]*\/[^/]+\/[^/]*\.resource\.uP/, []],
];

function visit(node, keys, action) {
    if (node === null || typeof node !== 'object') return;
    const [key, ...rest] = keys;
    const children = key === '*' ? (Array.isArray(node) ? node.keys() : []) : [key];
    for (const child of children) {
        if (rest.length === 0) {
            if (child in node) node[child] = action(node[child]);
        } else {
            visit(node[child], rest, action);
        }
    }
}

const sortArray = (array) => (Array.isArray(array) ? array.toSorted((a, b) => JSON.stringify(a).localeCompare(JSON.stringify(b))) : array);

export function unorder(value, path) {
    // Idempotent, because the recording, already masked, goes through this again when compared
    const replace = (v) => {
        if (typeof v === 'string' && v.startsWith('{unstable')) return v;
        return Array.isArray(v) ? `{unstable:${v.length} items}` : '{unstable}';
    };
    let result = value;
    for (const [pattern, keys] of UNSTABLE) {
        if (!pattern.test(path)) continue;
        if (keys.length === 0) result = replace(result);
        else visit(result, keys, replace);
    }
    for (const [pattern, keys] of UNORDERED) {
        if (!pattern.test(path)) continue;
        // An empty key list means the document itself is the array
        if (keys.length === 0) result = sortArray(result);
        else visit(result, keys, sortArray);
    }
    return result;
}

// Lengths are compared in buckets of 64 bytes: a changed byte count from a different build date
// in a comment should not hide behind a hash change alone, and the hash already decides equality.
const lengthBucket = (length) => Math.ceil(length / 64) * 64;

// A number between 2000-01-01 and 2100-01-01 in milliseconds is a timestamp: the time of the
// request or of the data import. Its type is kept so a change to a string format is reported.
const EPOCH_MS_MIN = 946_684_800_000;
const EPOCH_MS_MAX = 4_102_444_800_000;

// Keys whose values are measurements or random per session, not data: the health checks'
// response times and memory figures, and the session key and host name in /api/session.json.
// Seen: the timings and memory in every self-check; the session key in the stand-in's
// self-check; the host name in the CI recording (a runner's name) against the stand-in (vm).
const MEASUREMENT = /Response Time|Memory|^sessionKey$|^serverName$/;
// Keys whose numeric values are generated ids (see the generated ids in STRING_MASKS)
// Seen: portlet id 80 and type id 3 in the CI recording, 69 and 4 on the stand-in.
const ID_KEYS = /^(id|chanID|channelId|typeId|typeID|fragment|portletId|entityTypeId)$/;

export function maskJson(value, origin) {
    if (Array.isArray(value)) {
        const masked = value.map((v) => maskJson(v, origin));
        // 5.17 orders many lists (portlets, categories, groups, layout nodes from fragments) by
        // generated ids, which differ from machine to machine, so the order of objects in an
        // array is not compared. Arrays of plain values keep their order.
        // Seen: CI run 38100658549, where the registry's categories and the layout's regions came
        // in another order than in the recording from master.
        return masked.every((v) => v && typeof v === 'object') ? sortArray(masked) : masked;
    }
    if (value && typeof value === 'object') {
        const sorted = {};
        for (const key of Object.keys(value).sort()) {
            const v = value[key];
            // (a value masked before stays as it is: the recording is masked again when compared)
            if (typeof v === 'string' && /^\{(measured|id):/.test(v)) sorted[key] = v;
            else if (MEASUREMENT.test(key) && (typeof v === 'number' || typeof v === 'string')) sorted[key] = `{measured:${typeof v}}`;
            else if (ID_KEYS.test(key) && (typeof v === 'number' || (typeof v === 'string' && /^\d+$/.test(v)))) sorted[key] = `{id:${typeof v}}`;
            else sorted[key] = maskJson(v, origin);
        }
        return sorted;
    }
    if (typeof value === 'number' && Number.isInteger(value) && value >= EPOCH_MS_MIN && value <= EPOCH_MS_MAX) {
        return '{epoch-ms:number}';
    }
    if (typeof value === 'string') return origin ? normaliseUrl(value, origin).replaceAll(origin, '{origin}') : maskString(value);
    return value;
}

/** The structure of a large JSON document: keys and value types, arrays reduced to their first item. */
function jsonShape(value) {
    if (Array.isArray(value)) return value.length === 0 ? [] : [jsonShape(value[0]), `x${value.length}`];
    if (value && typeof value === 'object') {
        return Object.fromEntries(Object.keys(value).map((key) => [key, jsonShape(value[key])]));
    }
    return typeof value;
}

// ---------------------------------------------------------------------------------------------
// HTML outline: the elements a page is built from, without text that is not a heading or label
// ---------------------------------------------------------------------------------------------

const VOID_ELEMENTS = new Set(['area', 'base', 'br', 'col', 'embed', 'hr', 'img', 'input', 'link', 'meta', 'param', 'source', 'track', 'wbr']);
const RAW_TEXT = new Set(['script', 'style', 'textarea', 'title']);
// Always part of the outline, with or without an id
const LANDMARKS = new Set([
    'title', 'h1', 'h2', 'h3', 'h4', 'form', 'input', 'select', 'textarea', 'button', 'nav', 'main',
    'header', 'footer', 'section', 'iframe', 'table', 'meta', 'link', 'script', 'body', 'html', 'head',
]);
// Elements whose text is part of the outline
const TEXT_ELEMENTS = new Set(['title', 'h1', 'h2', 'h3', 'h4', 'button']);
const KEPT_ATTRIBUTES = ['name', 'type', 'method', 'action', 'rel', 'src', 'href', 'http-equiv', 'role'];
const CLASS_HINT = /portlet|region|up-|layout|column|tab|nav|login|error/i;
const TAG =
    /<!--[\s\S]*?-->|<!\[CDATA\[[\s\S]*?]]>|<![^>]*>|<\?[^>]*>|<\/\s*([A-Za-z][\w:-]*)\s*>|<([A-Za-z][\w:-]*)((?:\s+[^\s=/>]+(?:\s*=\s*(?:"[^"]*"|'[^']*'|[^\s>]+))?)*)\s*(\/?)>/g;
const ATTRIBUTE = /([^\s=/>]+)(?:\s*=\s*(?:"([^"]*)"|'([^']*)'|([^\s>]+)))?/g;

export function parseHtml(html) {
    const root = { tag: '#root', attributes: {}, children: [], text: '' };
    const stack = [root];
    TAG.lastIndex = 0;
    let match;
    while ((match = TAG.exec(html)) !== null) {
        const [, closing, opening, attributeText = '', selfClosing] = match;
        if (closing) {
            const tag = closing.toLowerCase();
            const index = stack.findLastIndex((node) => node.tag === tag);
            if (index > 0) stack.length = index;
            continue;
        }
        if (!opening) continue;
        const tag = opening.toLowerCase();
        const attributes = {};
        ATTRIBUTE.lastIndex = 0;
        let attribute;
        while ((attribute = ATTRIBUTE.exec(attributeText)) !== null) {
            attributes[attribute[1].toLowerCase()] = attribute[2] ?? attribute[3] ?? attribute[4] ?? '';
        }
        const node = { tag, attributes, children: [], text: '' };
        stack.at(-1).children.push(node);
        if (RAW_TEXT.has(tag)) {
            const end = html.toLowerCase().indexOf(`</${tag}`, TAG.lastIndex);
            const stop = end === -1 ? html.length : end;
            node.text = html.slice(TAG.lastIndex, stop);
            TAG.lastIndex = stop;
            continue;
        }
        if (TEXT_ELEMENTS.has(tag)) {
            const end = html.toLowerCase().indexOf(`</${tag}`, TAG.lastIndex);
            if (end !== -1) node.text = html.slice(TAG.lastIndex, end).replaceAll(/<[^>]*>/g, ' ');
        }
        if (!selfClosing && !VOID_ELEMENTS.has(tag)) stack.push(node);
    }
    return root;
}

const collapse = (text) => text.replaceAll(/\s+/g, ' ').trim().slice(0, 80);

function describe(node, origin) {
    let line = node.tag;
    const { id, class: className = '' } = node.attributes;
    if (id) line += `#${maskString(id)}`;
    const classes = className.split(/\s+/).filter(Boolean).sort();
    if (classes.length > 0) line += `.${classes.join('.')}`;
    for (const name of KEPT_ATTRIBUTES) {
        if (!(name in node.attributes)) continue;
        let value = node.attributes[name];
        if (['action', 'src', 'href'].includes(name)) {
            // Keep the path and the parameter names; values are often generated (layout node
            // ids, flow execution keys, cache-busting versions are kept but masked as above).
            value = normaliseUrl(value.replaceAll('&amp;', '&'), origin).replace(
                /\?.*$/,
                (query) => `?${[...new URLSearchParams(query.slice(1)).keys()].sort().join('&')}`,
            );
        }
        line += `[${name}=${value}]`;
    }
    if (node.tag === 'meta') {
        const name = node.attributes.name ?? node.attributes.property;
        if (name) line += `[meta=${name}]`;
    }
    if (TEXT_ELEMENTS.has(node.tag) && node.text) line += ` "${collapse(node.text)}"`;
    // Classes and names carry generated ids too (rateThisPortletu26l1n9, Pluto_43_..._optionsForm)
    return maskString(line);
}

function keep(node) {
    if (LANDMARKS.has(node.tag)) {
        // Only external scripts and stylesheets: inline scripts have no stable identity.
        if (node.tag === 'script') return 'src' in node.attributes;
        if (node.tag === 'link') return node.attributes.rel === 'stylesheet';
        if (node.tag === 'meta') return 'name' in node.attributes || 'http-equiv' in node.attributes;
        if (node.tag === 'input') return node.attributes.type !== 'hidden' || 'name' in node.attributes;
        return true;
    }
    return 'id' in node.attributes || CLASS_HINT.test(node.attributes.class ?? '');
}

/** The outline of a page: one line per kept element, indented by its kept ancestors. */
export function htmlOutline(html, origin) {
    const lines = [];
    const walk = (node, depth) => {
        for (const child of node.children) {
            if (keep(child)) {
                lines.push(`${'  '.repeat(depth)}${describe(child, origin)}`);
                walk(child, depth + 1);
            } else {
                walk(child, depth);
            }
        }
    };
    walk(parseHtml(html), 0);
    return lines;
}

// ---------------------------------------------------------------------------------------------
// Comparison
// ---------------------------------------------------------------------------------------------

const stable = (value) => JSON.stringify(value);

/** Lists the differences between an expected and an actual normalised response. */
export function compare(expected, actual) {
    const differences = [];
    const add = (field, from, to, detail) => differences.push({ field, from, to, ...(detail ? { detail } : {}) });
    if (expected.status !== actual.status) add('status', expected.status, actual.status);
    if ((expected.location ?? null) !== (actual.location ?? null)) add('location', expected.location ?? null, actual.location ?? null);
    const headerNames = new Set([...Object.keys(expected.headers ?? {}), ...Object.keys(actual.headers ?? {})]);
    for (const name of [...headerNames].sort()) {
        const from = expected.headers?.[name] ?? null;
        const to = actual.headers?.[name] ?? null;
        if (from !== to) add(`header:${name}`, from, to);
    }
    const cookieKey = (c) => `${c.name}|${c.path ?? ''}`;
    const expectedCookies = new Map((expected.cookies ?? []).map((c) => [cookieKey(c), c]));
    const actualCookies = new Map((actual.cookies ?? []).map((c) => [cookieKey(c), c]));
    for (const key of [...new Set([...expectedCookies.keys(), ...actualCookies.keys()])].sort()) {
        const from = expectedCookies.get(key) ?? null;
        const to = actualCookies.get(key) ?? null;
        if (stable(from) !== stable(to)) add(`cookie:${key.split('|')[0]}`, from, to);
    }
    compareBody(expected.body, actual.body, add);
    return differences;
}

function compareBody(expected, actual, add) {
    if (!expected || !actual) return;
    if (expected.kind !== actual.kind) {
        add('body', expected.kind, actual.kind);
        return;
    }
    if (expected.kind === 'json') {
        const paths = [];
        jsonDiff(expected.value, actual.value, '$', paths);
        if (paths.length > 0) add('body', null, null, paths);
    } else if (expected.kind === 'html') {
        // Order is not compared: 5.17 merges fragments and lists portlets in an order that
        // depends on generated ids. Each element, with its attributes and depth, still is.
        // Seen: the session-timeout script and the marketplace's rating dialogs moved between
        // the recording from master and a replay on another machine (CI run 38100658549).
        const lines = outlineDiff(expected.outline.toSorted(), actual.outline.toSorted());
        if (lines.length > 0) add('body', null, null, lines);
    } else if (stable(expected) !== stable(actual)) {
        add('body', expected, actual);
    }
}

function jsonDiff(a, b, path, out) {
    if (out.length >= 40) return;
    if (stable(a) === stable(b)) return;
    const bothObjects = a && b && typeof a === 'object' && typeof b === 'object' && Array.isArray(a) === Array.isArray(b);
    if (!bothObjects) {
        out.push(`${path}: ${stable(a)} -> ${stable(b)}`);
        return;
    }
    if (Array.isArray(a)) {
        if (a.length !== b.length) out.push(`${path}.length: ${a.length} -> ${b.length}`);
        for (let i = 0; i < Math.min(a.length, b.length); i++) jsonDiff(a[i], b[i], `${path}[${i}]`, out);
        return;
    }
    for (const key of [...new Set([...Object.keys(a), ...Object.keys(b)])].sort()) {
        if (!(key in b)) out.push(`${path}.${key}: removed (was ${stable(a[key]).slice(0, 80)})`);
        else if (!(key in a)) out.push(`${path}.${key}: added (${stable(b[key]).slice(0, 80)})`);
        else jsonDiff(a[key], b[key], `${path}.${key}`, out);
    }
}

/** A unified-style diff of two outlines (LCS), limited to 40 changed lines. */
export function outlineDiff(a, b) {
    if (stable(a) === stable(b)) return [];
    const n = a.length;
    const m = b.length;
    // Lines are compared by an LCS table; outlines are at most a few thousand lines.
    const table = Array.from({ length: n + 1 }, () => new Uint32Array(m + 1));
    for (let i = n - 1; i >= 0; i--) {
        for (let j = m - 1; j >= 0; j--) {
            table[i][j] = a[i] === b[j] ? table[i + 1][j + 1] + 1 : Math.max(table[i + 1][j], table[i][j + 1]);
        }
    }
    const out = [];
    let i = 0;
    let j = 0;
    while ((i < n || j < m) && out.length < 40) {
        if (i < n && j < m && a[i] === b[j]) {
            i++;
            j++;
        } else if (j < m && (i === n || table[i][j + 1] >= table[i + 1][j])) {
            out.push(`+ ${b[j]}`);
            j++;
        } else {
            out.push(`- ${a[i]}`);
            i++;
        }
    }
    return out;
}

// ---------------------------------------------------------------------------------------------
// Security outcome of an exchange (the security matrix)
// ---------------------------------------------------------------------------------------------

/** Classifies a normalised response into an auth outcome for the role × route matrix. */
export function outcome(response) {
    const { status, location = '' } = response;
    if (status === 0) return 'no-response';
    if (status >= 300 && status < 400) {
        if (/\/cas\/login|\/Login\b|\/login\b/.test(location)) return 'redirect-to-login';
        return 'redirect';
    }
    if (status === 401) return 'unauthorized';
    if (status === 403) return 'forbidden';
    if (status === 404) return 'not-found';
    if (status === 405) return 'method-not-allowed';
    if (status >= 400 && status < 500) return 'client-error';
    if (status >= 500) return 'server-error';
    return 'allowed';
}

/**
 * Applies the current masks to a recorded response again. Masks are idempotent, so a mask added
 * after a recording applies to it without a re-record.
 */
export function renormalise(response, path) {
    const result = { ...response };
    if (result.location) result.location = maskString(result.location);
    if (result.headers) {
        result.headers = Object.fromEntries(Object.entries(result.headers).map(([k, v]) => [k, normaliseHeaderValue(k, v)]));
    }
    const body = result.body;
    if (body?.kind === 'json') result.body = { ...body, value: unorder(maskJson(structuredClone(body.value)), path) };
    else if (body?.kind === 'html') result.body = { ...body, outline: body.outline.map((line) => maskString(line)) };
    return result;
}

/** A request path without the machine-specific user part of its layout node ids. */
export const templatePath = (path) => path.replaceAll(/(?<![A-Za-z0-9])u\d+(l\d+[ns]\d+)/g, 'u{id}$1');

export const exchangeKey = (exchange) => `${exchange.role} ${exchange.method} ${templatePath(exchange.path)}`;

// ---------------------------------------------------------------------------------------------
// Layout node ids of the portal at hand
// ---------------------------------------------------------------------------------------------

const NODE_ID = /(?<![A-Za-z0-9])u(\d+)(l\d+[ns]\d+)/g;

/**
 * Learns, for one role, the user part of the layout node ids this portal gave the role's layout,
 * from responses the role's crawl gets anyway: layout.json (portlet nodes with their fname) and
 * the welcome page (portlet wrappers with their fname as a class, folder links). It sends no
 * request of its own, because any extra request changes the session's state (the
 * UrlCanonicalizingFilter redirect counter alternates redirects and pages).
 */
export function nodeIdResolver() {
    const byFname = new Map();
    const bySuffix = new Map();
    const note = (user, suffix, fname) => {
        if (fname) byFname.set(`${fname}|${suffix}`, user);
        if (!bySuffix.has(suffix)) bySuffix.set(suffix, new Set());
        bySuffix.get(suffix).add(user);
    };
    const walk = (node) => {
        if (Array.isArray(node)) node.forEach(walk);
        else if (node && typeof node === 'object') {
            const match = typeof node.ID === 'string' && /^u(\d+)(l\d+[ns]\d+)$/.exec(node.ID);
            if (match) note(match[1], match[2], node.fname);
            Object.values(node).forEach(walk);
        }
    };
    return {
        byFname,
        bySuffix,
        learn(path, body) {
            const text = body.toString('utf8');
            if (path === '/uPortal/api/v4-3/dlm/layout.json') {
                try {
                    walk(JSON.parse(text));
                } catch {
                    // a role without a layout document
                }
            } else if (path === '/uPortal/f/welcome/normal/render.uP') {
                for (const match of text.matchAll(/id="portlet_u(\d+)(l\d+n\d+)"\s+class="([^"]*)"/g)) {
                    for (const fname of match[3].split(/\s+/)) note(match[1], match[2], fname);
                }
                for (const match of text.matchAll(NODE_ID)) note(match[1], match[2]);
            }
        },
    };
}

/** Puts this portal's user part into the layout node ids of a recorded path. */
export function resolvePath(path, resolver) {
    if (!resolver) return path;
    let owner;
    // portlet nodes first: their fname says which one is meant
    let resolved = path.replaceAll(/([\w-]+)\.u(\d+)(l\d+n\d+)/g, (all, fname, user, suffix) => {
        const unique = resolver.bySuffix.get(suffix);
        owner = resolver.byFname.get(`${fname}|${suffix}`) ?? (unique?.size === 1 ? [...unique][0] : user);
        return `${fname}.u${owner}${suffix}`;
    });
    resolved = resolved.replaceAll(/(?<![A-Za-z0-9.])u(\d+)(l\d+[ns]\d+)/g, (all, user, suffix) => {
        const unique = resolver.bySuffix.get(suffix);
        return `u${unique?.size === 1 ? [...unique][0] : (owner ?? user)}${suffix}`;
    });
    return resolved;
}
