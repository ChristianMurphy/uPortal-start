package org.apereo.portal.start.shell

import org.apache.tools.ant.BuildException
import org.gradle.api.Project
import org.gradle.api.plugins.BasePluginExtension

/**
 * This class knows how to invoke org.apereo.portal.shell.PortalShell within the overlays:uPortal
 * project.  (It can't do anything in any other project.)
 */
class PortalShellInvoker {

    void invoke(Project project, String scriptLocation, String... args) {
        File serverBase = project.rootProject.file(project.rootProject.ext['buildProperties'].getProperty('server.base'))
        File deployDir = new File (serverBase, "webapps/${project.name}")

        /*
         * The shell jars go into a directory of their own that holds exactly the jars of this
         * uPortalVersion: a build that switches versions (tests/db/equivalence.sh deploys 5.17
         * and then the current build into one checkout) must not leave the other version's jars
         * on the classpath, where the wildcard would pick up both.
         */
        File libsDir = new File(project.rootProject.extensions.getByType(BasePluginExtension).libsDirectory.get().asFile, 'portal-shell')
        libsDir.mkdirs()
        Set<File> shellJars = project.configurations.shell.files
        Set<String> wanted = shellJars.collect { it.name } as Set
        libsDir.listFiles().each {
            if (!wanted.contains(it.name)) {
                it.delete()
            }
        }
        // One copy task for all the jars logs one line; a task for each jar logged 252 lines
        project.ant.copy(todir: libsDir) {
            shellJars.each { jar ->
                fileset(file: jar.absolutePath)
            }
        }

        project.ant.setLifecycleLogLevel('INFO')
        try {
            project.ant.java(fork: true, failonerror: true, jvm: project.rootProject.ext['portalJava'], dir: project.rootProject.projectDir, classname: 'org.apereo.portal.shell.PortalShell') {
                classpath {
                    pathelement(location: "${deployDir}/WEB-INF/classes")
                    pathelement(location: "${deployDir}/WEB-INF/lib/*")
                    pathelement(location: "${libsDir}/*")
                }
                sysproperty(key: 'portal.home', value: project.rootProject.ext['buildProperties'].getProperty('portal.home'))
                sysproperty(key: 'logback.configurationFile', value: logbackConfiguration(project))
                sysproperty(key: 'java.awt.headless', value: 'true')
                arg(value: '-s')
                arg(value: scriptLocation)
                args.each {
                    arg(value: it)
                }
            }
        } catch (BuildException e) {
            printEntityFailures(project)
            throw e
        }
    }

    /**
     * Whether the data import, export and schema tools log only warnings and errors, and the
     * import prints one summary line per entity type instead of a line per entity (MOD-D53). In
     * CI (the CI environment variable is set, as on GitHub Actions) they would otherwise write
     * about 5000 lines for one dataInit. -PquietImport turns it on anywhere and -PquietImport=false
     * turns it off in CI.
     */
    static boolean quietImport(Project project) {
        Object property = project.findProperty('quietImport')
        if (property != null) {
            return property.toString() != 'false'
        }
        String ci = System.getenv('CI')
        return ci != null && !ci.isEmpty() && ci != 'false'
    }

    /**
     * The value of the logback.configurationFile system property for a tool that imports or
     * exports data: the CI configuration, which logs warnings and errors, when quietImport() is
     * true, else command-line.logback.xml from the tool's own classpath. The CI file is given by
     * path, because the portlets' own WEB-INF/classes hold a different command-line.logback.xml.
     */
    static String logbackConfiguration(Project project) {
        if (!quietImport(project)) {
            return 'command-line.logback.xml'
        }
        return project.rootProject.file('overlays/uPortal/src/main/resources/command-line.ci.logback.xml').absolutePath
    }

    /**
     * Groovy for a generated shell script that prints one line per entity type after a
     * dataImport call: how many files of the type the call imported and how many failed. The
     * dataImport call writes these counts to build/data-import-reports/data-import.txt, and
     * the next call replaces that file, so the script prints them right after each call. Empty
     * when quietImport() is false, because the import then logs a line per entity itself.
     *
     * @param label what the call imported, e.g. its data directory
     */
    static String importSummaryScript(Project project, String label, String logDir) {
        if (!quietImport(project)) {
            return ''
        }
        return """
printImportSummary('${label}', '${logDir}');
"""
    }

    /**
     * Groovy that defines printImportSummary(), put at the start of a script that calls
     * importSummaryScript(). Empty when quietImport() is false.
     */
    static String importSummaryDefinition(Project project) {
        if (!quietImport(project)) {
            return ''
        }
        return PortalShellInvoker.class.getResourceAsStream('/import-summary.groovy').getText('UTF-8')
    }

    /**
     * Prints why entities failed to import or export: the exception lines of the per-entity
     * reports that the import or export wrote (build/data-import-reports and data-export-reports).
     * The console shows only that N entities failed and where the reports are.
     */
    static void printEntityFailures(Project project) {
        List<String> causes = []
        List<String> failed = []
        ['data-import-reports', 'data-export-reports'].each { String reportsDir ->
            File dir = new File(project.layout.buildDirectory.get().asFile, reportsDir)
            File[] reports = dir.listFiles()
            reports?.sort { it.name }?.each { File report ->
                if (report.name.startsWith('data-')) {
                    return
                }
                List<String> lines = report.readLines('UTF-8')
                if (lines && lines[0].startsWith('FAIL:')) {
                    failed << lines[0]
                    lines.findAll { it =~ /^(Caused by|[A-Za-z0-9_.\$]+(Exception|Error):)/ }.each { causes << it }
                }
            }
        }
        if (failed) {
            project.logger.lifecycle("${failed.size()} failed: ${failed.take(10).join('; ')}")
            causes.unique().take(10).each { project.logger.lifecycle(it) }
        }
    }

    static String createGroovySafePath(String rawPath) {
        return rawPath.replaceAll('\\\\', '/')
    }

}
