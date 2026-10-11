package org.apereo.portal.start.db

import java.util.regex.Pattern

/**
 * Compares a freshly taken snapshot directory with a recorded baseline directory.
 *
 * Each file is compared section by section as a multiset of lines (every line is a complete fact,
 * so line order carries no meaning). Lines starting with '#' are ignored. The result separates:
 * <ul>
 *   <li>structure drift: schema-normalized.txt differs in tables, columns, keys, constraints,
 *       indexes or sequence definitions</li>
 *   <li>data drift: schema-normalized.txt differs only in row counts, sequence values or
 *       generator table rows</li>
 *   <li>name drift: schema.txt shows the same constraint or index under another name (renames are
 *       paired up for the report)</li>
 *   <li>generator drift: generators.txt differs (an ID is backed by a different object or value)</li>
 * </ul>
 * Zero drift means all four are empty.
 *
 * Sequence values are compared exactly unless the vendor asks for {@link SequenceValues#INVARIANT}.
 *
 * A data change made on purpose (say, quickstart data that publishes one more portlet type) is
 * listed in the baseline set's {@value #INTENDED_CHANGES}, one table and row-count delta per line.
 * The comparison adds each delta to the baseline's row count and to the rows of the generators
 * that serve the table, and compares those generators' values and max(id) only by the rule
 * value >= max(id). An intended change the run does not show is drift too, so the list can't go
 * stale.
 *
 * The same file can list a generator definition that uPortal removed from its mappings, as
 * "generators declared -table(<TABLE>) <MOD reference>". The comparison drops the definitions
 * that name that generator table from the baseline's "declared=" text and compares the rest of
 * generators.txt (the backing object, increment, value, rows and max(id)) exactly. The entry is
 * found only when the baseline declares such definitions and this run declares none, and it is
 * drift if the baseline backs any ID with that table, because then IDs were allocated from it.
 */
class SnapshotComparison {

    /** How the current value of a database sequence is compared. */
    enum SequenceValues {
        /** The value must equal the baseline's. */
        EXACT,
        /**
         * For databases where the value read from the catalog depends on timing (Oracle reports
         * LAST_NUMBER, the high-water mark of a sequence cache it sizes by the rate of use). The
         * value is left out of the comparison; instead every sequence that backs an ID must be
         * above max(id) of each table it serves, and step by the mapping's allocationSize.
         */
        INVARIANT
    }

    static final String SCHEMA = 'schema.txt'
    static final String NORMALIZED = 'schema-normalized.txt'
    static final String GENERATORS = 'generators.txt'
    static final List<String> FILES = [SCHEMA, NORMALIZED, GENERATORS]
    /** In the baseline set's directory (tests/db/snapshots/<baseline>), next to the vendors. */
    static final String INTENDED_CHANGES = 'intended-changes.txt'

    /** One line of {@value #INTENDED_CHANGES}: a table whose row count a data change moves on purpose. */
    static class IntendedChange {
        String table
        long delta
        String reference
        /** The row count in the baseline, or null when the baseline has no such table. */
        Long baselineRows
        /** The row count in this run, or null when this run has no such table. */
        Long currentRows

        Long getExpectedRows() { return baselineRows == null ? null : baselineRows + delta }

        boolean isFound() { return baselineRows != null && currentRows == expectedRows }

        String describe() {
            String what = "${table} rows ${delta > 0 ? '+' : ''}${delta} (${reference})"
            if (baselineRows == null) return "${what}: the baseline has no row count for ${table}: NOT FOUND"
            String result = found ? 'found' : 'NOT FOUND'
            return "${what}: baseline ${baselineRows}, expected ${expectedRows}, this run ${currentRows == null ? 'none' : currentRows}: ${result}"
        }
    }

    private static final Pattern INTENDED_LINE = ~/^(\S+)\s+rows\s+([+-]\d+)\s+(MOD-[A-Z]+\d+)$/
    private static final Pattern DECLARATION_LINE = ~/^generators\s+declared\s+-table\((\S+)\)\s+(MOD-[A-Z]+\d+)$/

    /**
     * One "generators declared -table(<TABLE>) <MOD reference>" line of {@value #INTENDED_CHANGES}:
     * the mappings no longer declare table generators in TABLE.
     */
    static class DeclarationChange {
        String table
        String reference
        /** How many definitions in TABLE the baseline's and this run's [entities] lines declare. */
        int baselineDeclared
        int currentDeclared
        /** The baseline's [entities] lines whose IDs TABLE backs. */
        List<String> baselineBacked = []

