package org.apereo.portal.start.db

import java.lang.annotation.Annotation
import java.lang.reflect.AnnotatedElement
import java.lang.reflect.Field
import java.lang.reflect.Method
import java.sql.Connection
import java.sql.DatabaseMetaData
import java.sql.ResultSet
import java.util.jar.JarEntry
import java.util.jar.JarFile

/**
 * Lists every entity whose identifier is generated, the generator definitions it can resolve to
 * (an entity may declare both a @SequenceGenerator and a @TableGenerator under one name), and the
 * database object that actually backs it after dataInit: a sequence, a table emulating a sequence,
 * or a row in a generator table.
 *
 * Entities are found by scanning the deployed uPortal jars and reading the JPA annotations
 * reflectively by name, so the same code works for javax.persistence and jakarta.persistence.
 */
class GeneratorInventory {

    static class GeneratorDef {
        String kind       // sequence | table | generic
        String name
        Map<String, Object> attrs
        String declaredOn
    }

    static class GeneratedId {
        String entity
        String table
        String idColumn
        String strategy
        String generator
        /** The entity and its superclasses, nearest first. */
        List<String> hierarchy = []
    }

    final List<GeneratedId> ids = []
    final Map<String, List<GeneratorDef>> generatorsByName = new TreeMap<>()
    String dialect = 'unresolved'
    int scannedEntities = 0

    /**
     * @param classpath everything the entity classes need to load (WEB-INF/classes, WEB-INF/lib,
     *     Tomcat lib and shared/lib)
     * @param scanned the jars and class directories to look for entities in
     */
    static GeneratorInventory scan(List<File> classpath, List<File> scanned, Connection connection) {
        GeneratorInventory inv = new GeneratorInventory()
        URLClassLoader loader = new URLClassLoader(classpath.collect { it.toURI().toURL() } as URL[], DbConnector.platformClassLoader())
        try {
            List<Class<?>> classes = []
            scanned.each { File f -> candidateClassNames(f).each { String name ->
                try {
                    classes << Class.forName(name, false, loader)
                } catch (Throwable ignored) {
                    // not loadable without optional dependencies; not a mapped entity in practice
                }
            } }
            classes.sort { it.name }
            classes.each { inv.collectGenerators(it) }
            classes.findAll { annotation(it, 'Entity') != null }.each { inv.scannedEntities++; inv.collectId(it) }
            inv.ids.sort { it.entity }
            if (connection != null) {
                inv.dialect = resolveDialect(loader, connection.metaData)
            }
        } finally {
            loader.close()
        }
        return inv
    }

    /** Classes whose bytecode mentions a JPA @Entity or @MappedSuperclass annotation. */
    private static List<String> candidateClassNames(File f) {
        List<String> names = []
        Closure<Void> check = { String path, byte[] bytes ->
            String s = new String(bytes, 'ISO-8859-1')
            if (s.contains('/persistence/Entity;') || s.contains('/persistence/MappedSuperclass;')) {
                names << path.substring(0, path.length() - '.class'.length()).replace('/', '.')
            }
        }
        if (f.isDirectory()) {
            f.eachFileRecurse { File c ->
                if (c.name.endsWith('.class')) {
                    check(f.toPath().relativize(c.toPath()).toString().replace(File.separatorChar, (char) '/'), c.bytes)
                }
            }
        } else if (f.isFile()) {
            JarFile jar = new JarFile(f)
            try {
                for (JarEntry e : Collections.list(jar.entries())) {
                    if (e.name.endsWith('.class') && !e.name.startsWith('META-INF/') && !e.name.contains('-')) {
                        check(e.name, jar.getInputStream(e).bytes)
                    }
                }
            } finally {
                jar.close()
            }
        }
        return names
    }

