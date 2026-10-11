#!/usr/bin/env python3
"""G-index audit (MOD-D12): checks the indexes of a uPortal database after the G-index workload.

    python3 -I tests/db/gindex/audit.py --vendor postgres --container uportal-dbh-postgres-18 \
        --plans build/g-index/postgres-18/plans.jsonl --out build/g-index/postgres-18

Checks (see docs/g-index.md):

  seq-scan         a sequential scan, in a plan the workload really executed, on a table with at
                   least --min-rows rows (fails)
  fk-no-index      a foreign key whose columns do not lead any index (fails)
  duplicate-index  two indexes with the same key columns (fails)
  redundant-index  an index whose key columns are a left prefix of another index's (fails)
  unused-index     an index no statement of the workload used (report only)
  top-total        the statements with the highest total time (report only)
  top-mean         the statements with the highest mean time (report only)

A finding of these four checks fails the audit unless tests/db/gindex/allowlist.txt lists it with a reason.
Writes findings.json and summary.md to --out, appends summary.md to $GITHUB_STEP_SUMMARY and
prints one GitHub annotation per failing finding. Exit status: 0 when nothing fails, 1 otherwise,
2 on a usage or database error.

Standard library only; the database is reached with `docker exec` and the vendor's own client.
"""

import argparse
import fnmatch
import hashlib
import json
import os
import re
import subprocess
import sys
from collections import defaultdict

# Aliases Hibernate numbers in the SQL it generates: localaccou0_ and USER_DIR1_13_0_ (Hibernate 4
# and 5), l1_0 (Hibernate 6). An upgrade renumbers them without changing the statement.
HIBERNATE_ALIAS = re.compile(r"\b[a-z][a-z0-9_]*?\d+_(?:\d+_?)*(?![a-z0-9_])")


def statement_id(text):
    """The id of a statement in findings and the allowlist: an md5 of its text, lower case, without
    quoting, spacing or Hibernate's numbered aliases, so the same statement keeps its id across
    Hibernate versions and vendors' quoting."""
    s = re.sub(r"\s+", " ", text.lower().replace("`", "").replace('"', "")).strip()
    s = re.sub(r" ?([.,()=]) ?", r"\1", s)
    s = HIBERNATE_ALIAS.sub("t", s)
    return hashlib.md5(s.encode()).hexdigest()[:16]


GATE_CHECKS = ("seq-scan", "fk-no-index", "duplicate-index", "redundant-index")
REPORT_CHECKS = ("unused-index", "top-total", "top-mean")


# --------------------------------------------------------------------------------------------
# Database access
# --------------------------------------------------------------------------------------------

class Database:
    def __init__(self, vendor, container, user, password, database):
        self.vendor, self.container = vendor, container
        self.user, self.password, self.database = user, password, database

    def _run(self, sql):
        if self.vendor == "postgres":
            cmd = ["docker", "exec", "-i", "-e", f"PGPASSWORD={self.password}", self.container,
                   "psql", "-U", self.user, "-d", self.database, "-AtqX", "-v", "ON_ERROR_STOP=1"]
        else:
            cmd = ["docker", "exec", "-i", "-e", f"MYSQL_PWD={self.password}", self.container,
                   "mariadb", "-u", self.user, "-D", self.database, "-N", "-B", "-r"]
        result = subprocess.run(cmd, input=sql, capture_output=True, text=True)
        if result.returncode != 0:
            raise RuntimeError(f"query failed: {result.stderr.strip()}\n{sql[:500]}")
        return result.stdout

    def rows(self, query):
        """The rows of a query as a list of dicts (the database builds the JSON)."""
        if self.vendor == "postgres":
            out = self._run(f"SELECT coalesce(json_agg(t), '[]') FROM ({query}) t;")
        else:
            out = self._run(query + ";")
        out = out.strip()
        return json.loads(out) if out else []

    def execute(self, sql):
        return self._run(sql)


# --------------------------------------------------------------------------------------------
# PostgreSQL checks
# --------------------------------------------------------------------------------------------

PG_TABLES = """
SELECT c.relname AS tbl, greatest(c.reltuples, 0)::bigint AS rows,
       pg_total_relation_size(c.oid) AS bytes
FROM pg_class c
WHERE c.relnamespace = 'public'::regnamespace AND c.relkind IN ('r', 'p')
"""

