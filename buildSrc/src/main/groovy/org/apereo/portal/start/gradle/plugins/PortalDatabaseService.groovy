package org.apereo.portal.start.gradle.plugins

import org.gradle.api.services.BuildService
import org.gradle.api.services.BuildServiceParameters

/**
 * Stands for the one portal database that the data tasks of every overlay (uPortal and the
 * bundled portlets) work on. GradleImportExportPlugin registers it with maxParallelUsages = 1, so
 * those tasks run one at a time even with org.gradle.parallel: on SQL Server the portlets' schema
 * updates, run in parallel by dataInit, deadlock on the catalog and one of them fails (MOD-I100).
 */
abstract class PortalDatabaseService implements BuildService<BuildServiceParameters.None> {
}
