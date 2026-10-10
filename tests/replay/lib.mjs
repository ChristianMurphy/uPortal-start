// Shared code of the HTTP differential replay (docs/http-replay.md): an HTTP session with a cookie
// jar, the login helpers, and the normalisers that turn a response into the host-neutral, masked
// form that is stored in tests/replay/fixtures/ and compared on every replay.
//
// The recorder and the replayer both normalise with this file, so a change to a normaliser
// changes what is compared: bump NORMALISER_VERSION and re-record (see docs/http-replay.md).
import { createHash } from 'node:crypto';

export const NORMALISER_VERSION = 1;

// The quickstart roles, each with its local account (data/base/user, data/quickstart/user; the
// password of every quickstart account is its user name). Guest is the anonymous session.
export const ROLES = ['guest', 'student', 'staff', 'faculty', 'admin'];

// Every local account in the 5.17 data that has a password; all are stored as uPortal's salted
// "(MD5)" hash. Each must still log in with its password and be refused with a wrong one.
export const LOCAL_ACCOUNTS = ['admin', 'student', 'staff', 'faculty', 'developer'];

const DISPLAY_NAMES = {
    admin: 'Amy Administrator',
    student: 'Steven Student',
    staff: 'Samuel Staff',
    faculty: 'Felicia Faculty',
    developer: 'Danielle Developer',
};

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
            const response = await fetch(url, {
                method,
                headers: requestHeaders,
                body,
                redirect: 'manual',
                signal: AbortSignal.timeout(60_000),
            });
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
    const text = response.body.toString('utf8');
    const name = DISPLAY_NAMES[username];
    return { status: response.status, ok: response.status === 200 && (!name || text.includes(name)) };
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

const STRING_MASKS = [
    // Session ids are random per session (Tomcat's SecureRandom); URL rewriting embeds them.
    [/(;jsessionid=)[0-9A-Za-z._-]+/gi, '$1{session}'],
    [/(JSESSIONID=)[0-9A-Za-z._-]+/g, '$1{session}'],
    // CAS tickets (service, proxy-granting, login) are random and single-use.
    [/\b(ST|PT|PGT|PGTIOU|TGT|LT)-\d+-[0-9A-Za-z-]+(-cas)?/g, '$1-{ticket}'],
    // CAS 3.6 login flow execution keys are encrypted, random blobs.
    [/(execution=)[0-9a-f-]{8,}_[0-9A-Za-z+/=%_-]+/g, '$1{execution}'],
    // UUIDs are generated (analytics event ids, request ids, CSRF tokens in some forms).
    [/\b[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}\b/gi, '{uuid}'],
    // jQuery's cache-busting `_=<epoch ms>` parameter and other epoch-millisecond values in URLs
    // are the time of the request.
    [/([?&]_=)\d{10,13}/g, '$1{epoch-ms}'],
];

// Date and time strings keep their shape (every digit becomes 9), so a changed format is still
// reported while the value, which is the time of the request, is not.
const DATE_TIME = /\b\d{4}-\d{2}-\d{2}([T ]\d{2}:\d{2}(:\d{2}(\.\d+)?)?(Z|[+-]\d{2}:?\d{2})?)?\b/g;
const HTTP_DATE = /\b(Mon|Tue|Wed|Thu|Fri|Sat|Sun), \d{2} [A-Z][a-z]{2} \d{4} \d{2}:\d{2}:\d{2} GMT\b/g;
const shape = (text) => text.replaceAll(/\d/g, '9');

export function maskString(text) {
    let masked = text;
    for (const [pattern, replacement] of STRING_MASKS) masked = masked.replace(pattern, replacement);
    masked = masked.replace(DATE_TIME, shape).replace(HTTP_DATE, shape);
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
    // ETags of static files are built from the size and modification time; the time is the
    // deployment's, so only the shape (weak or strong, digits) is compared.
    if (name === 'etag') return shape(value);
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
export function normaliseResponse(response, origin) {
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
    normalised.body = normaliseBody(response.body, headers['content-type'] ?? '', origin);
    return normalised;
}

// ---------------------------------------------------------------------------------------------
// Bodies
// ---------------------------------------------------------------------------------------------

const MAX_JSON = 100_000;
const hash = (buffer) => createHash('sha256').update(buffer).digest('hex').slice(0, 16);

export function normaliseBody(buffer, contentType, origin) {
    if (buffer.length === 0) return { kind: 'empty' };
    const type = contentType.toLowerCase();
    const text = () => buffer.toString('utf8');
    if (type.includes('json') || (/^\s*[[{]/.test(text().slice(0, 64)) && !type.includes('html'))) {
        try {
            const value = maskJson(JSON.parse(text()), origin);
            const serialised = JSON.stringify(value);
            if (serialised.length > MAX_JSON) return { kind: 'json-shape', shape: jsonShape(value), sha: hash(serialised) };
            return { kind: 'json', value };
        } catch {
            // not JSON after all; fall through
        }
    }
    if (type.includes('html')) return { kind: 'html', outline: htmlOutline(text(), origin) };
    if (type.startsWith('text/') || type.includes('xml') || type.includes('javascript')) {
        const masked = maskString(text()).replaceAll(origin ?? '\0', '{origin}');
        return { kind: 'text', length: lengthBucket(masked.length), sha: hash(masked) };
    }
    return { kind: 'binary', length: lengthBucket(buffer.length), sha: hash(buffer) };
}

// Lengths are compared in buckets of 64 bytes: a changed byte count from a different build date
// in a comment should not hide behind a hash change alone, and the hash already decides equality.
const lengthBucket = (length) => Math.ceil(length / 64) * 64;

// A number between 2000-01-01 and 2100-01-01 in milliseconds is a timestamp: the time of the
// request or of the data import. Its type is kept so a change to a string format is reported.
const EPOCH_MS_MIN = 946_684_800_000;
const EPOCH_MS_MAX = 4_102_444_800_000;

export function maskJson(value, origin) {
    if (Array.isArray(value)) return value.map((v) => maskJson(v, origin));
    if (value && typeof value === 'object') {
        const sorted = {};
        for (const key of Object.keys(value).sort()) sorted[key] = maskJson(value[key], origin);
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
const TAG = /<!--[\s\S]*?-->|<!\[CDATA\[[\s\S]*?]]>|<![^>]*>|<\?[^>]*>|<\/\s*([A-Za-z][\w:-]*)\s*>|<([A-Za-z][\w:-]*)((?:\s+[^\s=/>]+(?:\s*=\s*(?:"[^"]*"|'[^']*'|[^\s>]+))?)*)\s*(\/?)>/g;
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
            value = normaliseUrl(value.replaceAll('&amp;', '&'), origin).replace(/\?.*$/, (query) =>
                `?${[...new URLSearchParams(query.slice(1)).keys()].sort().join('&')}`
            );
        }
        line += `[${name}=${value}]`;
    }
    if (node.tag === 'meta') {
        const name = node.attributes.name ?? node.attributes.property;
        if (name) line += `[meta=${name}]`;
    }
    if (TEXT_ELEMENTS.has(node.tag) && node.text) line += ` "${maskString(collapse(node.text))}"`;
    return line;
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
        const lines = outlineDiff(expected.outline, actual.outline);
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

export const exchangeKey = (exchange) => `${exchange.role} ${exchange.method} ${exchange.path}`;
