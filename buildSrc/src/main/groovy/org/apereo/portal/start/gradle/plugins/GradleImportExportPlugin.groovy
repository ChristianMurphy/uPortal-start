package org.apereo.portal.start.gradle.plugins

import org.gradle.api.Plugin
import org.gradle.api.Project
import org.gradle.api.provider.Provider

class GradleImportExportPlugin implements Plugin<Project> {
    @Override
    void apply(Project project) {
        // One data task at a time against the portal database, across all overlays (MOD-I100)
        Provider<PortalDatabaseService> portalDatabase = project.gradle.sharedServices.registerIfAbsent(
                'portalDatabase', PortalDatabaseService) { spec -> spec.maxParallelUsages.set(1) }
        project.task('dataInit') {
            group = 'Data'
            usesService(portalDatabase)
            dependsOn project.rootProject.tasks.portalProperties, project.tasks.tomcatDeploy
            doFirst {
                if (project.tasks.dataInit.actions.size() == 1) {
                    logger.lifecycle('No actions have been defined for this task in this project')
                }
            }
        }
        project.task('dataImport') {
            group = 'Data'
            usesService(portalDatabase)
            dependsOn project.rootProject.tasks.portalProperties
            mustRunAfter project.tasks.tomcatDeploy
            doFirst {
                if (project.tasks.dataImport.actions.size() == 1) {
                    logger.lifecycle('No actions have been defined for this task in this project')
                }
            }
        }
        project.task('dataExport') {
            group = 'Data'
            usesService(portalDatabase)
            dependsOn project.rootProject.tasks.portalProperties
            mustRunAfter project.tasks.tomcatDeploy
            doFirst {
                if (project.tasks.dataExport.actions.size() == 1) {
                    logger.lifecycle('No actions have been defined for this task in this project')
                }
            }
        }
        project.task('dataDelete') {
            group = 'Data'
            usesService(portalDatabase)
            dependsOn project.rootProject.tasks.portalProperties
            mustRunAfter project.tasks.tomcatDeploy
            doFirst {
                if (project.tasks.dataDelete.actions.size() == 1) {
                    logger.lifecycle('No actions have been defined for this task in this project')
                }
            }
        }
        project.task('dataList') {
            group = 'Data'
            usesService(portalDatabase)
            dependsOn project.rootProject.tasks.portalProperties
            mustRunAfter project.tasks.tomcatDeploy
            doFirst {
                if (project.tasks.dataList.actions.size() == 1) {
                    logger.lifecycle('No actions have been defined for this task in this project')
                }
            }
        }
    }
}