    private void collectGenerators(Class<?> c) {
        List<AnnotatedElement> elements = [c]
        try {
            elements.addAll(c.declaredFields as List)
            elements.addAll(c.declaredMethods as List)
        } catch (Throwable ignored) {
            // member types missing from the classpath; class-level declarations still count
        }
        elements.each { AnnotatedElement el ->
            Annotation[] anns
            try {
                anns = el.annotations
            } catch (Throwable ignored) {
                return
            }
            anns.each { Annotation a ->
                String n = a.annotationType().simpleName
                if (n in ['SequenceGenerators', 'TableGenerators', 'GenericGenerators']) {
                    ((Annotation[]) value(a, 'value')).each { addGenerator(it, c) }
                } else if (n in ['SequenceGenerator', 'TableGenerator', 'GenericGenerator']) {
                    addGenerator(a, c)
                }
            }
        }
    }

    private void addGenerator(Annotation a, Class<?> declaredOn) {
        String n = a.annotationType().simpleName
        GeneratorDef d = new GeneratorDef(name: (String) value(a, 'name'), declaredOn: declaredOn.name, attrs: new LinkedHashMap<>())
        switch (n) {
            case 'SequenceGenerator':
                d.kind = 'sequence'
                ['sequenceName', 'allocationSize', 'initialValue', 'schema', 'catalog'].each { d.attrs[it] = value(a, it) }
                break
            case 'TableGenerator':
                d.kind = 'table'
                ['table', 'pkColumnName', 'valueColumnName', 'pkColumnValue', 'allocationSize', 'initialValue', 'schema', 'catalog'].each { d.attrs[it] = value(a, it) }
                break
            default:
                d.kind = 'generic'
                d.attrs['strategy'] = value(a, 'strategy')
        }
        generatorsByName.computeIfAbsent(d.name) { [] } << d
    }

    private void collectId(Class<?> entity) {
        for (Class<?> c = entity; c != null && c != Object; c = c.superclass) {
            List<AnnotatedElement> members = []
            try {
                members.addAll(c.declaredFields as List)
                members.addAll(c.declaredMethods as List)
            } catch (Throwable ignored) {
                continue
            }
            AnnotatedElement idMember = members.find { annotation(it, 'Id') != null || annotation(it, 'EmbeddedId') != null }
            if (idMember == null) continue
            if (c != entity && annotation(c, 'Entity') != null) {
                return  // the identifier belongs to a parent entity (JOINED / SINGLE_TABLE subclass)
            }
            Annotation gv = annotation(idMember, 'GeneratedValue')
            if (gv == null) return
            GeneratedId id = new GeneratedId(entity: entity.name, table: tableName(entity))
            for (Class<?> h = entity; h != null && h != Object; h = h.superclass) {
                id.hierarchy << h.name
            }
            Annotation col = annotation(idMember, 'Column')
            String colName = col == null ? null : (String) value(col, 'name')
            id.idColumn = colName ?: memberName(idMember)
            id.strategy = String.valueOf(value(gv, 'strategy'))
            id.generator = (String) value(gv, 'generator')
            ids << id
            return
        }
    }

    /** Resolves each generator name to its definitions, preferring the entity's own hierarchy. */
    private List<GeneratorDef> definitionsFor(GeneratedId id) {
        List<GeneratorDef> all = generatorsByName[id.generator] ?: []
        List<GeneratorDef> own = all.findAll { id.hierarchy.contains(it.declaredOn) }
        return own ?: all
    }

    // ---------------------------------------------------------------- rendering

