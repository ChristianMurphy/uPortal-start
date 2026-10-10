package org.apereo.portal.start.db

import java.sql.Connection
import java.sql.DatabaseMetaData
import java.sql.PreparedStatement
import java.sql.ResultSet
import java.sql.ResultSetMetaData
import java.sql.Statement
import java.util.regex.Pattern

/**
 * Reads the tables, columns, keys, constraints, indexes, sequences, row counts and generator-table
 * contents of the connection's default catalog/schema and renders them as sorted, one-fact-per-line
 * text.
 *
 * Two views are rendered:
 * <ul>
 *   <li>{@code schema.txt}: the real object names, except names the database invents by itself
 *       (e.g. Oracle {@code SYS_C0012345}), which are masked so reruns stay identical</li>
 *   <li>{@code schema-normalized.txt}: identifiers upper-cased and constraint/index names removed,
 *       so a constraint is identified by what it does (its table and columns), not what it is
 *       called</li>
 * </ul>
 * Comparing both views tells "the structure changed" apart from "only the names changed".
 */
class SchemaSnapshot {

    enum Family { HSQLDB, POSTGRESQL, MYSQL, MARIADB, SQLSERVER, ORACLE, OTHER }

    static final String MASKED = '<db-generated>'

    /** Names the database (not uPortal or Hibernate) chooses for unnamed constraints and indexes. */
    static final List<Pattern> DB_GENERATED_NAMES = [
        ~/^SYS_(IDX|PK|FK|CT|AC|REF)_.*\d+$/,       // HSQLDB
        ~/^SYS_(C|IL|LOB)[0-9A-Z$]*$/,              // Oracle
        ~/^(PK|UQ|FK|DF|CK)__.+__[0-9A-F]{8,}$/,    // SQL Server
    ]

    /** Sections in the order they are written. */
    static final List<String> SECTIONS = [
        'tables', 'table options', 'columns', 'primary keys', 'unique constraints', 'foreign keys',
        'check constraints', 'indexes', 'sequences', 'row counts', 'generator table rows',
    ]

    /** Sections whose lines are "<table> <name> <definition>". */
    static final List<String> NAMED_SECTIONS = [
        'primary keys', 'unique constraints', 'foreign keys', 'check constraints', 'indexes',
    ]

    Family family
    String productName
    String productVersion
    String driverName
    String driverVersion
    String catalog
    String schema
    private String quote

    final Map<String, List<String>> raw = [:]
    final Map<String, List<String>> normalized = [:]
    /** Names of the tables whose rows were dumped, for use by the generator inventory. */
    final Set<String> generatorTables = new TreeSet<>(String.CASE_INSENSITIVE_ORDER)
    /** Sequence name (upper case) to its attributes. */
    final Map<String, Map<String, String>> sequenceInfo = new TreeMap<>(String.CASE_INSENSITIVE_ORDER)
    /** Table name, as stored in the database. */
    final Set<String> tableNames = new TreeSet<>(String.CASE_INSENSITIVE_ORDER)
    /** Table name (case-insensitive) to its column names. */
    final Map<String, List<String>> tableColumns = new TreeMap<>(String.CASE_INSENSITIVE_ORDER)

    static Family familyOf(String product, String version) {
        String p = (product ?: '').toLowerCase(Locale.ROOT)
        String v = (version ?: '').toLowerCase(Locale.ROOT)
        if (p.contains('hsql')) return Family.HSQLDB
        if (p.contains('postgres')) return Family.POSTGRESQL
        if (p.contains('mariadb') || (p.contains('mysql') && v.contains('mariadb'))) return Family.MARIADB
        if (p.contains('mysql')) return Family.MYSQL
        if (p.contains('microsoft sql server')) return Family.SQLSERVER
        if (p.contains('oracle')) return Family.ORACLE
        return Family.OTHER
    }

    /**
     * @param extraGeneratorTables names of tables that back ID generators but cannot be recognised
     *     from their structure alone; their rows are dumped as well
     */
    static SchemaSnapshot read(Connection c, Collection<String> extraGeneratorTables) {
        SchemaSnapshot s = new SchemaSnapshot()
        s.load(c, extraGeneratorTables ?: [])
        return s
    }