PG_FK_NO_INDEX = """
SELECT c.conrelid::regclass::text AS tbl, c.conname AS fk, c.confrelid::regclass::text AS ref,
       (SELECT string_agg(a.attname, ', ' ORDER BY k.ord)
          FROM unnest(c.conkey) WITH ORDINALITY k(att, ord)
          JOIN pg_attribute a ON a.attrelid = c.conrelid AND a.attnum = k.att) AS cols
FROM pg_constraint c
WHERE c.contype = 'f' AND c.connamespace = 'public'::regnamespace
  AND NOT EXISTS (
    SELECT 1 FROM pg_index i
    WHERE i.indrelid = c.conrelid AND i.indpred IS NULL AND i.indexprs IS NULL
      AND (SELECT array_agg(k ORDER BY k)
             FROM unnest(i.indkey::int2[]) WITH ORDINALITY u(k, o)
             WHERE o <= cardinality(c.conkey))
        = (SELECT array_agg(k ORDER BY k) FROM unnest(c.conkey) k))
ORDER BY 1, 2
"""

PG_INDEXES = """
SELECT t.relname AS tbl, c.relname AS idx, i.indisunique AS is_unique, i.indisprimary AS is_primary,
       i.indpred IS NULL AND i.indexprs IS NULL AS plain, am.amname AS am,
       (SELECT string_agg(k::text, ' ' ORDER BY o) FROM unnest(i.indkey::int2[]) WITH ORDINALITY u(k, o)
         WHERE o <= i.indnkeyatts) AS keys,
       (SELECT string_agg(k::text, ' ' ORDER BY o) FROM unnest(i.indclass::oid[]) WITH ORDINALITY u(k, o)
         WHERE o <= i.indnkeyatts) AS opclasses,
       (SELECT string_agg(a.attname, ', ' ORDER BY o) FROM unnest(i.indkey::int2[]) WITH ORDINALITY u(k, o)
          JOIN pg_attribute a ON a.attrelid = i.indrelid AND a.attnum = u.k WHERE o <= i.indnkeyatts) AS cols,
       (SELECT con.conname FROM pg_constraint con WHERE con.conindid = i.indexrelid
           AND con.conrelid = i.indrelid LIMIT 1) AS constraint_name,
       coalesce(w.idx_scan, s.idx_scan, 0) AS idx_scan, pg_relation_size(i.indexrelid) AS bytes,
       pg_get_indexdef(i.indexrelid) AS def, i.indexrelid::bigint AS oid
FROM pg_index i
JOIN pg_class c ON c.oid = i.indexrelid
JOIN pg_class t ON t.oid = i.indrelid
JOIN pg_am am ON am.oid = c.relam
LEFT JOIN pg_stat_user_indexes s ON s.indexrelid = i.indexrelid
LEFT JOIN gindex.workload_index_usage w ON w.relname = t.relname AND w.indexrelname = c.relname
WHERE t.relnamespace = 'public'::regnamespace
ORDER BY 1, 2
"""

PG_TOP = """
SELECT queryid::text AS queryid, calls, round(total_exec_time::numeric, 1) AS total_ms,
       round(mean_exec_time::numeric, 3) AS mean_ms, rows,
       shared_blks_hit + shared_blks_read AS blocks, left(regexp_replace(query, '\\s+', ' ', 'g'), 400) AS query
FROM gindex.workload_statements s
WHERE query !~* '^\\s*(begin|commit|rollback|set |show |select 1\\s*$|deallocate|discard)'
ORDER BY {order} DESC
LIMIT {limit}
"""

PG_STATEMENT_COUNT = """
SELECT count(*) AS statements, coalesce(sum(calls), 0)::bigint AS calls
FROM gindex.workload_statements s
"""


def redundant_pairs(indexes):
    """Duplicate and left-prefix-redundant plain btree indexes, each reported once."""
    found = []
    by_table = defaultdict(list)
    for ix in indexes:
        if ix["plain"] and ix["am"] in ("btree", "BTREE"):
            by_table[ix["tbl"]].append(ix)
    for tbl, group in by_table.items():
        for a in group:
            for b in group:
                if a is b:
                    continue
                ak, bk = a["keys"].split(), b["keys"].split()
                ao, bo = a["opclasses"].split(), b["opclasses"].split()
                if len(ak) > len(bk) or bk[:len(ak)] != ak or bo[:len(ao)] != ao:
                    continue
                if len(ak) == len(bk):
                    # Same keys: a unique index is never made redundant by a non-unique one
                    if a["is_unique"] and not b["is_unique"]:
                        continue
                    if a["is_unique"] == b["is_unique"]:
                        # Report the pair once: the one that backs no constraint (or the newer
                        # one) is the one to drop
                        a_key = (a["constraint_name"] is None, a["oid"])
                        b_key = (b["constraint_name"] is None, b["oid"])
                        if a_key < b_key:
                            continue
                    kind = "duplicate-index"
                else:
                    # A unique index enforces uniqueness on its own columns; it stays
                    if a["is_unique"]:
                        continue
                    kind = "redundant-index"
                found.append({"check": kind, "subject": f"{tbl}.{a['idx']}", "table": tbl,
                              "index": a["idx"], "covered_by": b["idx"], "def": a["def"],
                              "covered_by_def": b["def"], "constraint": a["constraint_name"],
                              "idx_scan": a["idx_scan"], "bytes": a["bytes"]})
                break
    return found