    List<String> render(SchemaSnapshot snapshot, Connection c, Map<String, String> header) {
        List<String> out = []
        out << '# Generator inventory: the database object behind every generated entity identifier'
        out << "# Lines starting with '#' are informational; snapshot comparison ignores them."
        (header ?: [:]).each { k, v -> out << "# ${k}: ${v}".toString() }
        out << "# database: ${snapshot.productName} ${SchemaSnapshot.oneLine(snapshot.productVersion)}".toString()
        out << "# entities scanned: ${scannedEntities}; entities with a generated id: ${ids.size()}".toString()
        out << '# backing: SEQUENCE = database sequence; TABLE = a one-row table emulating a sequence (dialect has no sequences);'
        out << '#          TABLE-ROW = a row in a @TableGenerator table; NONE = no database object (e.g. UUID generated in Java)'

        Map<String, Integer> summary = new TreeMap<>()
        List<String> entityLines = []
        ids.each { GeneratedId id ->
            List<GeneratorDef> defs = definitionsFor(id)
            List<String> declared = []
            List<String> backing = []
            defs.each { GeneratorDef d ->
                switch (d.kind) {
                    case 'sequence':
                        String seq = (String) d.attrs.sequenceName ?: 'hibernate_sequence'
                        declared << "sequence(${seq},alloc=${d.attrs.allocationSize})".toString()
                        Map<String, String> info = snapshot.sequenceInfo[seq]
                        if (info != null) {
                            String mismatch = info.increment != null && info.increment != String.valueOf(d.attrs.allocationSize) ? ' INCREMENT!=ALLOC' : ''
                            backing << "SEQUENCE ${seq} increment=${info.increment} value=${info.value}${mismatch}".toString()
                        } else if (snapshot.tableNames.contains(seq)) {
                            backing << "TABLE ${seq} ${tableRows(c, snapshot, seq, null, null)}".toString()
                        }
                        break
                    case 'table':
                        String table = (String) d.attrs.table ?: 'hibernate_sequences'
                        String pkCol = (String) d.attrs.pkColumnName ?: 'sequence_name'
                        String pkVal = (String) d.attrs.pkColumnValue ?: id.generator
                        declared << "table(${table}[${pkVal}],alloc=${d.attrs.allocationSize})".toString()
                        if (snapshot.tableNames.contains(table)) {
                            String row = tableRows(c, snapshot, table, pkCol, pkVal)
                            if (row) backing << "TABLE-ROW ${table}[${pkVal}] ${row}".toString()
                        }
                        break
                    default:
                        declared << "generic(${d.attrs.strategy})".toString()
                        if (String.valueOf(d.attrs.strategy).toLowerCase(Locale.ROOT).contains('uuid')) {
                            backing << 'NONE uuid'
                        }
                }
            }
            if (defs.isEmpty()) declared << "default(${id.strategy})".toString()
            String kind = backing.isEmpty() ? 'MISSING' : backing.collect { it.split(' ')[0] }.unique().join('+')
            summary[kind] = (summary[kind] ?: 0) + 1
            String shortName = id.entity.replaceFirst(/^org\.apereo\.portal\./, '')
            entityLines << ("${shortName} table=${id.table} id=${id.idColumn} generator=${id.generator} " +
                    "declared=${declared.join('+')} backing=${backing ? backing.join(' + ') : 'MISSING'} " +
                    "${idStats(c, snapshot, id)}").toString()
        }
        out << '[summary]'
        summary.each { k, v -> out << "backing=${k} entities=${v}".toString() }
        out << '[entities]'
        out.addAll(entityLines)
        out << '[counters]'
        if (snapshot.tableNames.contains('UP_SEQUENCE')) {
            String table = snapshot.tableNames.find { it.equalsIgnoreCase('UP_SEQUENCE') }
            List<String> rows = []
            SchemaSnapshot.query(c, "select * from ${snapshot.q(table)}".toString(), []) { ResultSet rs ->
                rows << "UP_SEQUENCE[${rs.getString(1)}] value=${SchemaSnapshot.text(rs.getObject(2))}".toString()
            }
            out.addAll(rows.sort())
        }
        return out
    }

    /** All rows of a generator table, or the one row whose key column equals the key value. */
    private static String tableRows(Connection c, SchemaSnapshot snapshot, String table, String keyCol, String keyVal) {
        String physical = snapshot.tableNames.find { it.equalsIgnoreCase(table) }
        List<String> rows = []
        SchemaSnapshot.query(c, "select * from ${snapshot.q(physical)}".toString(), []) { ResultSet rs ->
            def md = rs.metaData
            Map<String, String> row = [:]
            (1..md.columnCount).each { row[md.getColumnLabel(it).toLowerCase(Locale.ROOT)] = SchemaSnapshot.text(rs.getObject(it)) }
            if (keyCol == null || keyVal.equalsIgnoreCase(row[keyCol.toLowerCase(Locale.ROOT)])) {
                rows << row.findAll { k, v -> keyCol == null || !k.equalsIgnoreCase(keyCol) }.collect { k, v -> "${k}=${v}" }.join(' ')
            }
        }
        return rows.sort().join('; ')
    }

