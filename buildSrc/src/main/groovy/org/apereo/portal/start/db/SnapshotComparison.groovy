package org.apereo.portal.start.db

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
 */
class SnapshotComparison {

    static final String SCHEMA = 'schema.txt'
    static final String NORMALIZED = 'schema-normalized.txt'
    static final String GENERATORS = 'generators.txt'
    static final List<String> FILES = [SCHEMA, NORMALIZED, GENERATORS]

    final Map<String, List<String>> removed = [:]
    final Map<String, List<String>> added = [:]
    final List<String> missing = []
    final List<String> renames = []

    static SnapshotComparison compare(File baselineDir, File currentDir) {
        SnapshotComparison r = new SnapshotComparison()
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

    boolean isGeneratorDrift() { return !removed[GENERATORS].isEmpty() || !added[GENERATORS].isEmpty() }

    boolean isZeroDrift() {
        return missing.isEmpty() && FILES.every { removed[it].isEmpty() && added[it].isEmpty() } && renames.isEmpty()
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
        out << "RESULT: ${zeroDrift ? 'ZERO DRIFT' : 'DRIFT'}".toString()
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

    private static Map<String, List<String>> sections(List<String> lines) {
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
}
