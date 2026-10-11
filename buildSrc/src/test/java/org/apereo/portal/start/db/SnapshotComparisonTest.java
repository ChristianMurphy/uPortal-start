package org.apereo.portal.start.db;

import static org.junit.jupiter.api.Assertions.assertEquals;
import static org.junit.jupiter.api.Assertions.assertFalse;
import static org.junit.jupiter.api.Assertions.assertTrue;

import java.io.File;
import java.io.IOException;
import java.nio.charset.StandardCharsets;
import java.nio.file.Files;
import java.nio.file.Path;
import java.util.Arrays;
import java.util.Collections;
import java.util.List;
import org.junit.jupiter.api.Test;
import org.junit.jupiter.api.io.TempDir;

/**
 * Removed generator definitions ("generators declared -table(...)" in intended-changes.txt): the
 * definitions leave the baseline's declared text, and the rest of generators.txt is still compared
 * exactly.
 */
class SnapshotComparisonTest {

    private static final String WITH_TABLE =
            "concurrency.locking.ClusterMutex table=UP_MUTEX id=MUTEX_ID generator=UP_MUTEX_GEN"
                    + " declared=sequence(UP_MUTEX_SEQ,alloc=1)+table(hibernate_sequences[UP_MUTEX_PROP],alloc=1)"
                    + " backing=TABLE UP_MUTEX_SEQ next_val=1 rows=0 max-id=null";
    private static final String WITHOUT_TABLE =
            "concurrency.locking.ClusterMutex table=UP_MUTEX id=MUTEX_ID generator=UP_MUTEX_GEN"
                    + " declared=sequence(UP_MUTEX_SEQ,alloc=1)"
                    + " backing=TABLE UP_MUTEX_SEQ next_val=1 rows=0 max-id=null";

    @TempDir Path dir;

    @Test
    void removedDefinitionsAreNoDrift() throws IOException {
        SnapshotComparison result = compare(WITH_TABLE, WITHOUT_TABLE, true);
        assertTrue(result.isZeroDrift(), String.join("\n", result.report("test")));
        assertTrue(result.getDeclarationChanges().get(0).isFound());
    }

    @Test
    void withoutTheEntryTheyAreGeneratorDrift() throws IOException {
        SnapshotComparison result = compare(WITH_TABLE, WITHOUT_TABLE, false);
        assertTrue(result.isGeneratorDrift());
        assertFalse(result.isZeroDrift());
    }

    @Test
    void aChangedBackingIsStillDrift() throws IOException {
        String otherValue = WITHOUT_TABLE.replace("next_val=1", "next_val=2");
        SnapshotComparison result = compare(WITH_TABLE, otherValue, true);
        assertTrue(result.isGeneratorDrift());
        assertFalse(result.isZeroDrift());
    }

    @Test
    void definitionsTheRunStillDeclaresAreNotFound() throws IOException {
        SnapshotComparison result = compare(WITH_TABLE, WITH_TABLE, true);
        assertFalse(result.getDeclarationChanges().get(0).isFound());
        assertFalse(result.isZeroDrift());
    }

    @Test
    void aBaselineThatAllocatesFromTheTableIsNotFound() throws IOException {
        String backedByTable =
                WITH_TABLE.replace(
                        "backing=TABLE UP_MUTEX_SEQ next_val=1",
                        "backing=TABLE-ROW hibernate_sequences[UP_MUTEX_PROP] next_val=1");
        String runBackedByTable =
                WITHOUT_TABLE.replace(
                        "backing=TABLE UP_MUTEX_SEQ next_val=1",
                        "backing=TABLE-ROW hibernate_sequences[UP_MUTEX_PROP] next_val=1");
        SnapshotComparison result = compare(backedByTable, runBackedByTable, true);
        assertEquals(1, result.getDeclarationChanges().get(0).getBaselineBacked().size());
        assertFalse(result.isZeroDrift());
    }

    /**
     * Every 5.17 baseline, compared with a copy whose generators.txt lacks only the
     * hibernate_sequences definitions (what Hibernate 5.2's mappings produce), shows zero drift
     * with the entry in the real intended-changes.txt.
     */
    @Test
    void the517BaselinesWithoutTheDefinitionsAreNoDrift() throws IOException {
        File set = new File("../tests/db/snapshots/5.17").getCanonicalFile();
        File intended = new File(set, "intended-changes.txt");
        File[] vendors = set.listFiles(f -> new File(f, "generators.txt").isFile());
        assertTrue(vendors != null && vendors.length > 0, "no baselines in " + set);
        for (File vendor : vendors) {
            File current = dir.resolve(vendor.getName()).toFile();
            current.mkdirs();
            for (String name : Arrays.asList("schema.txt", "schema-normalized.txt")) {
                Files.copy(vendor.toPath().resolve(name), current.toPath().resolve(name));
            }
            List<String> generators = new java.util.ArrayList<>();
            for (String line :
                    Files.readAllLines(vendor.toPath().resolve("generators.txt"), StandardCharsets.UTF_8)) {
                generators.add(line.replaceAll("\\+table\\(hibernate_sequences\\[[^\\]]*\\],alloc=[^)]*\\)", ""));
            }
            Files.write(current.toPath().resolve("generators.txt"), generators, StandardCharsets.UTF_8);
            SnapshotComparison result =
                    SnapshotComparison.compare(
                            vendor,
                            current,
                            SnapshotComparison.SequenceValues.EXACT,
                            Collections.emptyList(),
                            SnapshotComparison.readDeclarationChanges(intended));
            assertTrue(result.isZeroDrift(), vendor.getName() + "\n" + String.join("\n", result.report("test")));
            assertEquals(49, result.getDeclarationChanges().get(0).getBaselineDeclared(), vendor.getName());
        }
    }

    private SnapshotComparison compare(String baselineEntity, String currentEntity, boolean listed)
            throws IOException {
        File baseline = snapshot("baseline", baselineEntity);
        File current = snapshot("current", currentEntity);
        File intended = dir.resolve("intended-changes.txt").toFile();
        Files.write(
                intended.toPath(),
                Arrays.asList("generators declared -table(hibernate_sequences) MOD-D33"),
                StandardCharsets.UTF_8);
        List<SnapshotComparison.DeclarationChange> declarations =
                listed
                        ? SnapshotComparison.readDeclarationChanges(intended)
                        : Collections.emptyList();
        assertTrue(SnapshotComparison.readIntendedChanges(intended).isEmpty());
        return SnapshotComparison.compare(
                baseline,
                current,
                SnapshotComparison.SequenceValues.EXACT,
                Collections.emptyList(),
                declarations);
    }

    private File snapshot(String name, String entity) throws IOException {
        File d = dir.resolve(name).toFile();
        d.mkdirs();
        List<String> schema = Arrays.asList("[tables]", "UP_MUTEX");
        Files.write(new File(d, "schema.txt").toPath(), schema, StandardCharsets.UTF_8);
        Files.write(
                new File(d, "schema-normalized.txt").toPath(), schema, StandardCharsets.UTF_8);
        Files.write(
                new File(d, "generators.txt").toPath(),
                Arrays.asList("[entities]", entity),
                StandardCharsets.UTF_8);
        return d;
    }
}