def walk_plan(node, out, parent=None):
    node["_parent"] = parent
    out.append(node)
    for child in node.get("Plans", []) or []:
        walk_plan(child, out, node)


def read_plans(paths):
    """auto_explain plans from PostgreSQL's jsonlog files: one dict per logged execution."""
    plans = []
    for path in paths:
        if not os.path.exists(path):
            continue
        with open(path, encoding="utf-8", errors="replace") as f:
            for line in f:
                line = line.strip()
                if not line.startswith("{"):
                    continue
                try:
                    entry = json.loads(line)
                except json.JSONDecodeError:
                    continue
                message = entry.get("message", "")
                marker = message.find("plan:")
                if not message.startswith("duration:") or marker < 0:
                    continue
                try:
                    plan = json.loads(message[marker + 5:])
                except json.JSONDecodeError:
                    continue
                plans.append(plan)
    return plans


COMPARISON = re.compile(r"\b([a-z_][a-z0-9_]*)\.([a-z_][a-z0-9_]*)\b\)?(?:::[a-z ]+)?\)?\s*(=|<=|>=|<|>|~~)")
COMPARED = re.compile(r"(=|<=|>=|<|>|~~)\s*\(?\(?([a-z_][a-z0-9_]*)\.([a-z_][a-z0-9_]*)\b")


UNQUALIFIED = re.compile(r"(?<![.:\w'])([a-z_][a-z0-9_]*)\b(?=\)?(?:::[a-z ]+)?\)?\s*(?:=|<=|>=|<|>|~~))")


def suggest_columns(node):
    """Columns of this scan's table that its filter, or the join above it, compares (equality
    first): a hint for the DDL, not a design."""
    alias = (node.get("Alias") or node.get("Relation Name") or "").lower()
    texts = [node.get("Filter", "")]
    parent = node.get("_parent")
    while parent is not None and not texts[-1:] == [""]:
        break
    hops = 0
    while parent is not None and hops < 3:
        for key in ("Hash Cond", "Merge Cond", "Join Filter"):
            if parent.get(key):
                texts.append(parent[key])
        parent, hops = parent.get("_parent"), hops + 1
    eq, rng = [], []
    for n, text in enumerate(texts):
        text = (text or "").lower()
        if n == 0:
            # The scan's own filter names its columns without the alias
            text = UNQUALIFIED.sub(lambda m: f"{alias}.{m.group(1)}", text)
        found = [(a, c, op) for a, c, op in COMPARISON.findall(text)]
        found += [(a, c, op) for op, a, c in COMPARED.findall(text)]
        for a, c, op in found:
            if a != alias:
                continue
            target = eq if op == "=" else rng
            if c not in eq and c not in rng:
                target.append(c)
    return eq + rng[:1]


def seq_scans(plans, tables, min_rows):
    """Sequential scans per (statement, table) on tables of at least min_rows rows."""
    grouped = {}
    for plan in plans:
        nodes = []
        walk_plan(plan.get("Plan", {}), nodes)
        for node in nodes:
            if node.get("Node Type") != "Seq Scan":
                continue
            table = node.get("Relation Name")
            info = tables.get(table)
            if info is None or info["rows"] < min_rows:
                continue
            # Plans are logged without verbose output (a tenth of the size), so the statement's
            # text identifies it
            qid = statement_id(plan.get("Query Text", ""))
            key = (qid, table)
            g = grouped.get(key)
            if g is None:
                g = grouped[key] = {
                    # table@statement: an allowlist entry covers one statement, not every scan
                    "check": "seq-scan", "subject": f"{table}@{qid[:8]}", "table": table, "rows": info["rows"],
                    "queryid": qid, "query": re.sub(r"\s+", " ", plan.get("Query Text", ""))[:600],
                    "sql": plan.get("Query Text", ""),
                    "parameters": (plan.get("Query Parameters") or "")[:300],
                    "filter": node.get("Filter", ""), "executions": 0, "max_rows_removed": 0,
                    "max_blocks": 0, "columns": suggest_columns(node),
                }
            g["executions"] += 1
            g["max_rows_removed"] = max(g["max_rows_removed"], node.get("Rows Removed by Filter", 0) or 0)
            blocks = (node.get("Shared Hit Blocks", 0) or 0) + (node.get("Shared Read Blocks", 0) or 0)
            g["max_blocks"] = max(g["max_blocks"], blocks)
    return list(grouped.values())