        boolean isFound() { return baselineDeclared > 0 && currentDeclared == 0 && baselineBacked.isEmpty() }

        String describe() {
            String what = "generators declared -table(${table}) (${reference})"
            String result = found ? 'found' : 'NOT FOUND'
            String backed = baselineBacked ? ", but the baseline backs ${baselineBacked.size()} IDs with ${table}" : ''
            return "${what}: baseline ${baselineDeclared}, this run ${currentDeclared}${backed}: ${result}"
        }

        /** Removes the table(TABLE[...],alloc=n) parts of an [entities] line's declared= text. */
        String strip(String line) {
            return line.replaceAll(/ declared=(\S+)/) { all, String declared ->
                ' declared=' + declared.split(/\+/).findAll { !declares(it) }.join('+')
            }
        }

        int count(List<String> entityLines) {
            return entityLines.sum(0) { String line ->
                String declared = line.find(/ declared=(\S+)/) { all, d -> d }
                declared ? declared.split(/\+/).count { declares(it) } : 0
            } as int
        }

        private boolean declares(String part) {
            return part.toLowerCase(Locale.ROOT).startsWith("table(${table.toLowerCase(Locale.ROOT)}[")
        }

        boolean backs(String line) {
            String backing = line.find(/ backing=(.*?) rows=/) { all, b -> b }
            return backing != null && backing.split(/[\s\[]+/).any { it.equalsIgnoreCase(table) }
        }
    }