    private void load(Connection c, Collection<String> extraGeneratorTables) {
        DatabaseMetaData md = c.metaData
        productName = md.databaseProductName
        productVersion = md.databaseProductVersion
        driverName = md.driverName
        driverVersion = md.driverVersion
        family = familyOf(productName, productVersion)
        catalog = c.catalog
        schema = c.schema
        if (family == Family.MYSQL || family == Family.MARIADB) {
            schema = null  // MySQL/MariaDB databases are JDBC catalogs
        }
        quote = (md.identifierQuoteString ?: '"').trim() ?: '"'

        SECTIONS.each { raw[it] = []; normalized[it] = [] }

        Set<String> sequenceNames = readSequences(c)
        readTables(md, sequenceNames)
        readTableOptions(c)
        readColumns(md)
        readPrimaryKeys(md)
        readUniqueConstraints(c)
        readForeignKeys(md)
        readCheckConstraints(c)
        readIndexes(md)
        readRowCounts(c)
        readGeneratorTables(c, extraGeneratorTables)

        SECTIONS.each { Collections.sort(raw[it]); Collections.sort(normalized[it]) }
    }

    // ---------------------------------------------------------------- tables and columns

    private void readTables(DatabaseMetaData md, Set<String> sequenceNames) {
        ResultSet rs = md.getTables(catalog, schema, '%', ['TABLE'] as String[])
        try {
            while (rs.next()) {
                String name = rs.getString('TABLE_NAME')
                if (!inScope(rs.getString('TABLE_CAT'), rs.getString('TABLE_SCHEM'))) continue
                if (name.startsWith('BIN$')) continue  // Oracle recycle bin
                if (sequenceNames.contains(name.toUpperCase(Locale.ROOT))) continue  // MariaDB sequences
                tableNames << name
            }
        } finally {
            rs.close()
        }
        tableNames.each {
            raw['tables'] << it
            normalized['tables'] << up(it)
        }
    }

    /** MySQL/MariaDB only: storage engine, row format (the compressed dialect sets it) and collation. */
    private void readTableOptions(Connection c) {
        if (family != Family.MYSQL && family != Family.MARIADB) return
        query(c, '''select TABLE_NAME, ENGINE, ROW_FORMAT, TABLE_COLLATION, CREATE_OPTIONS
                    from INFORMATION_SCHEMA.TABLES where TABLE_SCHEMA = ? and TABLE_TYPE = 'BASE TABLE\'''', [catalog]) { ResultSet rs ->
            String table = rs.getString(1)
            if (!tableNames.contains(table)) return
            String options = "engine=${rs.getString(2)} row_format=${rs.getString(3)} collation=${rs.getString(4)} create_options=${oneLine(rs.getString(5) ?: '') ?: '-'}"
            raw['table options'] << "${table} ${options}".toString()
            normalized['table options'] << "${up(table)} ${options}".toString()
        }
    }

    private void readColumns(DatabaseMetaData md) {
        ResultSet rs = md.getColumns(catalog, schema, '%', '%')
        try {
            while (rs.next()) {
                String table = rs.getString('TABLE_NAME')
                if (!tableNames.contains(table) || !inScope(rs.getString('TABLE_CAT'), rs.getString('TABLE_SCHEM'))) continue
                String column = rs.getString('COLUMN_NAME')
                String type = rs.getString('TYPE_NAME')
                String size = rs.getString('COLUMN_SIZE')
                String digits = rs.getString('DECIMAL_DIGITS')
                boolean notNull = rs.getInt('NULLABLE') == DatabaseMetaData.columnNoNulls
                String dflt = rs.getString('COLUMN_DEF')
                String auto = safeString(rs, 'IS_AUTOINCREMENT')

                StringBuilder sb = new StringBuilder(type)
                if (size != null) {
                    sb.append('(').append(size)
                    if (digits != null) sb.append(',').append(digits)
                    sb.append(')')
                }
                if (notNull) sb.append(' not null')
                if (dflt != null && dflt.trim()) sb.append(' default ').append(oneLine(dflt.trim()))
                if ('YES'.equalsIgnoreCase(auto)) sb.append(' auto-increment')

                raw['columns'] << "${table}.${column} ${sb}".toString()
                normalized['columns'] << "${up(table)}.${up(column)} ${sb}".toString()
                tableColumns.computeIfAbsent(table) { [] } << column
            }
        } finally {
            rs.close()
        }
    }