def explain_without_seqscan(db, finding):
    """Whether any index could serve the scan: EXPLAIN (GENERIC_PLAN) with seq scans disabled."""
    query = finding.pop("sql", finding["query"]).strip().rstrip(";")
    # EXPLAIN without ANALYZE plans a DELETE or UPDATE without running it
    if not re.match(r"(?is)^\s*(select|with|delete|update)\b", query):
        return None
    try:
        out = db.execute("SET enable_seqscan = off;\nEXPLAIN (GENERIC_PLAN, FORMAT JSON) " + query + ";")
    except RuntimeError:
        return None
    try:
        plan = json.loads(out[out.index("["):])[0]["Plan"]
    except (ValueError, KeyError, IndexError):
        return None
    nodes = []
    walk_plan(plan, nodes)
    # Usable means an index condition on the table, not just a full scan of some index
    for node in nodes:
        if node.get("Relation Name") != finding["table"]:
            continue
        if node.get("Index Cond") or node.get("Recheck Cond"):
            return True
        for child in node.get("Plans", []) or []:
            if child.get("Index Cond"):
                return True
    return False


def audit_postgres(db, args):
    tables = {r["tbl"]: r for r in db.rows(PG_TABLES)}
    findings = []

    plans = read_plans(args.plans)
    if args.plans and not plans:
        # Without executed plans the seq-scan check would pass without looking at anything
        raise RuntimeError(f"no executed plans in {', '.join(args.plans)}: auto_explain did not log the workload")
    scans = []
    for f in seq_scans(plans, tables, args.min_rows):
        usable = explain_without_seqscan(db, f)
        f["index_exists"] = usable
        # The planner may rightly scan a small table although an index exists; that only
        # counts on a table ten times the threshold
        if usable and f["rows"] < 10 * args.min_rows:
            continue
        scans.append(f)
        if f["columns"] and not usable:
            name = f"up_gx_{f['table'].removeprefix('up_')}_{'_'.join(f['columns'])}"[:63]
            f["ddl"] = f"CREATE INDEX {name} ON {f['table']} ({', '.join(f['columns'])});"
    findings += scans

    for r in db.rows(PG_FK_NO_INDEX):
        rows = tables.get(r["tbl"], {}).get("rows", 0)
        name = f"up_gx_{r['tbl'].removeprefix('up_')}_{r['cols'].replace(', ', '_')}"[:63]
        findings.append({"check": "fk-no-index", "subject": f"{r['tbl']}.{r['fk']}", "table": r["tbl"],
                         "fk": r["fk"], "columns": r["cols"], "references": r["ref"], "rows": rows,
                         "ddl": f"CREATE INDEX {name} ON {r['tbl']} ({r['cols']});"})

    indexes = db.rows(PG_INDEXES)
    for f in redundant_pairs(indexes):
        f["ddl"] = (f"ALTER TABLE {f['table']} DROP CONSTRAINT {f['constraint']};" if f["constraint"]
                    else f"DROP INDEX {f['index']};")
        findings.append(f)

    for ix in indexes:
        if ix["idx_scan"] == 0:
            findings.append({"check": "unused-index", "subject": f"{ix['tbl']}.{ix['idx']}",
                             "table": ix["tbl"], "index": ix["idx"], "columns": ix["cols"],
                             "constraint": ix["constraint_name"], "unique": ix["is_unique"],
                             "bytes": ix["bytes"], "rows": tables.get(ix["tbl"], {}).get("rows", 0)})

    for check, order in (("top-total", "total_exec_time"), ("top-mean", "mean_exec_time")):
        for r in db.rows(PG_TOP.format(order=order, limit=args.top)):
            r["check"], r["subject"] = check, r["queryid"]
            findings.append(r)

    stats = db.rows(PG_STATEMENT_COUNT)[0]
    stats["plans"] = len(plans)
    stats["tables"] = len(tables)
    stats["indexes"] = len(indexes)
    return findings, stats


# --------------------------------------------------------------------------------------------
# MariaDB / MySQL checks (performance_schema and the sys schema)
# --------------------------------------------------------------------------------------------

def my_json(db, select, cols):
    """Run a SELECT and return dicts; MariaDB builds one JSON object per row."""
    obj = ", ".join(f"'{c}', {c}" for c in cols)
    out = db.execute(f"SELECT JSON_OBJECT({obj}) FROM ({select}) t;")
    return [json.loads(line) for line in out.splitlines() if line.strip()]