    private static String idStats(Connection c, SchemaSnapshot snapshot, GeneratedId id) {
        String table = snapshot.tableNames.find { it.equalsIgnoreCase(id.table) }
        if (table == null) return 'table-missing'
        String column = (snapshot.tableColumns[table] ?: []).find { it.equalsIgnoreCase(id.idColumn) }
        if (column == null) return 'id-column-missing'
        String stats = null
        SchemaSnapshot.query(c, "select count(*), max(${snapshot.q(column)}) from ${snapshot.q(table)}".toString(), []) { ResultSet rs ->
            stats = "rows=${rs.getLong(1)} max-id=${SchemaSnapshot.text(rs.getObject(2))}"
        }
        return stats
    }

    // ---------------------------------------------------------------- reflection helpers

    static Annotation annotation(AnnotatedElement el, String simpleName) {
        try {
            return el.annotations.find {
                Class<?> t = it.annotationType()
                t.simpleName == simpleName && (t.name.startsWith('javax.persistence.') || t.name.startsWith('jakarta.persistence.'))
            }
        } catch (Throwable ignored) {
            return null
        }
    }

    static Object value(Annotation a, String attribute) {
        try {
            Object v = a.annotationType().getMethod(attribute).invoke(a)
            return (v instanceof String && ((String) v).isEmpty()) ? null : v
        } catch (NoSuchMethodException ignored) {
            return null
        }
    }

    private static String memberName(AnnotatedElement m) {
        if (m instanceof Field) return ((Field) m).name
        String n = ((Method) m).name.replaceFirst(/^(get|is)/, '')
        return n ? n[0].toLowerCase() + n.substring(1) : n
    }

    private static String tableName(Class<?> entity) {
        Annotation t = annotation(entity, 'Table')
        String name = t == null ? null : (String) value(t, 'name')
        if (name) return name
        Annotation e = annotation(entity, 'Entity')
        return (String) value(e, 'name') ?: entity.simpleName
    }

    /**
     * Asks the deployed uPortal's own Hibernate which dialect it resolves for this database: first
     * uPortal's PortalDialectResolver (hibernate.dialect_resolvers), then Hibernate's standard
     * resolver. uPortal never sets hibernate.dialect itself, so this is the dialect in use.
     */
    static String resolveDialect(ClassLoader loader, DatabaseMetaData md) {
        try {
            Class<?> infoClass = loader.loadClass('org.hibernate.engine.jdbc.dialect.spi.DatabaseMetaDataDialectResolutionInfoAdapter')
            Object info = infoClass.getConstructor(DatabaseMetaData).newInstance(md)
            Object portal = loader.loadClass('org.apereo.portal.utils.PortalDialectResolver').getDeclaredConstructor().newInstance()
            Object dialect = portal.resolveDialect(info)
            String by = 'PortalDialectResolver'
            if (dialect == null) {
                Class<?> std = loader.loadClass('org.hibernate.engine.jdbc.dialect.internal.StandardDialectResolver')
                Object resolver
                try {
                    resolver = std.getField('INSTANCE').get(null)
                } catch (NoSuchFieldException ignored) {
                    resolver = std.getDeclaredConstructor().newInstance()
                }
                dialect = resolver.resolveDialect(info)
                by = 'Hibernate StandardDialectResolver'
            }
            return dialect == null ? 'none (Hibernate cannot pick a dialect for this database)' : "${dialect.getClass().name} (chosen by ${by})"
        } catch (Throwable t) {
            return "unresolved (${t.getClass().simpleName}: ${t.message})"
        }
    }
}