    /**
     * Reads the "generators declared -table(<TABLE>) <MOD reference>" lines of
     * {@value #INTENDED_CHANGES}. A missing file means none.
     */
    static List<DeclarationChange> readDeclarationChanges(File file) {
        if (!file.file) return []
        List<DeclarationChange> out = []
        file.readLines('UTF-8').each { String raw ->
            def m = raw.replaceFirst(/#.*$/, '').trim() =~ DECLARATION_LINE
            if (m.matches()) out << new DeclarationChange(table: m.group(1), reference: m.group(2))
        }
        return out
    }

    /**
     * Reads {@value #INTENDED_CHANGES}: "<TABLE> rows <+n|-n> <MOD reference>" per line; '#' starts
     * a comment. A missing file means no intended changes.
     */
    static List<IntendedChange> readIntendedChanges(File file) {
        if (!file.file) return []
        List<IntendedChange> out = []
        file.readLines('UTF-8').eachWithIndex { String raw, int i ->
            String l = raw.replaceFirst(/#.*$/, '').trim()
            if (!l || l ==~ DECLARATION_LINE) return
            def m = l =~ INTENDED_LINE
            if (!m.matches() || (m.group(2) as long) == 0) {
                throw new IllegalArgumentException("${file}:${i + 1}: expected '<TABLE> rows <+n|-n> <MOD-ID>' " +
                        "with n other than 0, e.g. 'UP_PORTLET_TYPE rows +1 MOD-I134', or " +
                        "'generators declared -table(<TABLE>) <MOD-ID>'; found '${raw}'")
            }
            if (out.any { it.table.equalsIgnoreCase(m.group(1)) }) {
                throw new IllegalArgumentException("${file}:${i + 1}: ${m.group(1)} is listed twice")
            }
            out << new IntendedChange(table: m.group(1), delta: m.group(2) as long, reference: m.group(3))
        }
        return out
    }

    final Map<String, List<String>> removed = [:]
    final Map<String, List<String>> added = [:]
    final List<String> missing = []
    final List<String> renames = []
    /** With {@link SequenceValues#INVARIANT}: the generators.txt lines that break the invariant. */
    final List<String> invariantViolations = []
    SequenceValues sequenceValues = SequenceValues.EXACT
    List<IntendedChange> intendedChanges = []
    List<DeclarationChange> declarationChanges = []

    static SnapshotComparison compare(File baselineDir, File currentDir, SequenceValues sequenceValues = SequenceValues.EXACT,
                                      List<IntendedChange> intendedChanges = [], List<DeclarationChange> declarationChanges = []) {
        SnapshotComparison r = new SnapshotComparison(sequenceValues: sequenceValues, intendedChanges: intendedChanges,
                declarationChanges: declarationChanges)
        Released released = intendedChanges ? Released.of(new File(baselineDir, GENERATORS), intendedChanges) : new Released()
        FILES.each { String name ->
            File b = new File(baselineDir, name)
            File c = new File(currentDir, name)
            if (!b.file || !c.file) {
                r.missing << "${name} (${!b.file ? 'no baseline: ' + b : 'not taken: ' + c})".toString()
                r.removed[name] = []
                r.added[name] = []
                return
            }
            Map<String, List<String>> bs = sections(b.readLines('UTF-8'))
            Map<String, List<String>> cs = sections(c.readLines('UTF-8'))
            if (name == GENERATORS && declarationChanges) {
                bs = r.applyDeclarationChanges(bs, cs)
            }
            if (sequenceValues == SequenceValues.INVARIANT) {
                if (name == GENERATORS) {
                    r.invariantViolations.addAll(sequenceInvariantViolations(cs['[entities]'] ?: []))
                }
                bs = withoutSequenceValues(bs)
                cs = withoutSequenceValues(cs)
            }
            if (intendedChanges) {
                if (name == NORMALIZED) r.countIntendedRows(bs, cs)
                if (name == GENERATORS) r.invariantViolations.addAll(released.violations(cs['[entities]'] ?: []))
                bs = released.apply(bs, intendedChanges)
                cs = released.apply(cs, [])
            }
            r.removed[name] = minus(bs, cs)
            r.added[name] = minus(cs, bs)
        }
        r.pairRenames()
        return r
    }

    static final List<String> DATA_SECTIONS = ['[row counts]', '[generator table rows]']

    /** Normalized lines that differ in structure rather than in data. */
    List<String> structuralDifferences() {
        List<String> rem = removed[NORMALIZED].findAll { !isData(it) }
        List<String> add = added[NORMALIZED].findAll { !isData(it) }
        // a sequence whose definition is unchanged and only its current value moved is data
        Set<String> remDefs = rem.findAll { it.startsWith('[sequences]') }.collect { sequenceDefinition(it) } as Set
        Set<String> addDefs = add.findAll { it.startsWith('[sequences]') }.collect { sequenceDefinition(it) } as Set
        Set<String> valueOnly = remDefs.intersect(addDefs)
        return (rem + add).findAll { !(it.startsWith('[sequences]') && valueOnly.contains(sequenceDefinition(it))) }
    }

    private static boolean isData(String line) {
        return DATA_SECTIONS.any { line.startsWith(it) }
    }

    private static String sequenceDefinition(String line) {
        int i = line.indexOf(' value=')
        return i < 0 ? line : line.substring(0, i)
    }

    boolean isStructureDrift() { return !structuralDifferences().isEmpty() }

    boolean isDataDrift() {
        return removed[NORMALIZED].size() + added[NORMALIZED].size() > structuralDifferences().size()
    }

    boolean isNameDrift() { return !renames.isEmpty() }

    boolean isGeneratorDrift() {
        return !removed[GENERATORS].isEmpty() || !added[GENERATORS].isEmpty() || !invariantViolations.isEmpty()
    }

    boolean isZeroDrift() {
        return missing.isEmpty() && FILES.every { removed[it].isEmpty() && added[it].isEmpty() } && renames.isEmpty() &&
                invariantViolations.isEmpty() && intendedChanges.every { it.found } && declarationChanges.every { it.found }
    }

    /** Counts each declaration change in both snapshots and removes it from the baseline's [entities] lines. */
    private Map<String, List<String>> applyDeclarationChanges(Map<String, List<String>> baseline, Map<String, List<String>> current) {
        List<String> baselineEntities = baseline['[entities]'] ?: []
        List<String> currentEntities = current['[entities]'] ?: []
        declarationChanges.each { DeclarationChange change ->
            change.baselineDeclared = change.count(baselineEntities)
            change.currentDeclared = change.count(currentEntities)
            change.baselineBacked = baselineEntities.findAll { change.backs(it) }
            baselineEntities = baselineEntities.collect { change.strip(it) }
        }
        Map<String, List<String>> m = new LinkedHashMap<>(baseline)
        if (baseline.containsKey('[entities]')) m['[entities]'] = baselineEntities
        return m
    }

    /** Reads each intended table's row count from schema-normalized.txt, before the deltas are applied. */
    private void countIntendedRows(Map<String, List<String>> baseline, Map<String, List<String>> current) {
        intendedChanges.each { IntendedChange change ->
            change.baselineRows = rowCount(baseline['[row counts]'], change.table)
            change.currentRows = rowCount(current['[row counts]'], change.table)
        }
    }

    private static Long rowCount(List<String> lines, String table) {
        String line = (lines ?: []).find { it.split(' ')[0].equalsIgnoreCase(table) }
        String count = line?.split(' ')?.getAt(1)
        return count != null && count ==~ /\d+/ ? count as Long : null
    }

    List<String> report(String title) {
        List<String> out = [title]
        if (missing) {
            out << 'MISSING FILES: ' + missing.join(', ')
        }
        out << "STRUCTURE (tables, columns, keys, constraints, indexes, sequence definitions): ${structureDrift ? 'DRIFT' : 'no drift'}".toString()
        out << "DATA (row counts, sequence values, generator table rows): ${dataDrift ? 'DRIFT' : 'no drift'}".toString()
        out << "NAMES (constraint and index names): ${nameDrift ? "DRIFT, ${renames.size()} renamed" : 'no drift'}".toString()
        out << "GENERATORS (generators.txt): ${generatorDrift ? 'DRIFT' : 'no drift'}".toString()
        if (sequenceValues == SequenceValues.INVARIANT) {
            out << 'SEQUENCE VALUES: not compared with the baseline; checked instead: value > max(id) of every table served, increment = allocationSize'
        }
        if (intendedChanges) {
            int notFound = intendedChanges.count { !it.found } as int
            out << "INTENDED CHANGES (${INTENDED_CHANGES}, added to the baseline before comparing): ".toString() +
                    (notFound ? "${notFound} of ${intendedChanges.size()} NOT FOUND" : "${intendedChanges.size()} found")
            intendedChanges.each { out << "~ ${it.describe()}".toString() }
        }
        if (declarationChanges) {
            int notFound = declarationChanges.count { !it.found } as int
            out << "REMOVED GENERATOR DEFINITIONS (${INTENDED_CHANGES}, removed from the baseline before comparing): ".toString() +
                    (notFound ? "${notFound} of ${declarationChanges.size()} NOT FOUND" : "${declarationChanges.size()} found")
            declarationChanges.each { out << "~ ${it.describe()}".toString() }
        }
        out << "RESULT: ${zeroDrift ? 'ZERO DRIFT' : 'DRIFT'}".toString()
        if (invariantViolations) {
            out << ''
            out << '--- generators.txt: generators that break the invariant'
            invariantViolations.each { out << "! ${it}".toString() }
        }
        [NORMALIZED, GENERATORS, SCHEMA].each { String f ->
            if (removed[f] || added[f] || (f == SCHEMA && renames)) {
                out << ''
                out << "--- ${f}: '-' only in the baseline, '+' only in this run".toString()
                if (f == SCHEMA && renames) {
                    out << 'renamed (same table, columns and definition):'
                    renames.each { out << "  ${it}".toString() }
                    if (removed[f] || added[f]) out << 'other differences:'
                }
                removed[f].each { out << "- ${it}".toString() }
                added[f].each { out << "+ ${it}".toString() }
            }
        }
        return out
    }

    private static final Pattern SEQUENCE_BACKING = ~/SEQUENCE (\S+) increment=(\S+) value=(\S+)/
    private static final Pattern DECLARED_SEQUENCE = ~/sequence\(([^,]+),alloc=([^)]+)\)/

    /** Drops the current value from [sequences] lines and from the SEQUENCE backing of generators.txt lines. */
    private static Map<String, List<String>> withoutSequenceValues(Map<String, List<String>> sections) {
        Map<String, List<String>> m = new LinkedHashMap<>()
        sections.each { String section, List<String> lines ->
            m[section] = lines.collect { String l ->
                if (section == '[sequences]') return sequenceDefinition(l)
                if (section == '[entities]') return l.replaceAll(SEQUENCE_BACKING) { all, seq, inc, value -> "SEQUENCE ${seq} increment=${inc}" }
                return l
            }
        }
        return m
    }

    /**
     * Checks every generators.txt entity line backed by a sequence: the sequence's value must be
     * above the table's max(id), so the next ID it hands out is free, and its increment must equal
     * the allocationSize of the mapping that names it.
     */
    private static List<String> sequenceInvariantViolations(List<String> entityLines) {
        List<String> out = []
        entityLines.each { String line ->
            Map<String, String> allocationSizes = [:]
            line.findAll(DECLARED_SEQUENCE) { all, seq, alloc -> allocationSizes[seq] = alloc }
            String table = line.find(/ table=(\S+)/) { all, t -> t }
            String maxId = line.find(/ max-id=(\S+)/) { all, id -> id }
            line.findAll(SEQUENCE_BACKING) { all, seq, inc, value ->
                if (inc != allocationSizes[seq]) {
                    out << "${seq} increment=${inc}, but ${table}'s mapping has allocationSize=${allocationSizes[seq]}".toString()
                }
                if (!(value ==~ /-?\d+/)) {
                    out << "${seq} value=${value} is not a number (${table})".toString()
                } else if (maxId ==~ /-?\d+/ && new BigInteger(value) <= new BigInteger(maxId)) {
                    out << "${seq} value=${value} is not above max(id)=${maxId} of ${table}".toString()
                }
            }
        }
        return out
    }

    /** Pairs removed/added schema.txt lines that differ only in the object name. */
    private void pairRenames() {
        List<String> rem = removed[SCHEMA]
        List<String> add = added[SCHEMA]
        if (!rem || !add) return
        Map<String, List<String>> remBySig = bySignature(rem)
        Map<String, List<String>> addBySig = bySignature(add)
        remBySig.each { String sig, List<String> oldLines ->
            List<String> newLines = addBySig[sig]
            if (!newLines) return
            int n = Math.min(oldLines.size(), newLines.size())
            for (int i = 0; i < n; i++) {
                String oldLine = oldLines[i]
                String newLine = newLines[i]
                renames << "${sig}: ${nameOf(oldLine)} -> ${nameOf(newLine)}".toString()
                rem.remove(oldLine)
                add.remove(newLine)
            }
        }
    }

    private static Map<String, List<String>> bySignature(List<String> lines) {
        Map<String, List<String>> m = new TreeMap<>()
        lines.each { String l ->
            String sig = signature(l)
            if (sig != null) m.computeIfAbsent(sig) { [] } << l
        }
        m.values().each { Collections.sort(it) }
        return m
    }

    /** "[section] TABLE NAME DEF" becomes "[section] TABLE DEF" for named sections. */
    private static String signature(String line) {
        String section = line.substring(0, line.indexOf(']') + 1)
        if (section.length() < 2) return null
        if (!SchemaSnapshot.NAMED_SECTIONS.contains(section[1..-2])) return null
        String[] parts = line.substring(section.length()).trim().split(' ', 3)
        if (parts.length < 3) return null
        return "${section} ${parts[0]} ${parts[2]}".toUpperCase(Locale.ROOT)
    }

    private static String nameOf(String line) {
        String[] parts = line.substring(line.indexOf(']') + 1).trim().split(' ', 3)
        return parts.length > 1 ? parts[1] : '?'
    }

    static Map<String, List<String>> sections(List<String> lines) {
        Map<String, List<String>> m = new LinkedHashMap<>()
        String current = ''
        lines.each { String l ->
            if (l.startsWith('#') || l.trim().isEmpty()) return
            if (l.startsWith('[') && l.endsWith(']')) {
                current = l
                m.computeIfAbsent(current) { [] }
                return
            }
            m.computeIfAbsent(current) { [] } << l
        }
        return m
    }

    /** Multiset difference a - b, as "[section] line" strings. */
    private static List<String> minus(Map<String, List<String>> a, Map<String, List<String>> b) {
        List<String> out = []
        a.each { String section, List<String> lines ->
            Map<String, Integer> counts = [:]
            (b[section] ?: []).each { counts[it] = (counts[it] ?: 0) + 1 }
            lines.each { String l ->
                Integer n = counts[l]
                if (n) {
                    counts[l] = n - 1
                } else {
                    out << "${section} ${l}".toString()
                }
            }
        }
        return out
    }

    /**
     * The generators that serve the tables of the intended changes: their values and the tables'
     * max(id) move with the rows, by amounts that depend on the database's sequence semantics and
     * caches, so they are masked in both snapshots and checked by value >= max(id) instead.
     */
    private static class Released {
        /** Upper-cased table names of the intended changes. */
        final Set<String> tables = new TreeSet<>(String.CASE_INSENSITIVE_ORDER)
        /** Upper-cased sequence names that back those tables. */
        final Set<String> sequences = new TreeSet<>(String.CASE_INSENSITIVE_ORDER)
        /** Generator tables (whole table, key null) or rows (table, key) that back those tables. */
        final List<List<String>> generatorRows = []

        private static final Pattern TABLE_ATTR = ~/ table=(\S+)/
        private static final Pattern SEQUENCE_BACKING = ~/SEQUENCE (\S+) increment=/
        private static final Pattern TABLE_BACKING = ~/TABLE (\S+) /
        private static final Pattern TABLE_ROW_BACKING = ~/TABLE-ROW ([^\[\s]+)\[([^\]]+)\]/
        private static final Pattern GENERATOR_VALUE = ~/(?i)\b(value|next_val|next_hi_value|next_hi)=(-?\d+)/
        private static final Pattern MAX_ID = ~/ max-id=(\S+)/

        static Released of(File baselineGenerators, List<IntendedChange> changes) {
            Released r = new Released()
            changes.each { r.tables << it.table }
            if (!baselineGenerators.file) return r
            SnapshotComparison.sections(baselineGenerators.readLines('UTF-8'))['[entities]']?.each { String line ->
                if (!r.servesTable(line)) return
                line.findAll(SEQUENCE_BACKING) { all, seq -> r.sequences << seq }
                line.findAll(TABLE_BACKING) { all, table -> r.generatorRows << [table, null] }
                line.findAll(TABLE_ROW_BACKING) { all, table, key -> r.generatorRows << [table, key] }
            }
            return r
        }

        boolean servesTable(String entityLine) {
            String table = entityLine.find(TABLE_ATTR) { all, t -> t }
            return table != null && tables.contains(table)
        }

        /** The current [entities] lines of the released tables whose generator is behind max(id). */
        List<String> violations(List<String> currentEntities) {
            List<String> out = []
            currentEntities.findAll { servesTable(it) }.each { String line ->
                String maxId = line.find(MAX_ID) { all, id -> id }
                if (maxId == null || !(maxId ==~ /-?\d+/)) return
                line.findAll(GENERATOR_VALUE) { all, key, value ->
                    if (new BigInteger(value) < new BigInteger(maxId)) {
                        out << "${line.find(TABLE_ATTR) { a, t -> t }}: ${key}=${value} is below max(id)=${maxId} after an intended change".toString()
                    }
                }
            }
            return out
        }

        /**
         * Masks the released generator values and max(id) values, and adds the deltas (when given)
         * to the row counts of [row counts] and of the generators.txt lines.
         */
        Map<String, List<String>> apply(Map<String, List<String>> sections, List<IntendedChange> deltas) {
            Map<String, List<String>> m = new LinkedHashMap<>()
            sections.each { String section, List<String> lines ->
                m[section] = lines.collect { String l -> applyTo(section, l, deltas) }
            }
            return m
        }

        private String applyTo(String section, String line, List<IntendedChange> deltas) {
            String first = line.split(' ')[0]
            switch (section) {
                case '[row counts]':
                    IntendedChange change = deltas.find { it.table.equalsIgnoreCase(first) }
                    String count = line.split(' ').length > 1 ? line.split(' ')[1] : null
                    return change && count != null && count ==~ /\d+/ ? "${first} ${(count as long) + change.delta}".toString() : line
                case '[sequences]':
                    return sequences.contains(first) ? line.replaceAll(/ value=\S+/, ' value=*') : line
                case '[generator table rows]':
                    boolean released = generatorRows.any { table, key ->
                        first.equalsIgnoreCase(table) &&
                                (key == null || line.split(' ').drop(1).any { it.toUpperCase(Locale.ROOT).endsWith("=${key.toUpperCase(Locale.ROOT)}") })
                    }
                    return released ? line.replaceAll(/=-?\d+/, '=*') : line
                case '[entities]':
                    if (!servesTable(line)) return line
                    String table = line.find(TABLE_ATTR) { all, t -> t }
                    IntendedChange change = deltas.find { it.table.equalsIgnoreCase(table) }
                    String out = line.replaceAll(GENERATOR_VALUE) { all, key, value -> "${key}=*" }
                            .replaceAll(MAX_ID, ' max-id=*')
                    if (change) {
                        out = out.replaceAll(/ rows=(\d+)/) { all, rows -> " rows=${(rows as long) + change.delta}" }
                    }
                    return out
                default:
                    return line
            }
        }
    }
}