MY_TABLES = """
SELECT LOWER(table_name) AS tbl, table_rows AS row_count, data_length + index_length AS bytes
FROM information_schema.tables WHERE table_schema = DATABASE() AND table_type = 'BASE TABLE'
"""

MY_INDEX_COLUMNS = """
SELECT LOWER(table_name) AS tbl, index_name AS idx, non_unique, seq_in_index, LOWER(column_name) AS col,
       index_type, sub_part
FROM information_schema.statistics WHERE table_schema = DATABASE()
"""

MY_FKS = """
SELECT LOWER(k.table_name) AS tbl, k.constraint_name AS fk, LOWER(k.referenced_table_name) AS ref,
       GROUP_CONCAT(LOWER(k.column_name) ORDER BY k.ordinal_position SEPARATOR ', ') AS cols
FROM information_schema.key_column_usage k
WHERE k.table_schema = DATABASE() AND k.referenced_table_name IS NOT NULL
GROUP BY k.table_name, k.constraint_name, k.referenced_table_name
"""

MY_INDEX_USAGE = """
SELECT LOWER(object_name) AS tbl, index_name AS idx, count_star AS uses
FROM gindex.workload_index_usage
WHERE index_name IS NOT NULL
"""

MY_TOP = """
SELECT digest AS queryid, count_star AS calls, ROUND(sum_timer_wait / 1e9, 1) AS total_ms,
       ROUND(avg_timer_wait / 1e9, 3) AS mean_ms, sum_rows_examined AS rows_examined,
       sum_no_index_used AS no_index_used, LEFT(digest_text, 400) AS query
FROM gindex.workload_digests
WHERE digest_text NOT REGEXP '^(SET|SHOW|COMMIT|ROLLBACK|SELECT @@|SELECT \\\\? $)'
ORDER BY {order} DESC LIMIT {limit}
"""

MY_FULL_SCANS = """
SELECT digest AS queryid, count_star AS calls, sum_no_index_used AS no_index_used,
       sum_rows_examined AS rows_examined, sum_rows_sent AS rows_sent, LEFT(digest_text, 600) AS query,
       digest_text AS full_text
FROM gindex.workload_digests
WHERE sum_no_index_used > 0
"""


def explain_full_scans(db, digest):
    """Tables a MariaDB digest reads with access type ALL, from EXPLAIN of its text."""
    if not re.match(r"(?is)^\s*(select|with|delete|update)\b", digest) or digest.rstrip().endswith("..."):
        return None
    text = re.sub(r"\(\s*\?\s*(,\s*\?\s*)*(,\s*\.\.\.)?\s*\)", "('1')", digest)
    text = text.replace("?", "'1'")
    aliases = {a.lower(): t.lower() for t, a in re.findall(r"`(up_\w+)`\s+(?:AS\s+)?`(\w+)`", text, re.I)}
    try:
        out = db.execute("EXPLAIN " + text + ";")
    except RuntimeError:
        return None
    found = set()
    for line in out.splitlines():
        cols = line.split("\t")
        if len(cols) >= 4 and cols[3] == "ALL":
            alias = cols[2].lower()
            found.add(aliases.get(alias, alias))
    return {t for t in found if t.startswith("up_")}


