package org.apereo.portal.start.removedapi;

import java.io.BufferedReader;
import java.io.IOException;
import java.io.InputStream;
import java.io.InputStreamReader;
import java.nio.charset.StandardCharsets;
import java.util.Collections;
import java.util.LinkedHashMap;
import java.util.Map;

/**
 * The removed classes and members the scanner looks for, read from the {@code removed-api/*.txt}
 * resources: one rule per line, {@code class <internal name> <spec>} or {@code member <owner>
 * <name><descriptor> <spec>} (a field is {@code <name>:<descriptor>}).
 */
public final class RemovedApiRules {

    static final String[] RESOURCES = {
        "/removed-api/servlet6-pages4.txt", "/removed-api/tomcat-internals.txt"
    };

    /** Removed class (internal name) to the specification or release that removed it. */
    final Map<String, String> classes = new LinkedHashMap<>();

    /** Owner class to its removed members ({@code name+descriptor}) and who removed them. */
    final Map<String, Map<String, String>> members = new LinkedHashMap<>();

    public static RemovedApiRules load() throws IOException {
        RemovedApiRules rules = new RemovedApiRules();
        for (String resource : RESOURCES) {
            try (InputStream in = RemovedApiRules.class.getResourceAsStream(resource)) {
                if (in == null) {
                    throw new IOException("Missing scanner rules " + resource);
                }
                rules.read(new BufferedReader(new InputStreamReader(in, StandardCharsets.UTF_8)));
            }
        }
        return rules;
    }

    void read(BufferedReader reader) throws IOException {
        for (String line = reader.readLine(); line != null; line = reader.readLine()) {
            line = line.trim();
            if (line.isEmpty() || line.startsWith("#")) {
                continue;
            }
            String[] f = line.split("\\s+");
            if (f[0].equals("class") && f.length == 3) {
                classes.put(f[1], f[2]);
            } else if (f[0].equals("member") && f.length == 4) {
                members.computeIfAbsent(f[1], k -> new LinkedHashMap<>()).put(f[2], f[3]);
            } else {
                throw new IOException("Unreadable scanner rule: " + line);
            }
        }
    }

    public int size() {
        int n = classes.size();
        for (Map<String, String> m : members.values()) {
            n += m.size();
        }
        return n;
    }

    public Map<String, String> getClasses() {
        return Collections.unmodifiableMap(classes);
    }
}
