// Defines printImportSummary(), which PortalShellInvoker.importSummaryDefinition() puts at the
// start of a generated shell script when the import is quiet (CI, MOD-D53). After each dataImport
// call the script calls it to print one line per entity type from the call's report, build/
// data-import-reports/data-import.txt. In that report a line "<key>,N" starts the N files of one
// type and version, and each file follows as "SUCCESS,file [...],Tms" or "FAIL,...".
def printImportSummary(String label, String logDir) {
    File report = new File(logDir, 'data-import-reports/data-import.txt')
    if (!report.file) {
        return
    }
    Map counts = [:]
    String type = null
    boolean secondPass = false
    report.eachLine('UTF-8') { String line ->
        def header = (line =~ /^<(?:\{[^}]*\})?([A-Za-z0-9_.-]+)\b.*>,\d+$/)
        if (header.matches()) {
            type = header.group(1)
            // Groups are imported twice, first the groups and then their members, from the same files
            secondPass = line.contains('version="MEMBERS"')
            counts.putIfAbsent(type, [0, 0])
        } else if (type != null && line.startsWith('SUCCESS,')) {
            if (!secondPass) {
                counts[type][0]++
            }
        } else if (type != null && line =~ /^(FAIL|TIMEOUT),/) {
            counts[type][1]++
        }
    }
    counts.each { entityType, c ->
        println "Import from ${label}: ${entityType}: ${c[0]} imported" + (c[1] ? ", ${c[1]} FAILED" : '')
    }
}