def audit_mariadb(db, args):
    tables = {}
    for r in my_json(db, MY_TABLES, ["tbl", "row_count", "bytes"]):
        tables[r["tbl"]] = {"tbl": r["tbl"], "rows": int(r["row_count"] or 0), "bytes": r["bytes"]}
    # Statistics' row estimates on InnoDB are rough; count the tables that matter exactly
    for name, info in tables.items():
        if info["rows"] >= args.min_rows // 2:
            info["rows"] = int(db.execute(f"SELECT COUNT(*) FROM `{name}`;").strip())
    findings = []

    # Full scans: digests whose executions used no index. EXPLAIN the digest text with '1' for
    # each placeholder to find the tables read with type ALL; if that fails, name every large table
    for r in my_json(db, MY_FULL_SCANS, ["queryid", "calls", "no_index_used", "rows_examined",
                                         "rows_sent", "query", "full_text"]):
        scanned = explain_full_scans(db, r["query"])
        named = scanned if scanned is not None else {
            t.lower() for t in re.findall(r"`?\b(up_[a-z0-9_]+)\b`?", r["query"], re.I)}
        for table in sorted(named):
            info = tables.get(table)
            if info is None or info["rows"] < args.min_rows:
                continue
            findings.append({"check": "seq-scan", "subject": f"{table}@{statement_id(r['full_text'])[:8]}", "table": table,
                             "rows": info["rows"], "queryid": r["queryid"], "query": re.sub(r"\s+", " ", r["query"]),
                             "executions": int(r["no_index_used"]), "rows_examined": int(r["rows_examined"]),
                             "index_exists": None if scanned is None else False,
                             "note": "type ALL in EXPLAIN of the digest" if scanned is not None
                             else "digest ran without an index (not explained)"})

    # Indexes as column lists
    index_cols = defaultdict(lambda: {"cols": [], "unique": False, "type": ""})
    for r in my_json(db, MY_INDEX_COLUMNS, ["tbl", "idx", "non_unique", "seq_in_index", "col",
                                            "index_type", "sub_part"]):
        ix = index_cols[(r["tbl"], r["idx"])]
        ix["cols"].append((int(r["seq_in_index"]), r["col"] + (f"({r['sub_part']})" if r["sub_part"] else "")))
        ix["unique"] = int(r["non_unique"]) == 0
        ix["type"] = r["index_type"]
    usage = {(r["tbl"], r["idx"]): int(r["uses"]) for r in
             my_json(db, MY_INDEX_USAGE, ["tbl", "idx", "uses"])}
    fks = my_json(db, MY_FKS, ["tbl", "fk", "ref", "cols"])
    fk_names = {(r["tbl"], r["fk"]) for r in fks}
    indexes = []
    for (tbl, idx), ix in sorted(index_cols.items()):
        cols = [c for _, c in sorted(ix["cols"])]
        indexes.append({"tbl": tbl, "idx": idx, "is_unique": ix["unique"], "is_primary": idx == "PRIMARY",
                        "plain": True, "am": ix["type"], "keys": " ".join(cols), "opclasses": " ".join("x" for _ in cols),
                        "cols": ", ".join(cols), "constraint_name": idx if (ix["unique"] or (tbl, idx) in fk_names) else None,
                        "idx_scan": usage.get((tbl, idx), 0), "bytes": None,
                        "def": f"{'UNIQUE ' if ix['unique'] else ''}INDEX {idx} ON {tbl} ({', '.join(cols)})",
                        "oid": idx})

    for r in fks:
        cols = set(r["cols"].split(", "))
        if not any(set(ix["keys"].split()[:len(cols)]) == cols for ix in indexes if ix["tbl"] == r["tbl"]):
            findings.append({"check": "fk-no-index", "subject": f"{r['tbl']}.{r['fk']}", "table": r["tbl"],
                             "fk": r["fk"], "columns": r["cols"], "references": r["ref"],
                             "rows": tables.get(r["tbl"], {}).get("rows", 0)})

    for f in redundant_pairs(indexes):
        # InnoDB needs an index that leads with a foreign key's columns; a covering index does
        f["ddl"] = f"ALTER TABLE {f['table']} DROP INDEX {f['index']};"
        findings.append(f)

    for ix in indexes:
        if ix["idx_scan"] == 0:
            findings.append({"check": "unused-index", "subject": f"{ix['tbl']}.{ix['idx']}", "table": ix["tbl"],
                             "index": ix["idx"], "columns": ix["cols"], "constraint": ix["constraint_name"],
                             "unique": ix["is_unique"], "bytes": None,
                             "rows": tables.get(ix["tbl"], {}).get("rows", 0)})

    cols = ["queryid", "calls", "total_ms", "mean_ms", "rows_examined", "no_index_used", "query"]
    for check, order in (("top-total", "sum_timer_wait"), ("top-mean", "avg_timer_wait")):
        for r in my_json(db, MY_TOP.format(order=order, limit=args.top), cols):
            r["check"], r["subject"] = check, r["queryid"]
            findings.append(r)

    stats = my_json(db, "SELECT COUNT(*) AS statements, SUM(count_star) AS calls FROM gindex.workload_digests",
                    ["statements", "calls"])[0]
    stats["tables"], stats["indexes"] = len(tables), len(indexes)
    return findings, stats


# --------------------------------------------------------------------------------------------
# Allowlist and report
# --------------------------------------------------------------------------------------------

def read_allowlist(path, vendor):
    """Lines: `<check> <subject glob> [vendor=<v>] [required] -- <reason>`; '#' starts a comment.

    A `required` entry fails the audit when it matches nothing: it covers a finding the workload
    must keep producing until the fix lands, so the entry is removed then and cannot hide a later
    regression."""
    entries = []
    if not path or not os.path.exists(path):
        return entries
    with open(path, encoding="utf-8") as f:
        for n, raw in enumerate(f, 1):
            line = raw.split("#", 1)[0].strip() if not raw.lstrip().startswith("#") else ""
            if not line:
                continue
            if " -- " not in line:
                raise SystemExit(f"{path}:{n}: an allowlist entry needs ' -- <reason>'")
            head, reason = line.split(" -- ", 1)
            parts = head.split()
            if (len(parts) < 2 or parts[0] not in GATE_CHECKS or not reason.strip()
                    or any(p != "required" and not p.startswith("vendor=") for p in parts[2:])):
                raise SystemExit(f"{path}:{n}: expected '<check> <subject> [vendor=x] [required] -- <reason>'")
            only = [p.split("=", 1)[1] for p in parts[2:] if p.startswith("vendor=")]
            if only and vendor not in only:
                continue
            entries.append({"check": parts[0], "subject": parts[1], "reason": reason.strip(), "line": n,
                            "used": False, "required": "required" in parts[2:]})
    return entries


