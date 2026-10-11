#!/usr/bin/env python3
"""G-index data generator (MOD-D12): a seeded, repeatable large-campus uPortal 5.17 dataset.

    generate.py reference --vendor postgres --container C --out ref.json
    generate.py plan --ref ref.json --scale 0.01
    generate.py emit --ref ref.json --scale 0.01 --seed 42 --table up_raw_events --part 0 --parts 4

`reference` reads what dataInit created (portlets, groups, fragment tabs, the template user's
customized layout) from the database; `plan` prints the load plan (tables in foreign-key order,
their columns, how many parts, and the ID generators to position afterwards); `emit` writes one
table (or one part of it) as CSV on stdout, NULL as \\N, for PostgreSQL COPY or MariaDB LOAD DATA.
Every value is a function of (seed, table, row), so any table or part can be emitted alone, in
any order or in parallel, and comes out the same every time.

Scale 1.0 is the MOD-Q7 large campus: 100,000 users, 5,000 concurrent sessions, 5,000,000 raw
events a day kept for 30 days (31 are generated, so the purge has a day to delete) and 2 years of
aggregations. See docs/g-index.md for what each table holds and why.

Standard library only.
"""

import argparse
import csv
import datetime as dt
import hashlib
import json
import math
import random
import subprocess
import sys

# --------------------------------------------------------------------------------------------
# Scale model (MOD-Q7) and fixed shape parameters
# --------------------------------------------------------------------------------------------

FULL = {
    "users": 100_000,
    "events_per_day": 5_000_000,
    "concurrent_sessions": 5_000,
}
RAW_EVENT_DAYS = 31            # 30 kept + 1 the purge deletes
UNAGGREGATED_MINUTES = 20      # the newest raw events still wait for the aggregation job
AGGREGATION_DAYS = 730         # 2 years of aggregations
EVENT_SESSION_DAYS = 2         # P1D event session duration + 1 day the session purge deletes
EVENTS_PER_VISIT = 35          # login, renders of the tabs and their portlets, actions, logout
NEVER_LOGGED_IN = 0.10         # users with an account but no UP_USER row yet (first-login path)
CUSTOMIZED = 0.30              # users who changed their layout (own UP_LAYOUT_STRUCT rows)
ID_BASE = 10_000_000           # generated IDs start here, far above anything dataInit creates
USER_ID_BASE = 100_000         # UP_USER ids (UP_SEQUENCE counter, int4)
GROUP_KEY_BASE = 100_000       # local group keys (UP_SEQUENCE counter)
PROFILE_ID_BASE = 1_000_000
PREFIX = "gx"                  # user names: gx000001 ...
SERVER_IDS = ["node1", "node2", "node3", "node4"]
EPOCH = dt.datetime(2026, 10, 1, 0, 0, 0)  # "now" of the dataset; --now overrides

AFFILIATIONS = [("student", 0.80), ("faculty", 0.08), ("staff", 0.12)]
GIVEN = ["Alex", "Sam", "Jordan", "Taylor", "Morgan", "Casey", "Riley", "Jamie", "Avery", "Quinn",
         "Rowan", "Skyler", "Emerson", "Finley", "Harper", "Kai", "Logan", "Parker", "Reese", "Sage"]
FAMILY = ["Nguyen", "Garcia", "Smith", "Kim", "Patel", "Johnson", "Lee", "Brown", "Lopez", "Chen",
          "Martin", "Davis", "Wilson", "Clark", "Lewis", "Young", "Hall", "Allen", "King", "Wright"]
SEARCH_TERMS = ["cartoon", "news", "calendar", "library", "weather", "grades", "course", "map",
                "email", "parking", "dining", "jobs", "advisor", "transcript", "housing", "sports"]
# hour-of-day weights of portal traffic (campus day, evening peak, quiet night)
HOURLY = [1, 0.6, 0.4, 0.3, 0.3, 0.5, 1.5, 3, 5, 6, 6.5, 6.5, 6, 6.5, 6.5, 6, 5.5, 5, 5, 5.5, 5.5, 4.5, 3, 2]

# The ID generators of the tables this generator fills (MOD-D11: sequence, increment); see
# tests/db/snapshots/5.17/<vendor>/generators.txt. The loader positions each at max(id) + increment.
GENERATORS = [
    ("up_person_dir", "user_dir_id", "up_person_dir_seq", 5),
    ("up_person_attr", "id", "up_person_attr_seq", 10),
    ("up_ss_user_pref", "ss_user_pref_id", "up_ss_user_pref_seq", 5),
    ("up_ss_user_pref_lay_attr", "up_ss_user_pref_lay_attr_id", "up_ss_user_pref_lay_attr_seq", 5),
    ("up_portlet_prefs", "portlet_prefs_id", "up_portlet_prefs_seq", 10),
    ("up_portlet_pref", "portlet_pref_id", "up_portlet_pref_seq", 10),
    ("up_portlet_ent", "portlet_ent_id", "up_portlet_ent_seq", 10),
    ("up_event_session", "id", "up_event_session_seq", 100),
    ("up_raw_events", "event_id", "up_raw_events_seq", 1000),
    ("up_date_dimension", "date_id", "up_date_dimension_seq", 1),
    ("up_time_dimension", "time_id", "up_time_dimension_seq", 1),
    ("up_aggr_portlet_mapping", "id", "up_aggr_portlet_mapping_seq", 10),
    ("up_aggr_tab_mapping", "id", "up_aggr_tab_mapping_seq", 10),
    ("up_login_event_aggr", "id", "up_login_event_aggr_seq", 1000),
    ("up_portlet_exec_aggr", "id", "up_portlet_exec_aggr_seq", 10000),
    ("up_tab_render_aggr", "id", "up_tab_render_aggr_seq", 5000),
    ("up_portlet_layout_aggr", "id", "up_portlet_layout_aggr_seq", 1000),
    ("up_search_req_aggr", "id", "up_search_req_aggr_seq", 1000),
    ("up_concurrent_user_aggr", "id", "up_concurrent_user_aggr_seq", 1000),
    ("up_event_aggr_status", "id", "up_event_aggr_status_seq", 10),
    ("up_portal_cookies", "portal_cookie_id", "up_portal_cookies_seq", 100),
]

# --------------------------------------------------------------------------------------------
# Deterministic helpers
# --------------------------------------------------------------------------------------------


def rng(seed, *key):
    h = hashlib.blake2b(repr((seed,) + key).encode(), digest_size=8).digest()
    return random.Random(int.from_bytes(h, "big"))


def weighted(r, pairs):
    x, acc = r.random() * sum(w for _, w in pairs), 0.0
    for value, w in pairs:
        acc += w
        if x < acc:
            return value
    return pairs[-1][0]


def ts(t):
    return t.strftime("%Y-%m-%d %H:%M:%S.%f")


def millis(t):
    return int((t - dt.datetime(1970, 1, 1)).total_seconds() * 1000)


