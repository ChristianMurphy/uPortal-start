package org.apereo.portal.start.db

import java.sql.Connection
import java.sql.ResultSet

/**
 * PostgreSQL only (MOD-I24): finds the columns that hold large-object OIDs and works out what
 * {@code vacuumlo} would do to them.
 *
 * Hibernate up to 5.6.1 maps a {@code @Lob String} to a {@code text} column on PostgreSQL but
 * binds the value as a CLOB, so the driver writes a large object and stores its OID, as digits, in
 * the {@code text} column. {@code vacuumlo} only treats columns of type {@code oid} or {@code lo}
 * as references, so it deletes every large object that is referenced only from a {@code text}
 * column. The report counts, per column, how many values are such OIDs.
 */
class PostgresLobReport {

    static List<String> run(Connection c) {
        List<String> out = []
        out << '# PostgreSQL large-object (LOB) report (MOD-I24)'
        out << '# vacuumlo deletes every large object whose OID is not stored in a column of type oid or lo.'
        out << '# A text column whose values are OIDs of existing large objects therefore loses data to vacuumlo.'

        List<Map<String, String>> columns = []
        SchemaSnapshot.query(c, '''select table_name, column_name, data_type, udt_name
                                   from information_schema.columns
                                   where table_schema = current_schema()
                                     and (data_type in ('text', 'oid') or udt_name in ('oid', 'lo'))
                                   order by table_name, column_name''', []) { ResultSet rs ->
            columns << [table: rs.getString(1), column: rs.getString(2), type: rs.getString(4)]
        }

        long total = scalar(c, 'select count(*) from pg_largeobject_metadata')
        out << '[large objects]'
        out << "total=${total}".toString()

        Set<Long> referencedByOidColumns = new TreeSet<>()
        Set<Long> referencedByTextColumns = new TreeSet<>()
        out << '[columns]'
        columns.each { Map<String, String> col ->
            String ref = "\"${col.table}\".\"${col.column}\""
            if (col.type == 'text') {
                long nonNull = 0, oidLike = 0, live = 0
                SchemaSnapshot.query(c, """select t.${q(col.column)}, m.oid is not null
                                           from ${q(col.table)} t
                                           left join pg_largeobject_metadata m
                                             on t.${q(col.column)} ~ '^[0-9]{1,10}\$'
                                            and m.oid = (case when t.${q(col.column)} ~ '^[0-9]{1,10}\$'
                                                              and t.${q(col.column)}::bigint < 4294967296
                                                         then t.${q(col.column)}::bigint::oid end)
                                           where t.${q(col.column)} is not null""".toString(), []) { ResultSet rs ->
                    nonNull++
                    String v = rs.getString(1)
                    if (v ==~ /[0-9]{1,10}/) oidLike++
                    if (rs.getBoolean(2)) {
                        live++
                        referencedByTextColumns << Long.valueOf(v)
                    }
                }
                String verdict = live > 0 ? 'HOLDS LOB OIDS (vacuumlo would delete them)' : (nonNull == 0 ? 'empty' : 'plain text')
                out << "${col.table}.${col.column} type=text non-null=${nonNull} oid-like=${oidLike} live-lob-refs=${live} -> ${verdict}".toString()
            } else {
                long nonNull = 0, live = 0
                SchemaSnapshot.query(c, """select t.${q(col.column)}::bigint, m.oid is not null
                                           from ${q(col.table)} t
                                           left join pg_largeobject_metadata m on m.oid = t.${q(col.column)}
                                           where t.${q(col.column)} is not null""".toString(), []) { ResultSet rs ->
                    nonNull++
                    if (rs.getBoolean(2)) {
                        live++
                        referencedByOidColumns << rs.getLong(1)
                    }
                }
                out << "${col.table}.${col.column} type=${col.type} non-null=${nonNull} live-lob-refs=${live} -> protected from vacuumlo".toString()
            }
        }

        Set<Long> onlyText = new TreeSet<>(referencedByTextColumns)
        onlyText.removeAll(referencedByOidColumns)
        long unreferenced = total - (referencedByTextColumns + referencedByOidColumns).size()
        out << '[vacuumlo simulation]'
        out << "large objects referenced from oid/lo columns (kept): ${referencedByOidColumns.size()}".toString()
        out << "large objects referenced only from text columns (DELETED, data loss): ${onlyText.size()}".toString()
        out << "large objects not referenced anywhere in this schema (deleted, orphans): ${unreferenced}".toString()
        out << "total vacuumlo would remove: ${total - referencedByOidColumns.size()}".toString()
        return out
    }

    private static String q(String identifier) {
        return '"' + identifier.replace('"', '""') + '"'
    }

    private static long scalar(Connection c, String sql) {
        long v = 0
        SchemaSnapshot.query(c, sql, []) { ResultSet rs -> v = rs.getLong(1) }
        return v
    }
}
