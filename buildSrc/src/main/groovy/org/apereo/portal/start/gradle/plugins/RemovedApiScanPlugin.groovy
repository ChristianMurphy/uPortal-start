package org.apereo.portal.start.gradle.plugins

import org.apereo.portal.start.removedapi.RemovedApiAllowlist
import org.apereo.portal.start.removedapi.RemovedApiRules
import org.apereo.portal.start.removedapi.RemovedApiScanner
import org.gradle.api.DefaultTask
import org.gradle.api.GradleException
import org.gradle.api.Plugin
import org.gradle.api.Project
import org.gradle.api.file.ConfigurableFileCollection
import org.gradle.api.file.RegularFileProperty
import org.gradle.api.provider.Property
import org.gradle.api.tasks.Classpath
import org.gradle.api.tasks.Input
import org.gradle.api.tasks.InputFile
import org.gradle.api.tasks.Optional
import org.gradle.api.tasks.OutputFile
import org.gradle.api.tasks.PathSensitive
import org.gradle.api.tasks.PathSensitivity
import org.gradle.api.tasks.TaskAction
import org.gradle.api.tasks.bundling.War

/**
 * Adds 'removedApiScan', which fails the build when the overlay's WAR uses a Servlet, Pages, EL
 * or Tomcat API that Tomcat 11 (Jakarta EE 11) removed, unless overlays/removed-api-allowlist.txt
 * accepts that use with a reason.  'check' and 'tomcatDeploy' depend on it.  See
 * RemovedApiScanner for what it finds.
 */
class RemovedApiScanPlugin implements Plugin<Project> {
    @Override
    void apply(Project project) {
        project.configurations.create('removedApiReference') {
            description = 'The javax Servlet, Pages and EL APIs, for resolving member references'
            transitive = false
        }
        project.dependencies {
            removedApiReference project.servletApiDependency
            removedApiReference "javax.servlet.jsp:javax.servlet.jsp-api:${project.jspApiVersion}"
            removedApiReference "javax.el:javax.el-api:${project.elApiVersion}"
        }
        def scan = project.tasks.register('removedApiScan', RemovedApiScanTask) {
            group = 'Verification'
            description = 'Fails on uses of Servlet, Pages, EL and Tomcat APIs that Tomcat 11 removed'
            war.set(project.tasks.named('war', War).flatMap { it.archiveFile })
            webapp.set(project.name)
            referenceApis.from(project.configurations.removedApiReference)
            allowlist.set(project.rootProject.file('overlays/removed-api-allowlist.txt'))
            report.set(project.layout.buildDirectory.file('reports/removed-api.txt'))
        }
        project.tasks.named('check') { dependsOn scan }
        project.tasks.matching { it.name == 'tomcatDeploy' }.configureEach { dependsOn scan }
    }
}

abstract class RemovedApiScanTask extends DefaultTask {
    @InputFile
    @PathSensitive(PathSensitivity.NONE)
    abstract RegularFileProperty getWar()

    @Input
    abstract Property<String> getWebapp()

    @Classpath
    abstract ConfigurableFileCollection getReferenceApis()

    @InputFile
    @Optional
    @PathSensitive(PathSensitivity.NONE)
    abstract RegularFileProperty getAllowlist()

    @OutputFile
    abstract RegularFileProperty getReport()

    @TaskAction
    void scan() {
        RemovedApiRules rules = RemovedApiRules.load()
        RemovedApiAllowlist allowlist = RemovedApiAllowlist.read(getAllowlist().getAsFile().getOrNull())
        String name = getWebapp().get()
        List<RemovedApiScanner.Hit> hits = new RemovedApiScanner(rules, getReferenceApis().files as List)
                .scan(getWar().get().asFile)

        List<String> accepted = []
        List<String> rejected = []
        hits.each { hit ->
            RemovedApiAllowlist.Entry entry = allowlist.accepting(name, hit)
            if (entry) {
                accepted << "allowed (allowlist line ${entry.line}):  ${hit}"
            } else {
                rejected << "REMOVED:  ${hit}"
            }
        }
        // An entry for every webapp ('*') need not match in each one;  one naming this webapp should
        List<String> unused = allowlist.entries.findAll {
            String webapp = it.text.split('\\|')[0].trim()
            it.uses == 0 && webapp != '*' && RemovedApiAllowlist.glob(webapp).matcher(name).matches()
        }.collect { "unused allowlist line ${it.line}:  ${it.text}" }

        File out = getReport().get().asFile
        out.parentFile.mkdirs()
        out.text = ([
                "Removed-API scan of ${name} (${getWar().get().asFile.name}):  ${rules.size()} rules, " +
                        "${hits.size()} hits, ${accepted.size()} allowed, ${rejected.size()} not allowed"
        ] + rejected + accepted + unused).join('\n') + '\n'

        unused.each { logger.warn("${name}: ${it}") }
        if (rejected) {
            throw new GradleException("${name} uses ${rejected.size()} API(s) that Tomcat 11 removed " +
                    "(Servlet 6.0/6.1, Pages 4.0, EL 6.0, Tomcat internals):\n  " + rejected.join('\n  ') +
                    "\nFix the overlay, or add a line with a reason to overlays/removed-api-allowlist.txt.  " +
                    "Report:  ${out}")
        }
        logger.lifecycle("${name}: no unaccepted removed-API uses (${hits.size()} hits, all allowlisted)")
    }
}