    // ---------------------------------------------------------------- keys and constraints

    private void readPrimaryKeys(DatabaseMetaData md) {
        tableNames.each { String table ->
            Map<Integer, String> cols = new TreeMap<>()
            String pkName = null
            ResultSet rs = md.getPrimaryKeys(catalog, schema, table)
            try {
                while (rs.next()) {
                    cols[rs.getInt('KEY_SEQ')] = rs.getString('COLUMN_NAME')
                    pkName = rs.getString('PK_NAME')
                }
            } finally {
                rs.close()
            }
            if (cols) {
                addNamed('primary keys', table, pkName, "(${cols.values().join(', ')})", "(${up(cols.values().join(', '))})")
            }
        }
    }

    private void readUniqueConstraints(Connection c) {
        String sql
        List<Object> params = []
        switch (family) {
            case Family.POSTGRESQL:
                sql = '''select cl.relname, c.conname, a.attname, k.ord
                         from pg_constraint c
                         join pg_class cl on cl.oid = c.conrelid
                         cross join lateral unnest(c.conkey) with ordinality as k(attnum, ord)
                         join pg_attribute a on a.attrelid = c.conrelid and a.attnum = k.attnum
                         where c.contype = 'u'
                           and c.connamespace = (select oid from pg_namespace where nspname = current_schema())'''
                break
            case Family.ORACLE:
                sql = '''select c.TABLE_NAME, c.CONSTRAINT_NAME, cc.COLUMN_NAME, cc.POSITION
                         from USER_CONSTRAINTS c
                         join USER_CONS_COLUMNS cc on cc.CONSTRAINT_NAME = c.CONSTRAINT_NAME
                         where c.CONSTRAINT_TYPE = 'U\''''
                break
            default:
                sql = '''select tc.TABLE_NAME, tc.CONSTRAINT_NAME, kcu.COLUMN_NAME, kcu.ORDINAL_POSITION
                         from INFORMATION_SCHEMA.TABLE_CONSTRAINTS tc
                         join INFORMATION_SCHEMA.KEY_COLUMN_USAGE kcu
                           on kcu.CONSTRAINT_NAME = tc.CONSTRAINT_NAME
                          and kcu.CONSTRAINT_SCHEMA = tc.CONSTRAINT_SCHEMA
                          and kcu.TABLE_NAME = tc.TABLE_NAME
                         where tc.CONSTRAINT_TYPE = 'UNIQUE' and tc.TABLE_SCHEMA = ?'''
                params << (schema ?: catalog)
        }
        Map<String, Map<Integer, String>> byConstraint = new TreeMap<>()
        query(c, sql, params) { ResultSet rs ->
            String table = rs.getString(1)
            if (!tableNames.contains(table)) return
            String key = "${table}\u0000${rs.getString(2)}".toString()
            byConstraint.computeIfAbsent(key) { new TreeMap<>() }[rs.getInt(4)] = rs.getString(3)
        }
        byConstraint.each { String key, Map<Integer, String> cols ->
            String[] parts = key.split('\u0000', 2)
            addNamed('unique constraints', parts[0], parts[1], "(${cols.values().join(', ')})", "(${up(cols.values().join(', '))})")
        }
    }

    private void readForeignKeys(DatabaseMetaData md) {
        tableNames.each { String table ->
            Map<String, Map> fks = new TreeMap<>()
            ResultSet rs = md.getImportedKeys(catalog, schema, table)
            try {
                while (rs.next()) {
                    String fkName = rs.getString('FK_NAME') ?: "<unnamed-${rs.getString('PKTABLE_NAME')}>"
                    Map fk = fks.computeIfAbsent(fkName) {
                        [refTable: rs.getString('PKTABLE_NAME'), cols: new TreeMap<Integer, String>(), refCols: new TreeMap<Integer, String>(),
                         update: rule(rs.getInt('UPDATE_RULE')), delete: rule(rs.getInt('DELETE_RULE'))]
                    }
                    fk.cols[rs.getInt('KEY_SEQ')] = rs.getString('FKCOLUMN_NAME')
                    fk.refCols[rs.getInt('KEY_SEQ')] = rs.getString('PKCOLUMN_NAME')
                }
            } finally {
                rs.close()
            }
            fks.each { String name, Map fk ->
                String cols = fk.cols.values().join(', ')
                String refCols = fk.refCols.values().join(', ')
                String rules = "on-update=${fk.update} on-delete=${fk.delete}"
                addNamed('foreign keys', table, name,
                        "(${cols}) -> ${fk.refTable} (${refCols}) ${rules}",
                        "(${up(cols)}) -> ${up(fk.refTable)} (${up(refCols)}) ${rules}")
            }
        }
    }