class Scale:
    def __init__(self, scale, ref, now):
        self.scale = scale
        self.ref = ref
        self.now = now
        self.users = max(50, round(FULL["users"] * scale))
        self.events_per_day = max(2_000, round(FULL["events_per_day"] * scale))
        self.visits_per_day = max(60, self.events_per_day // EVENTS_PER_VISIT)
        self.concurrent = max(10, round(FULL["concurrent_sessions"] * scale))
        # Local groups: colleges > departments > programs > courses > sections (deep nesting)
        self.colleges = 8
        self.departments = max(16, round(400 * scale ** 0.5))
        self.courses = max(32, round(6_000 * scale))
        self.sections = max(64, round(15_000 * scale))
        # Aggregations are per interval x group x portlet (or tab, term). A smaller campus has as
        # many intervals but fewer portlets in use: the per-interval fan-out shrinks with the scale.
        self.fanout = min(1.0, 10 * scale)

    def portlets_aggregated(self):
        p = self.ref.popular
        return p[:max(4, round(len(p) * self.fanout))]

    def username(self, i):
        return f"{PREFIX}{i:06d}"

    def affiliation(self, seed, i):
        return weighted(rng(seed, "aff", i), AFFILIATIONS)

    def logged_in(self, seed, i):
        return rng(seed, "login", i).random() >= NEVER_LOGGED_IN

    def customized(self, seed, i):
        return self.logged_in(seed, i) and rng(seed, "custom", i).random() < CUSTOMIZED


# --------------------------------------------------------------------------------------------
# Reference data from the database (what dataInit and the template user created)
# --------------------------------------------------------------------------------------------

REFERENCE_QUERIES = {
    "portlets": "SELECT portlet_def_id, portlet_fname, portlet_name FROM up_portlet_def ORDER BY portlet_def_id",
    "groups": "SELECT group_id, group_name, entity_type_id FROM up_group ORDER BY group_id",
    "entity_types": "SELECT entity_type_id, entity_type_name FROM up_entity_type ORDER BY entity_type_id",
    "users": "SELECT user_id, user_name FROM up_user ORDER BY user_id",
    "fragment_tabs": (
        "SELECT s.user_id, s.struct_id, s.name, u.user_name FROM up_layout_struct s "
        "JOIN up_user u ON u.user_id = s.user_id WHERE s.type = 'regular' AND s.name NOT LIKE 'Column%' "
        "AND u.user_name LIKE '%-lo' ORDER BY s.user_id, s.struct_id"),
    "fragment_channels": (
        "SELECT s.user_id, s.struct_id, s.chan_id FROM up_layout_struct s JOIN up_user u ON u.user_id = s.user_id "
        "WHERE s.chan_id IS NOT NULL AND u.user_name LIKE '%-lo' ORDER BY s.user_id, s.struct_id"),
    "template_struct": (
        "SELECT s.layout_id, s.struct_id, s.next_struct_id, s.chld_struct_id, s.external_id, s.chan_id, s.name, "
        "s.type, s.hidden, s.immutable, s.unremovable FROM up_layout_struct s JOIN up_user u ON u.user_id = s.user_id "
        "WHERE u.user_name = '{template}' ORDER BY s.struct_id"),
    "template_param": (
        "SELECT p.layout_id, p.struct_id, p.struct_parm_nm, p.struct_parm_val FROM up_layout_param p "
        "JOIN up_user u ON u.user_id = p.user_id WHERE u.user_name = '{template}' ORDER BY p.struct_id, p.struct_parm_nm"),
    "template_user": "SELECT next_struct_id FROM up_user WHERE user_name = '{template}'",
    "template_layout": (
        "SELECT l.layout_id, l.layout_title, l.init_struct_id FROM up_user_layout l "
        "JOIN up_user u ON u.user_id = l.user_id WHERE u.user_name = '{template}'"),
    "template_profile": (
        "SELECT p.profile_fname, p.profile_name, p.description, p.layout_id, p.structure_ss_id, p.theme_ss_id "
        "FROM up_user_profile p JOIN up_user u ON u.user_id = p.user_id WHERE u.user_name = '{template}'"),
    "template_password": "SELECT encrptd_pswd FROM up_person_dir WHERE user_name = '{template}'",
    "aggr_groups": "SELECT id, group_service, group_name FROM up_aggr_group_mapping ORDER BY id",
    "quarters": "SELECT quarter_id, quarter_start, quarter_end FROM up_quarter_detail ORDER BY quarter_id",
    "ss_descs": "SELECT ss_desc_id, ss_name FROM up_ss_desc ORDER BY ss_desc_id",
}


def run_query(vendor, container, sql, user="uportal", password="uportal", database="uportal"):
    if vendor == "postgres":
        cmd = ["docker", "exec", "-i", "-e", f"PGPASSWORD={password}", container, "psql", "-U", user,
               "-d", database, "-AtqX", "-F", "\t", "-v", "ON_ERROR_STOP=1"]
    else:
        cmd = ["docker", "exec", "-i", "-e", f"MYSQL_PWD={password}", container, "mariadb", "-u", user,
               "-D", database, "-N", "-B", "-r"]
    out = subprocess.run(cmd, input=sql + ";", capture_output=True, text=True)
    if out.returncode != 0:
        raise SystemExit(f"reference query failed: {out.stderr}\n{sql}")
    rows = []
    for line in out.stdout.splitlines():
        rows.append([None if v in ("", "NULL", "\\N") else v for v in line.split("\t")])
    return rows


def reference(args):
    ref = {}
    for key, sql in REFERENCE_QUERIES.items():
        ref[key] = run_query(args.vendor, args.container, sql.format(template=args.template))
    if not ref["template_struct"]:
        raise SystemExit(f"the template user {args.template} has no layout rows; customize it first")
    with open(args.out, "w", encoding="utf-8") as f:
        json.dump(ref, f, indent=1)


class Ref:
    """Typed views of reference.json."""

    def __init__(self, raw):
        self.raw = raw
        self.portlets = [(int(r[0]), r[1], r[2]) for r in raw["portlets"]]
        self.portlet_by_fname = {fname: pid for pid, fname, _ in self.portlets}
        self.groups = {r[1]: (r[0], int(r[2])) for r in raw["groups"]}
        types = {r[1]: int(r[0]) for r in raw["entity_types"]}
        self.person_type = types["org.apereo.portal.security.IPerson"]
        self.group_type = types["org.apereo.portal.groups.IEntityGroup"]
        self.portlet_type = types["org.apereo.portal.portlet.om.IPortletDefinition"]
        self.fragment_tabs = [(int(r[0]), int(r[1]), r[2], r[3]) for r in raw["fragment_tabs"]]
        self.fragment_channels = [(int(r[0]), int(r[1]), int(r[2])) for r in raw["fragment_channels"]]
        self.template_struct = raw["template_struct"]
        self.template_param = raw["template_param"]
        self.template_next_struct = int(raw["template_user"][0][0] or 2)
        self.template_layout = raw["template_layout"]
        self.template_profile = raw["template_profile"][0]
        self.password = raw["template_password"][0][0]
        # The groups default.event-aggregation.xml aggregates for (local Everyone and Students)
        self.aggr_groups = [(int(r[0]), r[1], r[2]) for r in raw["aggr_groups"]
                            if (r[1], r[2]) in (("local", "Everyone"), ("local", "Students"))]
        self.ss_descs = {r[1]: int(r[0]) for r in raw["ss_descs"]}
        # Portlets people use: the ones placed on fragments, most popular first
        on_fragments = []
        for _, _, chan in self.fragment_channels:
            if chan not in on_fragments:
                on_fragments.append(chan)
        names = {pid: fname for pid, fname, _ in self.portlets}
        self.popular = [names[c] for c in on_fragments if c in names] or [p[1] for p in self.portlets[:20]]

    def group_key(self, name):
        return self.groups[name][0]


# --------------------------------------------------------------------------------------------
# Tables
# --------------------------------------------------------------------------------------------

TABLES = {}


def table(name, columns, parts=lambda s: 1):
    def register(fn):
        TABLES[name] = {"columns": columns, "fn": fn, "parts": parts}
        return fn
    return register


def user_range(s, part, parts):
    n = s.users
    return range(1 + part * n // parts, 1 + (part + 1) * n // parts)


USER_PARTS = lambda s: max(1, min(8, s.users // 20_000))  # noqa: E731


@table("up_person_dir", ["user_dir_id", "entity_version", "lst_pswd_cgh_dt", "encrptd_pswd", "user_name"], USER_PARTS)
def person_dir(s, seed, part, parts):
    for i in user_range(s, part, parts):
        yield [ID_BASE + i, 0, ts(s.now - dt.timedelta(days=rng(seed, "pw", i).randint(1, 900))),
               s.ref.password, s.username(i)]


PERSON_ATTRS = ["givenName", "sn", "mail", "displayName", "eduPersonAffiliation"]


@table("up_person_attr", ["id", "entity_version", "attr_name", "user_dir_id"], USER_PARTS)
def person_attr(s, seed, part, parts):
    for i in user_range(s, part, parts):
        for k, name in enumerate(PERSON_ATTRS):
            yield [ID_BASE + i * len(PERSON_ATTRS) + k, 0, name, ID_BASE + i]


@table("up_person_attr_values", ["attr_id", "attr_value", "value_order"], USER_PARTS)
def person_attr_values(s, seed, part, parts):
    for i in user_range(s, part, parts):
        r = rng(seed, "name", i)
        given, family = r.choice(GIVEN), r.choice(FAMILY)
        values = [given, family, f"{s.username(i)}@example.edu", f"{given} {family}", s.affiliation(seed, i)]
        for k, value in enumerate(values):
            # NullSafeStringColumnMapper: uPortal stores these values with a '_' prefix
            yield [ID_BASE + i * len(PERSON_ATTRS) + k, "_" + value, 0]


@table("up_user", ["user_id", "user_name", "user_dflt_lay_id", "next_struct_id", "lst_chan_updt_dt"], USER_PARTS)
def users(s, seed, part, parts):
    for i in user_range(s, part, parts):
        if s.logged_in(seed, i):
            next_struct = s.ref.template_next_struct if s.customized(seed, i) else 2
            yield [USER_ID_BASE + i, s.username(i), 1, next_struct, "\\N"]


@table("up_user_profile", ["user_id", "profile_id", "profile_fname", "profile_name", "description", "layout_id",
                           "structure_ss_id", "theme_ss_id"], USER_PARTS)
def user_profiles(s, seed, part, parts):
    p = s.ref.template_profile
    for i in user_range(s, part, parts):
        if s.logged_in(seed, i):
            # A profile points at a layout only once its user has one of their own (layout_id 0)
            layout = (p[3] or "\\N") if s.customized(seed, i) else 0
            yield [USER_ID_BASE + i, PROFILE_ID_BASE + i, p[0], p[1], p[2], layout, p[4] or "\\N", p[5] or "\\N"]


def nn(v):
    return "\\N" if v is None else v


@table("up_user_layout", ["layout_id", "user_id", "layout_title", "init_struct_id"], USER_PARTS)
def user_layout(s, seed, part, parts):
    for i in user_range(s, part, parts):
        if s.customized(seed, i):
            for layout_id, title, init in s.ref.template_layout:
                yield [layout_id, USER_ID_BASE + i, nn(title), nn(init)]


@table("up_layout_struct", ["user_id", "layout_id", "struct_id", "next_struct_id", "chld_struct_id", "external_id",
                            "chan_id", "name", "type", "hidden", "immutable", "unremovable"], USER_PARTS)
def layout_struct(s, seed, part, parts):
    for i in user_range(s, part, parts):
        if not s.customized(seed, i):
            continue
        r = rng(seed, "tab", i)
        for row in s.ref.template_struct:
            row = list(row)
            if row[6] == "My Stuff":
                row[6] = r.choice(["My Stuff", "Courses", "Research", "Favorites 2", "Work", "Links"])
            yield [USER_ID_BASE + i] + [nn(v) for v in row]


@table("up_layout_param", ["user_id", "layout_id", "struct_id", "struct_parm_nm", "struct_parm_val"], USER_PARTS)
def layout_param(s, seed, part, parts):
    for i in user_range(s, part, parts):
        if s.customized(seed, i):
            for row in s.ref.template_param:
                yield [USER_ID_BASE + i] + [nn(v) for v in row]


def custom_tab_ids(s):
    """struct ids of the template's own tab and its columns (for stylesheet attributes)."""
    # template_struct columns: layout_id, struct_id, next, child, external_id, chan_id, name, type, ...
    tabs = [int(r[1]) for r in s.ref.template_struct if r[6] not in (None, "Column") and r[7] == "regular"]
    cols = [int(r[1]) for r in s.ref.template_struct if r[6] == "Column" and r[7] == "regular"]
    return tabs, cols


@table("up_ss_user_pref", ["ss_user_pref_id", "entity_version", "profile_id", "user_id", "up_ss_descriptor_id"], USER_PARTS)
def ss_user_pref(s, seed, part, parts):
    desc = s.ref.ss_descs.get("DLMTabsColumns", 5)
    for i in user_range(s, part, parts):
        if s.customized(seed, i):
            yield [ID_BASE + i, 0, PROFILE_ID_BASE + i, USER_ID_BASE + i, desc]


@table("up_ss_user_pref_lay_attr", ["up_ss_user_pref_lay_attr_id", "entity_version", "node_id", "ss_user_pref_id"], USER_PARTS)
def ss_lay_attr(s, seed, part, parts):
    tabs, cols = custom_tab_ids(s)
    nodes = [f"s{t}" for t in tabs] + [f"s{c}" for c in cols]
    for i in user_range(s, part, parts):
        if s.customized(seed, i):
            for k, node in enumerate(nodes):
                yield [ID_BASE + i * 8 + k, 0, node, ID_BASE + i]


@table("up_ss_user_pref_lay_attr_val", ["up_ss_user_pref_lay_attr_id", "attr_name", "attr_value"], USER_PARTS)
def ss_lay_attr_val(s, seed, part, parts):
    tabs, cols = custom_tab_ids(s)
    for i in user_range(s, part, parts):
        if not s.customized(seed, i):
            continue
        k = 0
        for _ in tabs:
            yield [ID_BASE + i * 8 + k, "_externalId", f"_tab{i}"]
            k += 1
        for _ in cols:
            yield [ID_BASE + i * 8 + k, "_width", "_50%"]
            k += 1


# Portlet entities with per-user preferences: two per customized user, on fragment portlets
PREFS_PER_ENTITY = 2


def user_entities(s, seed, i):
    r = rng(seed, "ent", i)
    chans = r.sample(s.ref.fragment_channels, k=min(2, len(s.ref.fragment_channels)))
    return [(ID_BASE + i * 2 + k, f"u{u}l1n{struct}", chan) for k, (u, struct, chan) in enumerate(chans)]


@table("up_portlet_prefs", ["portlet_prefs_id", "entity_version"], USER_PARTS)
def portlet_prefs(s, seed, part, parts):
    for i in user_range(s, part, parts):
        if s.customized(seed, i):
            for ent_id, _, _ in user_entities(s, seed, i):
                yield [ent_id, 0]


@table("up_portlet_ent", ["portlet_ent_id", "entity_version", "layout_node_id", "user_id", "portlet_def_id",
                          "portlet_prefs_id"], USER_PARTS)
def portlet_ent(s, seed, part, parts):
    for i in user_range(s, part, parts):
        if s.customized(seed, i):
            for ent_id, node, chan in user_entities(s, seed, i):
                yield [ent_id, 0, node, USER_ID_BASE + i, chan, ent_id]


@table("up_portlet_pref", ["portlet_pref_id", "entity_version", "null_values", "pref_name", "read_only",
                           "portlet_prefs_id", "pref_order"], USER_PARTS)
def portlet_pref(s, seed, part, parts):
    for i in user_range(s, part, parts):
        if s.customized(seed, i):
            for ent_id, _, _ in user_entities(s, seed, i):
                for k in range(PREFS_PER_ENTITY):
                    yield [ent_id * PREFS_PER_ENTITY + k, 0, "f", f"pref{k}", "f", ent_id, k]


@table("up_portlet_pref_values", ["portlet_pref_id", "pref_value", "value_order"], USER_PARTS)
def portlet_pref_values(s, seed, part, parts):
    for i in user_range(s, part, parts):
        if s.customized(seed, i):
            for ent_id, _, _ in user_entities(s, seed, i):
                for k in range(PREFS_PER_ENTITY):
                    yield [ent_id * PREFS_PER_ENTITY + k, f"_value-{i}-{k}", 0]  # null-safe string


# Local groups, deeply nested: colleges > departments > courses > sections; users are members
# of their affiliation group (Students, Faculty, Staff, as in the quickstart data) and students of
# three sections, faculty and staff of a department.

def group_rows(s):
    rows = []  # (key, name, parent key)
    key = GROUP_KEY_BASE
    colleges = []
    for c in range(s.colleges):
        rows.append((str(key), f"College {c + 1}", s.ref.group_key("Everyone")))
        colleges.append(str(key))
        key += 1
    departments = []
    for d in range(s.departments):
        rows.append((str(key), f"Department {d + 1}", colleges[d % len(colleges)]))
        departments.append(str(key))
        key += 1
    courses = []
    for c in range(s.courses):
        rows.append((str(key), f"Course {c + 1}", departments[c % len(departments)]))
        courses.append(str(key))
        key += 1
    sections = []
    for x in range(s.sections):
        rows.append((str(key), f"Section {x + 1}", courses[x % len(courses)]))
        sections.append(str(key))
        key += 1
    return rows, departments, sections


@table("up_group", ["group_id", "creator_id", "entity_type_id", "group_name", "description"])
def groups(s, seed, part, parts):
    rows, _, _ = group_rows(s)
    for key, name, _ in rows:
        yield [key, "system", s.ref.person_type, name, f"G-index generated group {name}"]


@table("up_group_membership", ["group_id", "member_service", "member_key", "member_is_group"], USER_PARTS)
def memberships(s, seed, part, parts):
    rows, departments, sections = group_rows(s)
    if part == 0:
        for key, _, parent in rows:
            yield [parent, "local", key, "T"]
    affiliation_group = {"student": s.ref.group_key("Students"), "faculty": s.ref.group_key("Faculty"),
                         "staff": s.ref.group_key("Staff")}
    for i in user_range(s, part, parts):
        aff = s.affiliation(seed, i)
        name = s.username(i)
        yield [affiliation_group[aff], "local", name, "F"]
        r = rng(seed, "member", i)
        if aff == "student":
            for section in r.sample(sections, k=3):
                yield [section, "local", name, "F"]
        else:
            yield [r.choice(departments), "local", name, "F"]


@table("up_permission", ["owner", "principal_type", "principal_key", "activity", "target", "permission_type",
                         "effective", "expires"])
def permissions(s, seed, part, parts):
    """Departments may subscribe to and browse a few portlets each (portlet manager style)."""
    _, departments, _ = group_rows(s)
    portlets = [pid for pid, _, _ in s.ref.portlets]
    for d, key in enumerate(departments):
        r = rng(seed, "perm", d)
        for pid in r.sample(portlets, k=min(6, len(portlets))):
            for activity in ("SUBSCRIBE", "BROWSE"):
                yield ["UP_PORTLET_SUBSCRIBE", s.ref.group_type, f"local.{key}", activity, f"PORTLET_ID.{pid}",
                       "GRANT", "\\N", "\\N"]


# --------------------------------------------------------------------------------------------
# Analytics: event sessions, raw events, dimensions, aggregations
# --------------------------------------------------------------------------------------------

def day_start(s, days_back):
    return dt.datetime.combine((s.now - dt.timedelta(days=days_back)).date(), dt.time())


def visits_of_day(s, seed, day):
    """Deterministic visits of one day (0 = today): (index, start time, user number, server)."""
    start = day_start(s, day)
    total = s.visits_per_day
    if day == 0:  # today: only up to now
        total = int(total * (s.now - start).total_seconds() / 86400)
    r = rng(seed, "visits", day)
    weights = HOURLY
    for v in range(total):
        hour = weighted(r, list(enumerate(weights)))
        t = start + dt.timedelta(hours=hour, seconds=r.random() * 3600)
        if t >= s.now:
            t = s.now - dt.timedelta(seconds=r.random() * 3600)
        user = 1 + int(r.random() ** 1.3 * s.users)  # some users visit far more often
        yield v, t, user, SERVER_IDS[v % len(SERVER_IDS)]


def session_id(day, v):
    n = (day * 10_000_019 + v) * 2_654_435_761 % (36 ** 8)
    out = ""
    for _ in range(8):
        n, d = divmod(n, 36)
        out += "0123456789abcdefghijklmnopqrstuvwxyz"[d]
    return out


def visit_events(s, seed, day, v, start, user, server):
    """The events of one visit: (time, type, json) tuples; a login, tab renders with their
    portlets, a few actions and resources, sometimes a search, sometimes a logout."""
    r = rng(seed, "visit", day, v)
    name = s.username(user)
    sid = session_id(day, v)
    t = start
    base = lambda cls, when: {"@c": "." + cls, "timestamp": millis(when), "serverId": server,  # noqa: E731
                              "eventSessionId": sid, "userName": name}
    events = []
    groups = ["local.0", "local." + s.ref.group_key("Students"), "pags.Authenticated Users", "pags.All Users (PAGS)"]
    e = base("LoginEvent", t)
    e.update({"captureUserIpAddresses": False, "groups": groups,
              "attributes": {"username": [name], "uid": [name]}, "ipAddress": "0.0.0.0"})
    events.append((t, "org.apereo.portal.events.LoginEvent", e))
    tabs = s.ref.fragment_tabs or [(0, 0, "Welcome", "welcome-lo")]
    for _ in range(3):
        t += dt.timedelta(seconds=r.uniform(2, 40))
        tab = r.choice(tabs)
        for fname in r.sample(s.ref.popular, k=min(8, len(s.ref.popular))):
            e = base("PortletRenderExecutionEvent", t)
            e.update({"fname": fname, "windowState": "normal", "portletMode": "view",
                      "executionTimeNano": int(r.lognormvariate(16, 1)), "parameters": {}, "targeted": False,
                      "usedPortalCache": r.random() < 0.3})
            events.append((t, "org.apereo.portal.events.PortletRenderExecutionEvent", e))
        e = base("PortletRenderHeaderExecutionEvent", t)
        e.update({"fname": "dynamic-respondr-skin", "windowState": "normal", "portletMode": "view",
                  "executionTimeNano": int(r.lognormvariate(14, 1)), "parameters": {}, "targeted": False,
                  "cached": True})
        events.append((t, "org.apereo.portal.events.PortletRenderHeaderExecutionEvent", e))
        e = base("PortalRenderEvent", t)
        e.update({"requestPathInfo": "/f/tab/normal/render.uP", "urlState": "NORMAL", "urlType": "RENDER",
                  "parameters": {}, "targetedLayoutNodeId": f"u{tab[0]}l1s{tab[1]}",
                  "executionTimeNano": int(r.lognormvariate(18, 0.7))})
        events.append((t, "org.apereo.portal.events.PortalRenderEvent", e))
    for _ in range(r.randint(0, 3)):
        t += dt.timedelta(seconds=r.uniform(1, 20))
        kind = r.choice(["PortletActionExecutionEvent", "PortletResourceExecutionEvent"])
        e = base(kind, t)
        e.update({"fname": r.choice(s.ref.popular), "windowState": "normal", "portletMode": "view",
                  "executionTimeNano": int(r.lognormvariate(16, 1)), "parameters": {}})
        if kind == "PortletResourceExecutionEvent":
            e.update({"resourceId": "data", "usedBrowserCache": False, "usedPortalCache": False, "responseStatus": 200})
        events.append((t, "org.apereo.portal.events." + kind, e))
    if r.random() < 0.3:
        t += dt.timedelta(seconds=r.uniform(1, 20))
        e = base("PortletActionExecutionEvent", t)
        e.update({"fname": "search", "windowState": "normal", "portletMode": "view",
                  "executionTimeNano": int(r.lognormvariate(16, 1)),
                  "parameters": {"query": [r.choice(SEARCH_TERMS)]}})
        events.append((t, "org.apereo.portal.events.PortletActionExecutionEvent", e))
    if r.random() < 0.5:
        t += dt.timedelta(seconds=r.uniform(1, 60))
        events.append((t, "org.apereo.portal.events.LogoutEvent", base("LogoutEvent", t)))
    return events


def raw_event_parts(s):
    return max(1, min(32, s.events_per_day * RAW_EVENT_DAYS // 1_000_000))


@table("up_raw_events", ["event_id", "timestamp", "server_id", "session_id", "event_type", "user_name",
                         "aggregated", "error_aggr", "event_data", "own_lob"], raw_event_parts)
def raw_events(s, seed, part, parts):
    """Raw events of the last 31 days. own_lob says whether the row needs its own large object on
    PostgreSQL (events the aggregation job will still read); the others share one per type."""
    cutoff = s.now - dt.timedelta(minutes=UNAGGREGATED_MINUTES)
    for day in range(RAW_EVENT_DAYS):
        if day % parts != part:
            continue
        n = 0
        for v, start, user, server in visits_of_day(s, seed, day):
            for t, etype, e in visit_events(s, seed, day, v, start, user, server):
                if t >= s.now:
                    continue
                n += 1
                fresh = t >= cutoff
                yield [ID_BASE + day * 100_000_000 + n, ts(t), e["serverId"], e["eventSessionId"], etype,
                       e["userName"], "f" if fresh else "t", "f", json.dumps(e, separators=(",", ":")),
                       "t" if fresh else "f"]


@table("up_event_session", ["id", "last_accessed", "session_id"])
def event_sessions(s, seed, part, parts):
    for day in range(EVENT_SESSION_DAYS):
        for v, start, user, server in visit_ids(s, seed, day):
            yield [ID_BASE + day * 10_000_000 + v, ts(start + dt.timedelta(minutes=5)), session_id(day, v)]


@table("up_portal_cookies", ["portal_cookie_id", "cookie_value", "created", "entity_version", "expires"])
def portal_cookies(s, seed, part, parts):
    """The portal's persistent cookie per browser session; expired ones wait for the purge job."""
    for day in range(EVENT_SESSION_DAYS):
        for v, start, _, _ in visit_ids(s, seed, day):
            value = hashlib.sha1(f"{seed}-{day}-{v}".encode()).hexdigest()
            yield [ID_BASE + day * 10_000_000 + v, value, ts(start), 0, ts(start + dt.timedelta(hours=24))]


def visit_ids(s, seed, day):
    for v, start, user, server in visits_of_day(s, seed, day):
        if start < s.now:
            yield v, start, user, server


@table("up_event_session_groups", ["up_event_session_id", "group_id"])
def event_session_groups(s, seed, part, parts):
    groups = [g for g, _, _ in s.ref.aggr_groups]
    for day in range(EVENT_SESSION_DAYS):
        for v, _, user, _ in visit_ids(s, seed, day):
            for g in groups if s.affiliation(seed, user) == "student" else groups[:1]:
                yield [ID_BASE + day * 10_000_000 + v, g]


def first_dimension_date(s):
    return dt.date(s.now.year - 2 - 1, 1, 1)


def last_dimension_date(s):
    return dt.date(s.now.year + 1, 12, 31)


@table("up_date_dimension", ["date_id", "dd_date", "dd_day", "dd_month", "dd_quarter", "dd_term", "dd_week", "dd_year"])
def date_dimension(s, seed, part, parts):
    d = first_dimension_date(s)
    n = 0
    while d <= last_dimension_date(s):
        n += 1
        yield [ID_BASE + n, d.isoformat(), d.day, d.month, (d.month - 1) // 3, "\\N", d.isocalendar()[1], d.year]
        d += dt.timedelta(days=1)


def date_id(s, d):
    return ID_BASE + 1 + (d - first_dimension_date(s)).days


@table("up_time_dimension", ["time_id", "td_five_minute_increment", "td_hour", "td_minute", "td_time"])
def time_dimension(s, seed, part, parts):
    for m in range(1440):
        yield [ID_BASE + 1 + m, (m % 60) // 5, m // 60, m % 60, f"{m // 60:02d}:{m % 60:02d}:00"]


def time_id(minute):
    return ID_BASE + 1 + minute


@table("up_aggr_portlet_mapping", ["id", "portlet_fname", "portlet_name"])
def aggr_portlet_mapping(s, seed, part, parts):
    names = {fname: name for _, fname, name in s.ref.portlets}
    for k, fname in enumerate(s.ref.popular + ["search"]):
        yield [ID_BASE + k, fname, names.get(fname, fname)]


@table("up_aggr_tab_mapping", ["id", "fragment_name", "tab_name"])
def aggr_tab_mapping(s, seed, part, parts):
    seen = []
    for _, _, name, owner in s.ref.fragment_tabs:
        if (owner, name) not in seen:
            seen.append((owner, name))
    for k, (owner, name) in enumerate(seen):
        yield [ID_BASE + k, owner, name]


INTERVALS = {"FIVE_MINUTE": 5, "HOUR": 60, "DAY": 1440, "MONTH": None}


def aggregation_intervals(s, kinds):
    """(interval, start datetime, duration minutes) of every closed interval in the last 2 years,
    oldest first; months are calendar months."""
    end = day_start(s, 1)  # aggregations up to yesterday midnight are closed and complete
    start = end - dt.timedelta(days=AGGREGATION_DAYS)
    for kind in kinds:
        if kind == "MONTH":
            m = dt.datetime(start.year, start.month, 1)
            while m < end:
                nxt = dt.datetime(m.year + (m.month == 12), m.month % 12 + 1, 1)
                if nxt <= end:
                    yield kind, m, int((nxt - m).total_seconds() // 60)
                m = nxt
        else:
            step = INTERVALS[kind]
            t = start
            while t < end:
                yield kind, t, step
                t += dt.timedelta(minutes=step)


def traffic(s, t, minutes):
    """Expected visits in an interval (diurnal curve)."""
    if minutes >= 1440:
        return s.visits_per_day * minutes / 1440
    hour_share = HOURLY[t.hour] / sum(HOURLY)
    return s.visits_per_day * hour_share * minutes / 60


def aggr_parts(s):
    return max(1, min(16, round(s.scale * 100)))


def interval_slice(s, kinds, part, parts):
    for n, item in enumerate(aggregation_intervals(s, kinds)):
        if n % parts == part:
            yield n, item


@table("up_login_event_aggr", ["id", "aggr_group_id", "aggr_interval", "date_dimension_id", "duration",
                               "login_count", "time_dimension_id", "unique_login_count", "unique_strings_id"], aggr_parts)
def login_aggr(s, seed, part, parts):
    for n, (kind, t, minutes) in interval_slice(s, ["FIVE_MINUTE", "HOUR", "DAY", "MONTH"], part, parts):
        r = rng(seed, "login-aggr", n)
        for k, (gid, _, _) in enumerate(s.ref.aggr_groups):
            count = max(0, int(r.gauss(1, 0.15) * traffic(s, t, minutes) * (0.8 if k else 1)))
            if count == 0:
                continue
            yield [ID_BASE + n * 4 + k, gid, kind, date_id(s, t.date()), minutes, count,
                   time_id(t.hour * 60 + t.minute), int(count * 0.7), "\\N"]


EXEC_TYPES = ["ALL", "RENDER", "ACTION", "RESOURCE"]
STAT_COLS = ["cm_1mmnt_dev", "cm_1mmnt_m1", "cm_1mmnt_n", "cm_1mmnt_ndev", "cm_2mmnt_m2", "cm_max_n",
             "cm_max_value", "cm_min_n", "cm_min_value", "cm_sum_n", "cm_sum_value", "cm_sumologs_n",
             "cm_sumologs_value", "cm_sumosqrs_n", "cm_sumosqrs_value"]
TIME_COLS = ["geometric_mean_time", "max_time", "mean_time", "min_time", "population_variance_time",
             "second_moment_time", "std_deviation_time", "sum_of_logs_time", "sum_time", "sumsq_time",
             "time_count", "variance_time"]


def timing(r, count):
    mean = r.lognormvariate(16, 0.5)
    var = (mean * 0.6) ** 2
    return [mean * 0.9, mean * 4, mean, mean * 0.1, var, var * count, math.sqrt(var), count * math.log(mean),
            mean * count, (mean ** 2 + var) * count, count, var]


@table("up_portlet_exec_aggr", ["id", "aggr_group_id", "aggr_interval", "aggr_portlet_id", "date_dimension_id",
                                "duration", "execution_type", "stats_complete", "time_dimension_id"] + TIME_COLS + STAT_COLS,
       aggr_parts)
def portlet_exec_aggr(s, seed, part, parts):
    portlets = s.portlets_aggregated()
    for n, (kind, t, minutes) in interval_slice(s, ["HOUR", "DAY", "MONTH"], part, parts):
        r = rng(seed, "exec-aggr", n)
        base_count = traffic(s, t, minutes)
        k = 0
        for p, _ in enumerate(portlets):
            for x, etype in enumerate(EXEC_TYPES):
                for g, (gid, _, _) in enumerate(s.ref.aggr_groups):
                    k += 1
                    count = int(base_count * (3 if etype in ("ALL", "RENDER") else 0.2) / (1 + p * 0.3))
                    if count == 0:
                        continue
                    yield ([ID_BASE + n * 400 + k, gid, kind, ID_BASE + p, date_id(s, t.date()), minutes, etype, "t",
                            time_id(t.hour * 60 + t.minute)] + [round(v, 3) for v in timing(r, count)]
                           + ["\\N"] * len(STAT_COLS))


@table("up_tab_render_aggr", ["id", "aggr_group_id", "aggr_interval", "aggr_tab_id", "date_dimension_id",
                              "duration", "stats_complete", "time_dimension_id"] + TIME_COLS + STAT_COLS, aggr_parts)
def tab_render_aggr(s, seed, part, parts):
    tabs = list(aggr_tab_mapping(s, seed, 0, 1))
    for n, (kind, t, minutes) in interval_slice(s, ["HOUR", "DAY", "MONTH"], part, parts):
        r = rng(seed, "tab-aggr", n)
        k = 0
        for tab in tabs:
            for gid, _, _ in s.ref.aggr_groups:
                k += 1
                count = int(traffic(s, t, minutes) * 3 / len(tabs))
                if count == 0:
                    continue
                yield ([ID_BASE + n * 200 + k, gid, kind, tab[0], date_id(s, t.date()), minutes, "t",
                        time_id(t.hour * 60 + t.minute)] + [round(v, 3) for v in timing(r, count)]
                       + ["\\N"] * len(STAT_COLS))


@table("up_portlet_layout_aggr", ["id", "add_count", "aggr_group_id", "aggr_interval", "aggr_portlet_id",
                                  "date_dimension_id", "del_count", "duration", "move_count", "stats_complete",
                                  "time_dimension_id"], aggr_parts)
def portlet_layout_aggr(s, seed, part, parts):
    for n, (kind, t, minutes) in interval_slice(s, ["DAY", "MONTH"], part, parts):
        r = rng(seed, "layout-aggr", n)
        k = 0
        for p, _ in enumerate(s.portlets_aggregated()):
            for gid, _, _ in s.ref.aggr_groups:
                k += 1
                if r.random() < 0.5:
                    continue
                yield [ID_BASE + n * 200 + k, r.randint(0, 20), gid, kind, ID_BASE + p, date_id(s, t.date()),
                       r.randint(0, 5), minutes, r.randint(0, 10), "t", time_id(0)]


@table("up_search_req_aggr", ["id", "aggr_group_id", "aggr_interval", "date_dimension_id", "duration",
                              "search_count", "search_term", "stats_complete", "time_dimension_id"], aggr_parts)
def search_aggr(s, seed, part, parts):
    for n, (kind, t, minutes) in interval_slice(s, ["FIVE_MINUTE", "HOUR", "DAY"], part, parts):
        r = rng(seed, "search-aggr", n)
        expected = traffic(s, t, minutes) * 0.3
        k = 0
        for term in SEARCH_TERMS[:max(4, round(len(SEARCH_TERMS) * s.fanout))]:
            for gid, _, _ in s.ref.aggr_groups:
                k += 1
                count = int(expected / len(SEARCH_TERMS) * r.uniform(0.2, 1.8))
                if count == 0:
                    continue
                yield [ID_BASE + n * 40 + k, gid, kind, date_id(s, t.date()), minutes, count, term, "t",
                       time_id(t.hour * 60 + t.minute)]


@table("up_concurrent_user_aggr", ["id", "aggr_group_id", "aggr_interval", "concurrent_users", "date_dimension_id",
                                   "duration", "time_dimension_id", "unique_strings_id"], aggr_parts)
def concurrent_aggr(s, seed, part, parts):
    for n, (kind, t, minutes) in interval_slice(s, ["FIVE_MINUTE"], part, parts):
        r = rng(seed, "conc-aggr", n)
        peak = s.concurrent * HOURLY[t.hour] / max(HOURLY)
        for k, (gid, _, _) in enumerate(s.ref.aggr_groups):
            users = int(peak * r.uniform(0.8, 1.1) * (0.8 if k else 1))
            if users:
                yield [ID_BASE + n * 4 + k, gid, kind, users, date_id(s, t.date()), minutes,
                       time_id(t.hour * 60 + t.minute), "\\N"]


@table("up_event_aggr_status", ["id", "entity_version", "last_end", "last_event_date", "last_start",
                                "processing_type", "server_name"])
def aggr_status(s, seed, part, parts):
    """Where the analytics jobs left off: aggregation up to the newest UNAGGREGATED_MINUTES, the
    purge and the unclosed-interval cleanup up to the same point."""
    done = s.now - dt.timedelta(minutes=UNAGGREGATED_MINUTES)
    for k, kind in enumerate(["AGGREGATION", "CLEAN_UNCLOSED"]):
        yield [ID_BASE + k, 0, ts(done), ts(done), ts(done - dt.timedelta(seconds=5)), kind, SERVER_IDS[0]]
    purged = day_start(s, RAW_EVENT_DAYS - 1)
    yield [ID_BASE + 2, 0, ts(purged), ts(purged), ts(purged - dt.timedelta(seconds=5)), "PURGING", SERVER_IDS[0]]


# Load order: parents before children (foreign keys stay on during the load)
ORDER = ["up_person_dir", "up_person_attr", "up_person_attr_values", "up_user", "up_user_profile",
         "up_user_layout", "up_layout_struct", "up_layout_param", "up_ss_user_pref", "up_ss_user_pref_lay_attr",
         "up_ss_user_pref_lay_attr_val", "up_portlet_prefs", "up_portlet_ent", "up_portlet_pref",
         "up_portlet_pref_values", "up_group", "up_group_membership", "up_permission",
         "up_date_dimension", "up_time_dimension", "up_aggr_portlet_mapping", "up_aggr_tab_mapping",
         "up_login_event_aggr", "up_portlet_exec_aggr", "up_tab_render_aggr", "up_portlet_layout_aggr",
         "up_search_req_aggr", "up_concurrent_user_aggr", "up_event_session", "up_event_session_groups",
         "up_portal_cookies", "up_raw_events", "up_event_aggr_status"]
assert sorted(ORDER) == sorted(TABLES), set(ORDER) ^ set(TABLES)
# Tables the load empties first: analytics rows from the template capture run, which the
# generated history replaces
CLEAR = ["up_login_event_aggr", "up_portlet_exec_aggr", "up_tab_render_aggr", "up_portlet_layout_aggr",
         "up_search_req_aggr", "up_concurrent_user_aggr", "up_unique_str_segment__uids", "up_unique_str_segment",
         "up_unique_str", "up_aggr_portlet_mapping", "up_aggr_tab_mapping", "up_date_dimension",
         "up_time_dimension", "up_event_session_groups", "up_event_session", "up_raw_events",
         "up_event_aggr_status", "up_portlet_cookies", "up_portal_cookies"]


# --------------------------------------------------------------------------------------------
# Loading (vendor bulk-load paths: COPY on PostgreSQL, LOAD DATA on MariaDB)
# --------------------------------------------------------------------------------------------

def db_command(vendor, container):
    if vendor == "postgres":
        return ["docker", "exec", "-i", "-e", "PGPASSWORD=uportal", container, "psql", "-U", "uportal",
                "-d", "uportal", "-AtqX", "-v", "ON_ERROR_STOP=1"]
    return ["docker", "exec", "-i", "-e", "MYSQL_PWD=uportal", container, "mariadb", "-u", "uportal",
            "-D", "uportal", "-N", "-B", "--local-infile=1"]


def sql(vendor, container, text):
    out = subprocess.run(db_command(vendor, container), input=text, capture_output=True, text=True)
    if out.returncode != 0:
        raise SystemExit(f"SQL failed: {out.stderr.strip()}\n{text[:800]}")
    return out.stdout


STAGE = "gx_raw_events_stage"


def copy_target(vendor, name, columns):
    """The SQL that reads one table's CSV from stdin, and the table it fills."""
    target = STAGE if (name == "up_raw_events" and vendor == "postgres") else name
    if vendor == "postgres":
        return f"\\copy {target} ({', '.join(columns)}) FROM STDIN WITH (FORMAT csv, NULL '\\N')", target
    # MariaDB: LOAD DATA from the client's stdin; booleans (bit(1)) and own_lob go through variables
    cols, sets = [], []
    for c in columns:
        if c == "own_lob":
            cols.append("@own_lob")
        elif c in BOOLEAN_COLUMNS:
            cols.append(f"@{c}")
            sets.append(f"{c} = IF(@{c} = 't', 1, IF(@{c} = 'f', 0, NULL))")
        else:
            cols.append(c)
    text = (f"LOAD DATA LOCAL INFILE '/dev/stdin' INTO TABLE {target} CHARACTER SET utf8mb4 "
            f"FIELDS TERMINATED BY ',' OPTIONALLY ENCLOSED BY '\"' ESCAPED BY '\\\\' LINES TERMINATED BY '\\n' "
            f"({', '.join(cols)})" + (f" SET {', '.join(sets)}" if sets else ""))
    return text, target


BOOLEAN_COLUMNS = {"aggregated", "error_aggr", "null_values", "read_only", "stats_complete", "secure",
                   "portlet_framework"}


def load(args):
    import concurrent.futures
    import time
    s = load_scale(args)
    vendor, container = args.vendor, args.container
    me = [sys.executable, "-I", __file__]
    common = ["--ref", args.ref, "--scale", str(args.scale), "--seed", str(args.seed)] + (["--now", args.now] if args.now else [])
    report = []
    started = time.time()

    # Rows the template capture run left in the analytics tables are replaced by the history
    if vendor == "postgres":
        sql(vendor, container, "TRUNCATE " + ", ".join(CLEAR) + ";\n"
            f"DROP TABLE IF EXISTS {STAGE};\n"
            f"CREATE UNLOGGED TABLE {STAGE} (LIKE up_raw_events INCLUDING DEFAULTS);\n"
            f"ALTER TABLE {STAGE} ADD COLUMN own_lob boolean;\n")
    else:
        sql(vendor, container, "SET FOREIGN_KEY_CHECKS = 0;\n" + "".join(f"DELETE FROM {t};\n" for t in CLEAR))

    def one_part(name, columns, part, parts):
        text, _ = copy_target(vendor, name, columns)
        if vendor == "postgres":
            loader = db_command(vendor, container) + ["-c", text]
        else:
            loader = db_command(vendor, container) + ["-e", "SET FOREIGN_KEY_CHECKS = 1; " + text]
        gen = subprocess.Popen(me + ["emit"] + common + ["--table", name, "--part", str(part), "--parts", str(parts)],
                               stdout=subprocess.PIPE)
        out = subprocess.run(loader, stdin=gen.stdout, capture_output=True, text=True)
        gen.stdout.close()
        if gen.wait() != 0 or out.returncode != 0:
            raise SystemExit(f"loading {name} part {part} failed: {out.stderr.strip()}")

    for name in ORDER:
        spec = TABLES[name]
        parts = spec["parts"](s)
        t0 = time.time()
        with concurrent.futures.ThreadPoolExecutor(max_workers=args.jobs) as pool:
            for f in [pool.submit(one_part, name, spec["columns"], p, parts) for p in range(parts)]:
                f.result()
        if name == "up_raw_events" and vendor == "postgres":
            # 5.17 keeps EVENT_DATA as a large object whose OID is in the text column (MOD-I24).
            # Events the aggregation job will still read get their own; the rest share one per type.
            cols = ", ".join(c for c in spec["columns"] if c not in ("event_data", "own_lob"))
            sql(vendor, container, f"""
CREATE TEMP TABLE gx_shared AS
  SELECT event_type, lo_from_bytea(0, convert_to(min(event_data), 'UTF8')) AS lob
  FROM {STAGE} WHERE NOT own_lob GROUP BY event_type;
INSERT INTO up_raw_events ({cols}, event_data)
  SELECT {", ".join("s." + c for c in spec["columns"] if c not in ("event_data", "own_lob"))},
         CASE WHEN s.own_lob THEN lo_from_bytea(0, convert_to(s.event_data, 'UTF8'))::text ELSE g.lob::text END
  FROM {STAGE} s LEFT JOIN gx_shared g ON g.event_type = s.event_type;
DROP TABLE {STAGE};
""")
        rows = sql(vendor, container, f"SELECT COUNT(*) FROM {name};").strip()
        report.append((name, int(rows), time.time() - t0))
        print(f"{name}: {int(rows):,} rows in {time.time() - t0:.1f} s", file=sys.stderr, flush=True)

    # Generators: every sequence (or MariaDB sequence table) above max(id); counters above the keys
    plan_counters = json.loads(plan_json(s, args.scale))["counters"]
    stmts = []
    for t, c, q, inc in GENERATORS:
        if vendor == "postgres":
            stmts.append(f"SELECT setval('{q}', greatest((SELECT coalesce(max({c}), 0) FROM {t}) + {inc}, "
                         f"(SELECT last_value FROM {q})));")
        else:
            stmts.append(f"SELECT GREATEST((SELECT COALESCE(MAX({c}), 0) FROM {t}) + {inc}, "
                         f"(SELECT next_val FROM {q})) INTO @v; UPDATE {q} SET next_val = @v;")
    for counter in plan_counters:
        stmts.append(f"UPDATE up_sequence SET sequence_value = {counter['value']} "
                     f"WHERE sequence_name = '{counter['name']}' AND sequence_value < {counter['value']};")
    sql(vendor, container, "\n".join(stmts) + "\n")
    t0 = time.time()
    if vendor == "postgres":
        subprocess.run(db_command(vendor, container) + ["-c", "VACUUM (ANALYZE)"], check=True)
    else:
        sql(vendor, container, "".join(f"ANALYZE TABLE {t};\n" for t in ORDER))
    report.append(("(vacuum and analyze)", None, time.time() - t0))
    total = time.time() - started

    lines = [f"### G-index data: scale {args.scale} ({vendor})", "",
             f"{s.users:,} users, {s.events_per_day:,} raw events a day for {RAW_EVENT_DAYS} days, "
             f"{AGGREGATION_DAYS} days of aggregations, seed {args.seed}, dataset time {s.now.isoformat()}. "
             f"Loaded {sum(r or 0 for _, r, _ in report):,} rows in {total:.0f} s.", "",
             "| Table | Rows | Seconds |", "| --- | ---: | ---: |"]
    for name, rows, secs in report:
        lines.append(f"| {name} | {'' if rows is None else f'{rows:,}'} | {secs:.1f} |")
    with open(args.report, "w", encoding="utf-8") as f:
        f.write("\n".join(lines) + "\n")
    print("\n".join(lines))


# --------------------------------------------------------------------------------------------
# Command line
# --------------------------------------------------------------------------------------------

def load_scale(args):
    with open(args.ref, encoding="utf-8") as f:
        ref = Ref(json.load(f))
    now = dt.datetime.fromisoformat(args.now) if args.now else EPOCH
    return Scale(args.scale, ref, now)


def plan(args):
    print(plan_json(load_scale(args), args.scale))


def plan_json(s, scale):
    return json.dumps({
        "scale": scale, "users": s.users, "events_per_day": s.events_per_day, "now": s.now.isoformat(),
        "tables": [{"name": t, "columns": TABLES[t]["columns"], "parts": TABLES[t]["parts"](s)} for t in ORDER],
        "clear": CLEAR,
        "generators": [{"table": t, "column": c, "sequence": q, "increment": i} for t, c, q, i in GENERATORS],
        # UP_SEQUENCE counters (Hibernate's counter store) must hand out keys above the generated
        # ones; the store hands out the block of 50 below the stored value, so leave one block
        "counters": [{"name": "UP_USER", "value": USER_ID_BASE + s.users + 100},
                     {"name": "UP_USER_PROFILE", "value": PROFILE_ID_BASE + s.users + 100},
                     {"name": "UP_GROUP", "value": GROUP_KEY_BASE + len(group_rows(s)[0]) + 100}],
        "user_prefix": PREFIX,
    }, indent=1)


def emit(args):
    s = load_scale(args)
    spec = TABLES[args.table]
    out = csv.writer(sys.stdout, lineterminator="\n")
    width = len(spec["columns"])
    for row in spec["fn"](s, args.seed, args.part, args.parts):
        assert len(row) == width, (args.table, row)
        out.writerow(row)


def main():
    p = argparse.ArgumentParser(description=__doc__.split("\n")[0])
    sub = p.add_subparsers(dest="cmd", required=True)
    r = sub.add_parser("reference")
    r.add_argument("--vendor", choices=["postgres", "mariadb"], required=True)
    r.add_argument("--container", required=True)
    r.add_argument("--template", default="student")
    r.add_argument("--out", required=True)
    for name in ("plan", "emit", "load"):
        q = sub.add_parser(name)
        q.add_argument("--ref", required=True)
        q.add_argument("--scale", type=float, default=0.01)
        q.add_argument("--seed", type=int, default=42)
        q.add_argument("--now", default="", help="the dataset's present, ISO 8601 (default 2026-10-01T00:00)")
        if name == "load":
            q.add_argument("--vendor", choices=["postgres", "mariadb"], required=True)
            q.add_argument("--container", required=True)
            q.add_argument("--jobs", type=int, default=4)
            q.add_argument("--report", required=True)
        if name == "emit":
            q.add_argument("--table", required=True, choices=sorted(TABLES))
            q.add_argument("--part", type=int, default=0)
            q.add_argument("--parts", type=int, default=1)
    args = p.parse_args()
    {"reference": reference, "plan": plan, "emit": emit, "load": load}[args.cmd](args)


if __name__ == "__main__":
    main()
