package org.apereo.portal.start.db

/**
 * Compares two normalised `dataExport` trees (see DataExportNormalizer) file by file and writes a
 * unified diff of every difference: files only on one side, and changed lines with three lines of
 * context. The diff is the same on every platform, so a recorded one (an expected vendor
 * difference) can be compared with a new one as text.
 */
class DataExportComparison {

    static final int CONTEXT = 3

    final String expectedLabel
    final String actualLabel

    DataExportComparison(String expectedLabel, String actualLabel) {
        this.expectedLabel = expectedLabel
        this.actualLabel = actualLabel
    }

    static class Result {
        int filesCompared
        List<String> missing = []      // only in expected
        List<String> extra = []        // only in actual
        List<String> changed = []
        String diff = ''

        boolean isSame() { missing.empty && extra.empty && changed.empty }

        String summary() {
            if (same) {
                return "no difference in ${filesCompared} files"
            }
            List<String> parts = []
            if (missing) parts << "${missing.size()} missing"
            if (extra) parts << "${extra.size()} extra"
            if (changed) parts << "${changed.size()} changed"
            return "${parts.join(', ')} of ${filesCompared} files"
        }
    }

    Result compare(File expectedDir, File actualDir) {
        SortedSet<String> expected = relativeFiles(expectedDir)
        SortedSet<String> actual = relativeFiles(actualDir)
        Result r = new Result()
        SortedSet<String> all = new TreeSet<>(expected)
        all.addAll(actual)
        r.filesCompared = all.size()
        StringBuilder diff = new StringBuilder()
        all.each { String path ->
            List<String> a = expected.contains(path) ? lines(new File(expectedDir, path)) : []
            List<String> b = actual.contains(path) ? lines(new File(actualDir, path)) : []
            if (!expected.contains(path)) {
                r.extra << path
            } else if (!actual.contains(path)) {
                r.missing << path
            } else if (a == b) {
                return
            } else {
                r.changed << path
            }
            diff.append(unifiedDiff(path, expected.contains(path), actual.contains(path), a, b))
        }
        r.diff = diff.toString()
        return r
    }

    private static SortedSet<String> relativeFiles(File dir) {
        SortedSet<String> result = new TreeSet<>()
        if (!dir.directory) {
            return result
        }
        dir.eachFileRecurse { File f ->
            if (f.file) {
                result << dir.toPath().relativize(f.toPath()).toString().replace('\\', '/')
            }
        }
        return result
    }

    private static List<String> lines(File f) {
        String text = DataExportNormalizer.readUtf8(f)
        if (text.empty) {
            return []
        }
        List<String> result = text.split('\n', -1) as List<String>
        if (result && result[-1].empty) {
            result.remove(result.size() - 1)
        }
        return result
    }

    String unifiedDiff(String path, boolean inExpected, boolean inActual, List<String> a, List<String> b) {
        StringBuilder out = new StringBuilder()
        out.append("--- ${inExpected ? "${expectedLabel}/${path}" : '/dev/null'}\n")
        out.append("+++ ${inActual ? "${actualLabel}/${path}" : '/dev/null'}\n")
        List<List> ops = editScript(a, b)   // each: [op, lineA index, lineB index]
        // Group the edit script into hunks with CONTEXT lines around each change
        List<Integer> changeIdx = []
        ops.eachWithIndex { List op, int i -> if (op[0] != ' ') changeIdx << i }
        int i = 0
        while (i < changeIdx.size()) {
            int start = Math.max(0, changeIdx[i] - CONTEXT)
            int end = Math.min(ops.size() - 1, changeIdx[i] + CONTEXT)
            int j = i + 1
            while (j < changeIdx.size() && changeIdx[j] - CONTEXT <= end + 1) {
                end = Math.min(ops.size() - 1, changeIdx[j] + CONTEXT)
                j++
            }
            List<List> hunk = ops.subList(start, end + 1)
            int aStart = firstIndex(ops, start, 1)
            int bStart = firstIndex(ops, start, 2)
            int aCount = hunk.count { it[0] != '+' }
            int bCount = hunk.count { it[0] != '-' }
            out.append("@@ -${range(aStart, aCount)} +${range(bStart, bCount)} @@\n")
            hunk.each { List op ->
                String line = op[0] == '+' ? b[(int) op[2]] : a[(int) op[1]]
                out.append(op[0]).append(line).append('\n')
            }
            i = j
        }
        return out.toString()
    }

    /** 1-based start line of the hunk on one side (index 1 = expected, 2 = actual). */
    private static int firstIndex(List<List> ops, int from, int side) {
        for (int k = from; k < ops.size(); k++) {
            if (ops[k][side] != null) {
                return ((int) ops[k][side]) + 1
            }
        }
        // Only insertions (or deletions) to the end: the line before them
        for (int k = from - 1; k >= 0; k--) {
            if (ops[k][side] != null) {
                return ((int) ops[k][side]) + 2
            }
        }
        return 1
    }

    private static String range(int start, int count) {
        if (count == 0) {
            return "${start - 1},0"
        }
        return count == 1 ? "${start}" : "${start},${count}"
    }

    /** Shortest edit script by longest common subsequence: [' '|'-'|'+', aIndex, bIndex]. */
    private static List<List> editScript(List<String> a, List<String> b) {
        int n = a.size(), m = b.size()
        // Trim the common head and tail so the table stays small for files with local changes
        int head = 0
        while (head < n && head < m && a[head] == b[head]) head++
        int tail = 0
        while (tail < n - head && tail < m - head && a[n - 1 - tail] == b[m - 1 - tail]) tail++
        int n2 = n - head - tail, m2 = m - head - tail
        int[][] lcs = new int[n2 + 1][m2 + 1]
        for (int x = n2 - 1; x >= 0; x--) {
            for (int y = m2 - 1; y >= 0; y--) {
                lcs[x][y] = a[head + x] == b[head + y] ? lcs[x + 1][y + 1] + 1 : Math.max(lcs[x + 1][y], lcs[x][y + 1])
            }
        }
        List<List> ops = []
        for (int k = 0; k < head; k++) ops << [' ', k, k]
        int x = 0, y = 0
        while (x < n2 && y < m2) {
            if (a[head + x] == b[head + y]) {
                ops << [' ', head + x, head + y]; x++; y++
            } else if (lcs[x + 1][y] >= lcs[x][y + 1]) {
                ops << ['-', head + x, null]; x++
            } else {
                ops << ['+', null, head + y]; y++
            }
        }
        while (x < n2) { ops << ['-', head + x, null]; x++ }
        while (y < m2) { ops << ['+', null, head + y]; y++ }
        for (int k = 0; k < tail; k++) ops << [' ', n - tail + k, m - tail + k]
        return ops
    }
}