    private void readCheckConstraints(Connection c) {
        String sql
        List<Object> params = []
        switch (family) {
            case Family.POSTGRESQL:
                sql = '''select cl.relname, c.conname, pg_get_constraintdef(c.oid)
                         from pg_constraint c join pg_class cl on cl.oid = c.conrelid
                         where c.contype = 'c'
                           and c.connamespace = (select oid from pg_namespace where nspname = current_schema())'''
                break
            case Family.ORACLE:
                sql = '''select TABLE_NAME, CONSTRAINT_NAME, SEARCH_CONDITION_VC
                         from USER_CONSTRAINTS where CONSTRAINT_TYPE = 'C\''''
                break
            case Family.SQLSERVER:
                sql = '''select t.name, cc.name, cc.definition
                         from sys.check_constraints cc join sys.tables t on t.object_id = cc.parent_object_id
                         where t.schema_id = schema_id()'''
                break
            case Family.MARIADB:
                sql = '''select TABLE_NAME, CONSTRAINT_NAME, CHECK_CLAUSE
                         from INFORMATION_SCHEMA.CHECK_CONSTRAINTS where CONSTRAINT_SCHEMA = ?'''
                params << catalog
                break
            default:
                sql = '''select tc.TABLE_NAME, tc.CONSTRAINT_NAME, cc.CHECK_CLAUSE
                         from INFORMATION_SCHEMA.TABLE_CONSTRAINTS tc
                         join INFORMATION_SCHEMA.CHECK_CONSTRAINTS cc
                           on cc.CONSTRAINT_NAME = tc.CONSTRAINT_NAME and cc.CONSTRAINT_SCHEMA = tc.CONSTRAINT_SCHEMA
                         where tc.CONSTRAINT_TYPE = 'CHECK' and tc.TABLE_SCHEMA = ?'''
                params << (schema ?: catalog)
        }
        query(c, sql, params) { ResultSet rs ->
            String table = rs.getString(1)
            String clause = oneLine(rs.getString(3) ?: '')
            if (!tableNames.contains(table)) return
            // NOT NULL is already part of the column definition; HSQLDB and Oracle also list it here
            if (clause ==~ /(?i)^\(?("?[\w.$]+"?\.)*"?[\w$]+"? IS NOT NULL\)?$/) return
            addNamed('check constraints', table, rs.getString(2), "check ${clause}", "check ${clause}")
        }
    }

    private void readIndexes(DatabaseMetaData md) {
        tableNames.each { String table ->
            Map<String, Map> indexes = new TreeMap<>()
            ResultSet rs = md.getIndexInfo(catalog, schema, table, false, true)
            try {
                while (rs.next()) {
                    String name = rs.getString('INDEX_NAME')
                    if (name == null || rs.getInt('TYPE') == (int) DatabaseMetaData.tableIndexStatistic) continue
                    Map ix = indexes.computeIfAbsent(name) { [unique: !rs.getBoolean('NON_UNIQUE'), cols: new TreeMap<Integer, String>()] }
                    String col = rs.getString('COLUMN_NAME')
                    if ('D'.equals(rs.getString('ASC_OR_DESC'))) col += ' desc'
                    ix.cols[rs.getInt('ORDINAL_POSITION')] = col
                }
            } finally {
                rs.close()
            }
            indexes.each { String name, Map ix ->
                String kind = ix.unique ? 'unique ' : ''
                String cols = ix.cols.values().join(', ')
                addNamed('indexes', table, name, "${kind}(${cols})", "${kind}(${up(cols)})")
            }
        }
    }

    // ---------------------------------------------------------------- sequences and data