def apply_allowlist(findings, entries):
    for f in findings:
        if f["check"] not in GATE_CHECKS:
            continue
        for e in entries:
            # Case-insensitive: MariaDB reports index names upper case
            if e["check"] == f["check"] and fnmatch.fnmatchcase(f["subject"].lower(), e["subject"].lower()):
                f["allowed"] = e["reason"]
                e["used"] = True
                break


def md_escape(text):
    return str(text).replace("|", "\\|").replace("\n", " ")


def describe(f):
    c = f["check"]
    if c == "seq-scan":
        hint = "an index exists, the planner preferred a scan" if f.get("index_exists") else "no usable index"
        if f.get("index_exists") is None:
            hint = f.get("note", "not re-planned")
        return (f"`{f['table']}` ({f['rows']:,} rows), {f['executions']} executions, {hint}: "
                f"`{md_escape(f['query'][:220])}`")
    if c == "fk-no-index":
        return f"`{f['fk']}` ({f['columns']}) -> `{f['references']}`, {f['rows']:,} rows"
    if c in ("duplicate-index", "redundant-index"):
        return f"`{f['index']}` is covered by `{f['covered_by']}`"
    return ""


def report(findings, stats, args, entries):
    failing = [f for f in findings if f["check"] in GATE_CHECKS and not f.get("allowed")]
    allowed = [f for f in findings if f.get("allowed")]
    lines = [f"## G-index audit: {args.label or args.vendor}", ""]
    lines.append(f"{stats.get('statements')} distinct statements, {stats.get('calls')} executions captured"
                 + (f", {stats.get('plans')} executed plans read" if "plans" in stats else "")
                 + f"; {stats['tables']} tables, {stats['indexes']} indexes (audited: `{args.tables}`); "
                 f"seq-scan threshold {args.min_rows:,} rows.")
    lines.append("")
    lines.append("| Check | Failing | Allowlisted | Result |")
    lines.append("| --- | --- | --- | --- |")
    for check in GATE_CHECKS:
        fail = sum(1 for f in failing if f["check"] == check)
        ok = sum(1 for f in allowed if f["check"] == check)
        gone = sum(1 for e in entries if e["required"] and not e["used"] and e["check"] == check)
        result = "FAIL" if fail or gone else "pass"
        lines.append(f"| {check} | {fail}{f' (+{gone} stale)' if gone else ''} | {ok} | {result} |")
    unused = [f for f in findings if f["check"] == "unused-index"]
    lines.append(f"| unused-index (report) | {len(unused)} | | {sum(1 for f in unused if not f['constraint'])} "
                 f"not backing a constraint |")
    lines.append("")
    if failing:
        lines += ["### Failing findings", "", "| Check | Subject | Detail | Suggested DDL |", "| --- | --- | --- | --- |"]
        for f in failing:
            lines.append(f"| {f['check']} | `{f['subject']}` | {describe(f)} | `{md_escape(f.get('ddl', ''))}` |")
        lines.append("")
    if allowed:
        lines += ["<details><summary>Allowlisted findings</summary>", "",
                  "| Check | Subject | Detail | Reason |", "| --- | --- | --- | --- |"]
        for f in allowed:
            lines.append(f"| {f['check']} | `{f['subject']}` | {describe(f)} | {md_escape(f['allowed'])} |")
        lines += ["", "</details>", ""]
    missing = [e for e in entries if e["required"] and not e["used"]]
    if missing:
        lines += ["### Stale required allowlist entries", "",
                  "These entries matched nothing. Remove them if their fix has landed; otherwise the workload "
                  "stopped producing the finding they cover.", ""]
        lines += [f"- `{e['check']} {e['subject']}` (line {e['line']}): {md_escape(e['reason'])}" for e in missing]
        lines.append("")
    stale = [e for e in entries if not e["used"] and not e["required"]]
    if stale:
        lines.append("Allowlist entries that matched nothing: "
                     + ", ".join(f"`{e['check']} {e['subject']}` (line {e['line']})" for e in stale))
        lines.append("")
    if unused:
        lines += ["<details><summary>Unused indexes (removal candidates)</summary>", "",
                  "| Index | Table rows | Columns | Backs |", "| --- | --- | --- | --- |"]
        for f in sorted(unused, key=lambda f: (f["constraint"] is not None, -(f["rows"] or 0))):
            lines.append(f"| `{f['subject']}` | {f['rows']:,} | {f['columns']} | {f['constraint'] or ''} |")
        lines += ["", "</details>", ""]
    for check, title in (("top-total", "Top statements by total time"), ("top-mean", "Top statements by mean time")):
        top = [f for f in findings if f["check"] == check]
        lines += [f"<details><summary>{title}</summary>", "", "| Calls | Total ms | Mean ms | Statement |",
                  "| ---: | ---: | ---: | --- |"]
        for f in top:
            lines.append(f"| {f['calls']} | {f['total_ms']} | {f['mean_ms']} | `{md_escape(f['query'][:300])}` |")
        lines += ["", "</details>", ""]
    return failing, missing, "\n".join(lines) + "\n"


