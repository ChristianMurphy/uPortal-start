package scaldingspoon.gradle

import org.gradle.api.Action
import org.gradle.api.Plugin
import org.gradle.api.Project
import org.gradle.api.file.DuplicatesStrategy
import org.gradle.api.plugins.WarPlugin
import org.gradle.api.tasks.bundling.War

/**
 * Plugin class to support WAR overlay
 */
class WarOverlayPlugin implements Plugin<Project> {
    @Override
    void apply(Project project) {
        project.plugins.apply(WarPlugin)
        WarOverlayExtension extension = project.extensions.create('warOverlay', WarOverlayExtension)

        project.tasks.withType(War).configureEach(new Action<War>() {
            @Override
            void execute(War war) {
                war.duplicatesStrategy = DuplicatesStrategy.EXCLUDE
                war.doFirst {
                    war.classpath = war.classpath.filter { !it.name.endsWith(".war") }

                    war.project.configurations.runtimeClasspath.each {
                        if (it.name.endsWith(".war")) {
                            def fileList = war.project.zipTree(it)
                            if (extension.includeWarJars) {
                                war.from fileList
                            } else {
                                war.from fileList.matching { exclude "**/*.jar" }
                            }
                        }
                    }
                }
            }
        })
    }
}

/**
 * Extension to configure war overlay specific parameters
 */
class WarOverlayExtension {
    boolean includeWarJars = false
}