    /** Reads sequences; returns their upper-cased names. */
    private Set<String> readSequences(Connection c) {
        List<Map<String, String>> seqs = []
        Closure<Void> collect = { ResultSet rs ->
            ResultSetMetaData rmd = rs.metaData
            Map<String, String> row = [:]
            // Aliases carry a seq_ prefix because INCREMENT, MIN, MAX... are reserved words on some databases
            (1..rmd.columnCount).each { row[rmd.getColumnLabel(it).toLowerCase(Locale.ROOT) - 'seq_'] = text(rs.getObject(it)) }
            seqs << row
        }
        switch (family) {
            case Family.POSTGRESQL:
                query(c, '''select sequencename as seq_name, start_value as seq_start, increment_by as seq_increment,
                                   min_value as seq_min, max_value as seq_max, cycle, cache_size as seq_cache, last_value as seq_value
                            from pg_sequences where schemaname = current_schema()''', [], collect)
                break
            case Family.HSQLDB:
                query(c, '''select SEQUENCE_NAME as seq_name, START_WITH as seq_start, INCREMENT as seq_increment,
                                   MINIMUM_VALUE as seq_min, MAXIMUM_VALUE as seq_max, CYCLE_OPTION as seq_cycle, NEXT_VALUE as seq_value
                            from INFORMATION_SCHEMA.SEQUENCES where SEQUENCE_SCHEMA = ?''', [schema], collect)
                break
            case Family.ORACLE:
                query(c, '''select SEQUENCE_NAME as seq_name, INCREMENT_BY as seq_increment, MIN_VALUE as seq_min,
                                   MAX_VALUE as seq_max, CYCLE_FLAG as seq_cycle, CACHE_SIZE as seq_cache, LAST_NUMBER as seq_value
                            from USER_SEQUENCES''', [], collect)
                break
            case Family.SQLSERVER:
                query(c, '''select name as seq_name, start_value as seq_start, increment, minimum_value as seq_min, maximum_value as seq_max,
                                   is_cycling as seq_cycle, cache_size as seq_cache, current_value as seq_value
                            from sys.sequences where schema_id = schema_id()''', [], collect)
                break
            case Family.MARIADB:
                List<String> names = []
                query(c, '''select TABLE_NAME from INFORMATION_SCHEMA.TABLES
                            where TABLE_SCHEMA = ? and TABLE_TYPE = 'SEQUENCE\'''', [catalog]) { ResultSet rs -> names << rs.getString(1) }
                names.each { String name ->
                    query(c, """select '${name}' as seq_name, start_value as seq_start, increment, minimum_value as seq_min,
                                       maximum_value as seq_max, cycle_option as seq_cycle, cache_size as seq_cache,
                                       next_not_cached_value as seq_value from ${q(name)}""".toString(), [], collect)
                }
                break
            default:
                break  // MySQL has no sequences
        }
        Set<String> names = new HashSet<>()
        seqs.each { Map<String, String> row ->
            String name = row.remove('name')
            names << name.toUpperCase(Locale.ROOT)
            sequenceInfo[name] = new TreeMap<>(row)
            String attrs = ['start', 'increment', 'min', 'max', 'cycle', 'cache', 'value']
                    .findAll { row.containsKey(it) }.collect { "${it}=${row[it]}" }.join(' ')
            raw['sequences'] << "${name} ${attrs}".toString()
            normalized['sequences'] << "${up(name)} ${attrs}".toString()
        }
        return names
    }

    private void readRowCounts(Connection c) {
        tableNames.each { String table ->
            query(c, "select count(*) from ${q(table)}".toString(), []) { ResultSet rs ->
                raw['row counts'] << "${table} ${rs.getLong(1)}".toString()
                normalized['row counts'] << "${up(table)} ${rs.getLong(1)}".toString()
            }
        }
    }

    /**
     * Dumps every table that stores generator state: UP_SEQUENCE (uPortal's counter store), any
     * table shaped like a Hibernate table generator or a sequence emulated by a table (a NEXT_VAL
     * or *_NEXT_HI_VALUE column), and the tables named by the caller.
     */
    private void readGeneratorTables(Connection c, Collection<String> extra) {
        Set<String> wanted = new TreeSet<>(String.CASE_INSENSITIVE_ORDER)
        wanted.addAll(extra)
        wanted.addAll(['UP_SEQUENCE', 'hibernate_sequences', 'hibernate_sequence', 'hibernate_unique_key'])
        tableNames.each { String table ->
            List<String> cols = tableColumns[table] ?: []
            boolean generatorShaped = cols.any { it.equalsIgnoreCase('next_val') || it.toLowerCase(Locale.ROOT).endsWith('next_hi_value') || it.equalsIgnoreCase('next_hi') }
            if (!(generatorShaped || wanted.contains(table))) return
            generatorTables << table
            query(c, "select * from ${q(table)}".toString(), []) { ResultSet rs ->
                ResultSetMetaData rmd = rs.metaData
                String row = (1..rmd.columnCount).collect { "${rmd.getColumnLabel(it)}=${text(rs.getObject(it))}" }.join(' ')
                String nrow = (1..rmd.columnCount).collect { "${up(rmd.getColumnLabel(it))}=${text(rs.getObject(it))}" }.join(' ')
                raw['generator table rows'] << "${table} ${row}".toString()
                normalized['generator table rows'] << "${up(table)} ${nrow}".toString()
            }
        }
    }