def annotate(failing, missing, label):
    if os.environ.get("GITHUB_ACTIONS") != "true":
        return
    # A run that is meant to fail (seeded faults) reports its findings as notices
    level = os.environ.get("GINDEX_ANNOTATION_LEVEL", "error")
    for f in failing[:10]:
        text = f"{f['check']} {f['subject']}: {describe(f)}"
        if f.get("ddl"):
            text += f" Suggested: {f['ddl']}"
        text = text.replace("%", "%25").replace("\r", "%0D").replace("\n", "%0A")
        title = f"G-index {label}: {f['check']}".replace(":", "%3A").replace(",", "%2C")
        print(f"::{level} title={title}::{text}")
    if len(failing) > 10:
        print(f"::{level} title=G-index {label}::{len(failing) - 10} more failing findings; see the job summary")
    for e in missing:
        title = f"G-index {label}: stale allowlist entry".replace(":", "%3A").replace(",", "%2C")
        print(f"::{level} title={title}::{e['check']} {e['subject']} (allowlist line {e['line']}) matched nothing")


def main():
    p = argparse.ArgumentParser(description=__doc__.split("\n")[0])
    p.add_argument("--vendor", choices=["postgres", "mariadb"], required=True)
    p.add_argument("--container", required=True)
    p.add_argument("--user", default="uportal")
    p.add_argument("--password", default="uportal")
    p.add_argument("--database", default="uportal")
    p.add_argument("--plans", nargs="*", default=[], help="PostgreSQL jsonlog files with auto_explain plans")
    p.add_argument("--allowlist", default=os.path.join(os.path.dirname(os.path.abspath(__file__)), "allowlist.txt"))
    p.add_argument("--min-rows", type=int, default=1000,
                   help="seq-scan check: smallest table that counts (x10 when an index could serve the scan)")
    p.add_argument("--top", type=int, default=15)
    p.add_argument("--tables", default="up_*",
                   help="glob of the tables audited (default: uPortal's own; the portlets' tables keep their 5.x schema)")
    p.add_argument("--label", default="")
    p.add_argument("--out", required=True)
    args = p.parse_args()

    db = Database(args.vendor, args.container, args.user, args.password, args.database)
    entries = read_allowlist(args.allowlist, args.vendor)
    try:
        findings, stats = (audit_postgres if args.vendor == "postgres" else audit_mariadb)(db, args)
    except RuntimeError as e:
        print(f"G-index audit could not query the database: {e}", file=sys.stderr)
        return 2
    findings = [f for f in findings if "table" not in f or fnmatch.fnmatchcase(f["table"], args.tables)]
    apply_allowlist(findings, entries)
    failing, missing, summary = report(findings, stats, args, entries)

    os.makedirs(args.out, exist_ok=True)
    with open(os.path.join(args.out, "findings.json"), "w", encoding="utf-8") as f:
        json.dump({"stats": stats, "findings": findings}, f, indent=1, default=str)
    with open(os.path.join(args.out, "summary.md"), "w", encoding="utf-8") as f:
        f.write(summary)
    if os.environ.get("GITHUB_STEP_SUMMARY"):
        with open(os.environ["GITHUB_STEP_SUMMARY"], "a", encoding="utf-8") as f:
            f.write(summary)
    print(summary)
    annotate(failing, missing, args.label or args.vendor)
    if failing or missing:
        print(f"G-index audit FAILED: {len(failing)} finding(s) not on the allowlist, {len(missing)} stale "
              f"required entr{'y' if len(missing) == 1 else 'ies'} ({os.path.relpath(args.allowlist)})",
              file=sys.stderr)
        return 1
    print("G-index audit passed")
    return 0


if __name__ == "__main__":
    sys.exit(main())
