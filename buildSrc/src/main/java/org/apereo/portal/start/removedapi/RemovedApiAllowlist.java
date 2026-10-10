package org.apereo.portal.start.removedapi;

import java.io.File;
import java.io.IOException;
import java.nio.charset.StandardCharsets;
import java.nio.file.Files;
import java.util.ArrayList;
import java.util.List;
import java.util.regex.Pattern;

/**
 * Accepted uses of removed APIs.  One entry per line, five fields separated by {@code |}:
 *
 * <pre>webapp | location | source | api | reason</pre>
 *
 * The first four are globs ({@code *} matches anything, {@code /} included) over a hit's webapp
 * name, location (a jar name, {@code WEB-INF/classes} or a JSP path), source (the referencing
 * class, or the JSP line) and API ({@code owner#member} or a class name).  The reason is required.
 */
public final class RemovedApiAllowlist {

    public static final class Entry {
        public final int line;
        public final String text;
        final Pattern[] globs = new Pattern[4];
        public final String reason;
        public int uses;

        Entry(int line, String text, String[] f) {
            this.line = line;
            this.text = text;
            for (int i = 0; i < 4; i++) {
                globs[i] = glob(f[i].trim());
            }
            this.reason = f[4].trim();
        }

        boolean matches(String webapp, RemovedApiScanner.Hit hit) {
            return globs[0].matcher(webapp).matches()
                    && globs[1].matcher(hit.location).matches()
                    && globs[2].matcher(hit.source).matches()
                    && globs[3].matcher(hit.api).matches();
        }
    }

    public final List<Entry> entries = new ArrayList<>();

    public static RemovedApiAllowlist read(File file) throws IOException {
        RemovedApiAllowlist list = new RemovedApiAllowlist();
        if (file == null || !file.exists()) {
            return list;
        }
        int n = 0;
        for (String line : Files.readAllLines(file.toPath(), StandardCharsets.UTF_8)) {
            n++;
            String t = line.trim();
            if (t.isEmpty() || t.startsWith("#")) {
                continue;
            }
            String[] f = t.split("\\|", 5);
            if (f.length != 5 || f[4].trim().isEmpty()) {
                throw new IOException(
                        file + ":" + n + ": expected 'webapp | location | source | api | reason' with a reason");
            }
            list.entries.add(new Entry(n, t, f));
        }
        return list;
    }

    /** The entry that accepts the hit, or null. */
    public Entry accepting(String webapp, RemovedApiScanner.Hit hit) {
        for (Entry e : entries) {
            if (e.matches(webapp, hit)) {
                e.uses++;
                return e;
            }
        }
        return null;
    }

    static Pattern glob(String g) {
        StringBuilder re = new StringBuilder();
        for (char c : g.toCharArray()) {
            if (c == '*') {
                re.append(".*");
            } else if (c == '?') {
                re.append('.');
            } else {
                re.append(Pattern.quote(String.valueOf(c)));
            }
        }
        return Pattern.compile(re.toString());
    }
}