    // ---------------------------------------------------------------- rendering

    List<String> render(boolean normalizedView, Map<String, String> header) {
        List<String> out = []
        out << (normalizedView
                ? '# uPortal schema snapshot, normalized: identifiers upper-cased, constraint and index names removed'
                : '# uPortal schema snapshot with object names (names the database generates itself are shown as ' + MASKED + ')')
        out << "# Lines starting with '#' are informational; snapshot comparison ignores them."
        (header ?: [:]).each { k, v -> out << "# ${k}: ${v}".toString() }
        out << "# database: ${productName} ${oneLine(productVersion)}".toString()
        out << "# jdbc driver: ${driverName} ${driverVersion}".toString()
        out << "# catalog: ${catalog}  schema: ${schema}".toString()
        out << '# sequence value: last_value (PostgreSQL), next value (HSQLDB), LAST_NUMBER incl. cache (Oracle), current_value (SQL Server), next_not_cached_value (MariaDB)'
        Map<String, List<String>> view = normalizedView ? normalized : raw
        SECTIONS.each { String section ->
            if (section == 'table options' && family != Family.MYSQL && family != Family.MARIADB) return
            out << "[${section}]".toString()
            out.addAll(view[section])
        }
        return out
    }

    // ---------------------------------------------------------------- helpers

    private void addNamed(String section, String table, String name, String rawDef, String normDef) {
        raw[section] << "${table} ${displayName(name)} ${rawDef}".toString()
        normalized[section] << "${up(table)} ${normDef}".toString()
    }

    static String displayName(String name) {
        if (name == null) return MASKED
        return DB_GENERATED_NAMES.any { name ==~ it } ? MASKED : name
    }

    private boolean inScope(String cat, String sch) {
        if (schema != null && sch != null && !schema.equalsIgnoreCase(sch)) return false
        if (catalog != null && cat != null && !catalog.equalsIgnoreCase(cat)) return false
        return true
    }

    String q(String identifier) {
        return "${quote}${identifier}${quote}".toString()
    }

    static String up(String s) {
        return s == null ? null : s.toUpperCase(Locale.ROOT)
    }

    static String oneLine(String s) {
        return s == null ? null : s.replaceAll(/\s+/, ' ').trim()
    }

    static String text(Object value) {
        if (value == null) return 'null'
        if (value instanceof BigDecimal) return ((BigDecimal) value).stripTrailingZeros().toPlainString()
        if (value instanceof Number || value instanceof Boolean) return value.toString()
        return oneLine(value.toString())
    }

    private static String safeString(ResultSet rs, String column) {
        try {
            return rs.getString(column)
        } catch (Exception ignored) {
            return null
        }
    }

    private static String rule(int r) {
        switch (r) {
            case DatabaseMetaData.importedKeyCascade: return 'cascade'
            case DatabaseMetaData.importedKeySetNull: return 'set-null'
            case DatabaseMetaData.importedKeySetDefault: return 'set-default'
            case DatabaseMetaData.importedKeyRestrict: return 'restrict'
            default: return 'no-action'
        }
    }

    static void query(Connection c, String sql, List<Object> params, Closure<?> onRow) {
        PreparedStatement ps = c.prepareStatement(sql)
        try {
            params.eachWithIndex { Object p, int i -> ps.setObject(i + 1, p) }
            ResultSet rs = ps.executeQuery()
            try {
                while (rs.next()) {
                    onRow(rs)
                }
            } finally {
                rs.close()
            }
        } finally {
            ps.close()
        }
    }
}
