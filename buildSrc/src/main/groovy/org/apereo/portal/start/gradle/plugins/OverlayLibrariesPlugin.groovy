package org.apereo.portal.start.gradle.plugins

import java.util.regex.Pattern
import java.util.zip.ZipFile
import org.gradle.api.Plugin
import org.gradle.api.Project
import org.gradle.api.artifacts.Configuration
import org.gradle.api.file.FileTreeElement
import org.gradle.api.tasks.SourceSet
import org.gradle.api.tasks.bundling.War

/**
 * Declarative fixes to the libraries inside an overlaid WAR, written once (overlays/build.gradle)
 * and applied to every overlay whose WAR needs them:
 *
 * <pre>
 * overlayLibraries {
 *     // When the WAR ships a jar matching 'jars', drop every such jar and package these instead
 *     replace('jstl') {
 *         jars = ~/jstl-.*\.jar/
 *         libraries 'group:artifact:version', ...
 *     }
 *     // When the WAR ships a jar matching 'whenWarContains', compile these sources into
 *     // WEB-INF/classes (which the webapp class loader reads before WEB-INF/lib)
 *     patch('spring3JspEl') {
 *         whenWarContains = ~/spring-web-3\..*\.jar/
 *         source 'overlays/patches/spring3-jsp-el'
 *         compileOnly 'group:artifact:version', ...
 *     }
 * }
 * </pre>
 *
 * Whether a rule applies is decided when the WAR is built, from the jar names in the overlaid WAR
 * and in the overlay's own runtime classpath.  build/reports/overlay-libraries.txt says what was
 * done.
 */
class OverlayLibrariesPlugin implements Plugin<Project> {
    @Override
    void apply(Project project) {
        project.extensions.create('overlayLibraries', OverlayLibrariesExtension, project)
        project.tasks.named('war', War).configure { War war ->
            war.doFirst {
                project.delete(project.layout.buildDirectory.file('reports/overlay-libraries.txt'))
            }
        }
    }
}

class OverlayLibrariesExtension {
    final Project project
    Set<String> libraryNames

    OverlayLibrariesExtension(Project project) {
        this.project = project
    }

    /** The jar names the WAR would package without these rules. */
    synchronized Set<String> libraryNames() {
        if (libraryNames == null) {
            Set<String> names = new TreeSet<>()
            project.configurations.runtimeClasspath.files.each { File f ->
                if (f.name.endsWith('.war')) {
                    new ZipFile(f).withCloseable { zip ->
                        zip.entries().each { e ->
                            if (e.name.startsWith('WEB-INF/lib/') && e.name.endsWith('.jar')) {
                                names << e.name.substring('WEB-INF/lib/'.length())
                            }
                        }
                    }
                } else if (f.name.endsWith('.jar')) {
                    names << f.name
                }
            }
            libraryNames = names
        }
        return libraryNames
    }

    void replace(String name, Closure closure) {
        ReplaceRule rule = new ReplaceRule(name: name)
        project.configure(rule, closure)
        Configuration replacement = project.configurations.create("overlayLibraries${name.capitalize()}") {
            transitive = false
        }
        rule.dependencies.each { project.dependencies.add(replacement.name, it) }

        Closure<Boolean> applies = { -> libraryNames().any { rule.jars.matcher(it).matches() } }
        project.tasks.named('war', War).configure { War war ->
            war.inputs.property("overlayLibraries.${name}", rule.toString())
            war.classpath({ -> applies() ? replacement : [] })
            war.exclude { FileTreeElement e ->
                String path = e.relativePath.pathString
                path.startsWith('WEB-INF/lib/') && !e.directory && rule.jars.matcher(e.name).matches() &&
                        !replacement.files*.name.contains(e.name) && applies()
            }
            war.doLast {
                if (applies()) {
                    report("${name}: replaced ${libraryNames().findAll { rule.jars.matcher(it).matches() }} " +
                            "with ${replacement.files*.name} (${rule.reason})")
                }
            }
        }
    }

    void patch(String name, Closure closure) {
        PatchRule rule = new PatchRule(name: name)
        project.configure(rule, closure)
        SourceSet sourceSet = project.sourceSets.create("overlayPatch${name.capitalize()}") {
            java.srcDirs = rule.sources.collect { project.rootProject.file(it) }
            resources.srcDirs = []
        }
        rule.compileOnly.each { project.dependencies.add(sourceSet.compileOnlyConfigurationName, it) }

        Closure<Boolean> applies = { -> libraryNames().any { rule.whenWarContains.matcher(it).matches() } }
        project.tasks.named('war', War).configure { War war ->
            war.dependsOn sourceSet.classesTaskName
            war.inputs.property("overlayLibraries.${name}", rule.toString())
            war.from({ -> applies() ? sourceSet.output.classesDirs : [] }) {
                into 'WEB-INF/classes'
            }
            war.doLast {
                if (applies()) {
                    report("${name}: patched WEB-INF/classes from ${rule.sources} (${rule.reason})")
                }
            }
        }
    }

    void report(String line) {
        File f = project.layout.buildDirectory.file('reports/overlay-libraries.txt').get().asFile
        f.parentFile.mkdirs()
        f << line + '\n'
        project.logger.lifecycle("${project.name}: ${line}")
    }
}

class ReplaceRule {
    String name
    Pattern jars
    String reason = ''
    List<Object> dependencies = []

    void libraries(Object... notations) {
        dependencies.addAll(notations)
    }

    String toString() {
        "${name} ${jars} ${dependencies}"
    }
}

class PatchRule {
    String name
    Pattern whenWarContains
    String reason = ''
    List<String> sources = []
    List<Object> compileOnly = []

    void source(String... dirs) {
        sources.addAll(dirs)
    }

    void compileOnly(Object... notations) {
        compileOnly.addAll(notations)
    }

    String toString() {
        "${name} ${whenWarContains} ${sources} ${compileOnly}"
    }
}
