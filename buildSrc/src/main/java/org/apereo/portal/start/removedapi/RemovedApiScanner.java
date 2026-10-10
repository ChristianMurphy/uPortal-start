package org.apereo.portal.start.removedapi;

import java.io.ByteArrayInputStream;
import java.io.File;
import java.io.IOException;
import java.io.InputStream;
import java.nio.charset.StandardCharsets;
import java.util.ArrayList;
import java.util.HashMap;
import java.util.HashSet;
import java.util.LinkedHashSet;
import java.util.List;
import java.util.Map;
import java.util.Set;
import java.util.regex.Matcher;
import java.util.regex.Pattern;
import java.util.zip.ZipEntry;
import java.util.zip.ZipFile;
import java.util.zip.ZipInputStream;
import org.objectweb.asm.ClassReader;

/**
 * Finds the uses of Servlet, Pages, EL and Tomcat APIs that Tomcat 11 (Jakarta EE 11) no longer
 * has in one WAR:  its classes and every jar in {@code WEB-INF/lib} (bytecode, read with ASM),
 * and its JSPs and tag files (text).
 *
 * <ul>
 *   <li><b>Removed class</b>:  any mention of the class in a class file's constant pool:  a
 *       reference, a field, method or exception type, an annotation.  These are the failures the
 *       Tomcat 11 spike hit (MOD-D9):  the JVM or Jasper's tag introspection loads the class and
 *       fails, whether or not the code path runs.
 *   <li><b>Removed member</b>:  a field or method reference that resolves, through the WAR's own
 *       classes and the Servlet, Pages and EL APIs, to a member that was removed.  It resolves
 *       the way the JVM does, so {@code super.encodeUrl(..)} in a webapp subclass is found too.
 *   <li><b>JSP</b>:  {@code jsp:plugin}, {@code jsp:params}, {@code jsp:fallback} and the
 *       {@code isThreadSafe} page attribute (Pages 4.0), scriptlets calling removed methods on
 *       the implicit objects, removed class names, and {@code <spring:eval>} (Spring's
 *       {@code EvalTag} before Spring 5 links against the removed {@code jsp.el} API).
 * </ul>
 */
public final class RemovedApiScanner {

    /** One use of a removed API. */
    public static final class Hit {
        public final String kind; // class | member | jsp
        public final String location; // WEB-INF/classes, a jar name, or a JSP path
        public final String source; // the referencing class, or the JSP line
        public final String api;
        public final String spec;

        Hit(String kind, String location, String source, String api, String spec) {
            this.kind = kind;
            this.location = location;
            this.source = source;
            this.api = api;
            this.spec = spec;
        }

        @Override
        public String toString() {
            return kind + " " + api + " [" + spec + "] in " + location + " (" + source + ")";
        }
    }

    private static final class ClassInfo {
        final String superName;
        final String[] interfaces;
        final Set<String> declared;

        ClassInfo(ClassReader r) {
            this.superName = r.getSuperName();
            this.interfaces = r.getInterfaces();
            Set<String> d = new HashSet<>();
            r.accept(
                    new org.objectweb.asm.ClassVisitor(org.objectweb.asm.Opcodes.ASM9) {
                        @Override
                        public org.objectweb.asm.FieldVisitor visitField(
                                int access, String name, String desc, String sig, Object value) {
                            d.add(name + ":" + desc);
                            return null;
                        }

                        @Override
                        public org.objectweb.asm.MethodVisitor visitMethod(
                                int access, String name, String desc, String sig, String[] ex) {
                            d.add(name + desc);
                            return null;
                        }
                    },
                    ClassReader.SKIP_CODE | ClassReader.SKIP_DEBUG | ClassReader.SKIP_FRAMES);
            this.declared = d;
        }
    }

    private interface ClassFileVisitor {
        void visit(String location, String path, byte[] bytes) throws IOException;
    }

    private interface TextFileVisitor {
        void visit(String location, String path, String text);
    }

    private static final Pattern DESCRIPTOR_TYPE = Pattern.compile("L([\\w/$]+)[;<]");

    private static final Pattern JSP_FILE = Pattern.compile(".*\\.(jsp|jspf|jspx|tag|tagx)$");

    private final RemovedApiRules rules;
    private final List<File> apiJars;
    private final List<JspRule> jspRules = JspRule.defaults();

    /** Class files ASM could not read in the last scan (corrupt or unsupported), as location!/path. */
    public final List<String> unreadable = new ArrayList<>();

    public RemovedApiScanner(RemovedApiRules rules, List<File> apiJars) {
        this.rules = rules;
        this.apiJars = apiJars;
    }

    /** Every distinct hit in the WAR. */
    public List<Hit> scan(File war) throws IOException {
        unreadable.clear();
        Map<String, ClassInfo> index = new HashMap<>();
        for (File jar : apiJars) {
            try (ZipFile z = new ZipFile(jar)) {
                for (ZipEntry e : java.util.Collections.list(z.entries())) {
                    if (e.getName().endsWith(".class")) {
                        try (InputStream in = z.getInputStream(e)) {
                            ClassReader r = new ClassReader(in.readAllBytes());
                            index.putIfAbsent(r.getClassName(), new ClassInfo(r));
                        }
                    }
                }
            }
        }
        // Pass 1:  the WAR's own classes, for resolving members and for Tomcat-internal names it ships
        // (the webapp class loader reads WEB-INF/classes first, so a class there shadows a jar's copy)
        Map<String, ClassInfo> warClasses = new HashMap<>();
        Set<String> ownClasses = new HashSet<>();
        walkWar(
                war,
                (location, path, bytes) -> {
                    ClassReader r = new ClassReader(bytes);
                    if (location.equals("WEB-INF/classes")) {
                        ownClasses.add(r.getClassName());
                        warClasses.put(r.getClassName(), new ClassInfo(r));
                    } else {
                        warClasses.putIfAbsent(r.getClassName(), new ClassInfo(r));
                    }
                },
                null);
        index.putAll(warClasses);

        // Pass 2:  the references
        Set<String> seen = new HashSet<>();
        List<Hit> hits = new ArrayList<>();
        walkWar(
                war,
                (location, path, bytes) -> {
                    ClassReader r = new ClassReader(bytes);
                    String self = r.getClassName();
                    if (rules.classes.containsKey(self)) {
                        return; // a copy of a removed API class itself
                    }
                    if (!location.equals("WEB-INF/classes") && ownClasses.contains(self)) {
                        return; // shadowed by WEB-INF/classes, never loaded
                    }
                    char[] buf = new char[r.getMaxStringLength()];
                    Set<String> names = new LinkedHashSet<>();
                    for (int i = 1; i < r.getItemCount(); i++) {
                        int offset = r.getItem(i);
                        if (offset == 0) {
                            continue;
                        }
                        int tag = r.readByte(offset - 1);
                        if (tag == 7) { // Class
                            String n = r.readUTF8(offset, buf);
                            names.add(n.startsWith("[") ? stripArray(n) : n);
                        } else if (tag == 1) { // Utf8:  descriptors and signatures (ASCII is enough here)
                            String s = new String(
                                    bytes, offset + 2, r.readUnsignedShort(offset), StandardCharsets.ISO_8859_1);
                            if (s.indexOf(';') >= 0) {
                                Matcher m = DESCRIPTOR_TYPE.matcher(s);
                                while (m.find()) {
                                    names.add(m.group(1));
                                }
                            }
                        } else if (tag == 9 || tag == 10 || tag == 11) { // Field/Method/InterfaceMethodref
                            String owner = r.readClass(offset, buf);
                            int nat = r.getItem(r.readUnsignedShort(offset + 2));
                            String name = r.readUTF8(nat, buf);
                            String desc = r.readUTF8(nat + 2, buf);
                            if (owner.startsWith("[")) {
                                continue;
                            }
                            String key = tag == 9 ? name + ":" + desc : name + desc;
                            String[] found = resolve(index, owner, key, new HashSet<>());
                            if (found != null) {
                                add(hits, seen, new Hit("member", location, self, found[0] + "#" + key, found[1]));
                            }
                        }
                    }
                    for (String n : names) {
                        String spec = rules.classes.get(n);
                        if (spec != null && !(n.startsWith("org/apache/") && warClasses.containsKey(n))) {
                            add(hits, seen, new Hit("class", location, self, n, spec));
                        }
                    }
                },
                (location, path, text) -> {
                    for (JspRule rule : jspRules) {
                        for (String[] found : rule.find(text)) {
                            add(hits, seen, new Hit("jsp", location, found[0], found[1], rule.spec));
                        }
                    }
                });
        return hits;
    }

    private static String stripArray(String n) {
        String s = n.replaceFirst("^\\[+", "");
        return s.startsWith("L") && s.endsWith(";") ? s.substring(1, s.length() - 1) : s;
    }

    /** The removed member a reference resolves to, as {owner, spec}, or null. */
    private String[] resolve(Map<String, ClassInfo> index, String owner, String key, Set<String> visited) {
        if (owner == null || !visited.add(owner)) {
            return null;
        }
        Map<String, String> removed = rules.members.get(owner);
        if (removed != null && removed.containsKey(key)) {
            return new String[] {owner, removed.get(key)};
        }
        ClassInfo info = index.get(owner);
        if (info == null || info.declared.contains(key)) {
            return null;
        }
        String[] found = resolve(index, info.superName, key, visited);
        if (found != null) {
            return found;
        }
        for (String i : info.interfaces) {
            found = resolve(index, i, key, visited);
            if (found != null) {
                return found;
            }
        }
        return null;
    }

    private static void add(List<Hit> hits, Set<String> seen, Hit hit) {
        if (seen.add(hit.kind + "|" + hit.location + "|" + hit.source + "|" + hit.api)) {
            hits.add(hit);
        }
    }

    private void visitClass(ClassFileVisitor classes, String location, String path, byte[] bytes)
            throws IOException {
        try {
            classes.visit(location, path, bytes);
        } catch (RuntimeException e) {
            String where = location + "!/" + path;
            if (!unreadable.contains(where)) {
                unreadable.add(where);
            }
        }
    }

    private void walkWar(File war, ClassFileVisitor classes, TextFileVisitor jsps) throws IOException {
        try (ZipFile z = new ZipFile(war)) {
            for (ZipEntry e : java.util.Collections.list(z.entries())) {
                String name = e.getName();
                if (e.isDirectory()) {
                    continue;
                }
                if (name.startsWith("WEB-INF/classes/") && name.endsWith(".class")) {
                    try (InputStream in = z.getInputStream(e)) {
                        visitClass(classes, "WEB-INF/classes", name, in.readAllBytes());
                    }
                } else if (name.startsWith("WEB-INF/lib/") && name.endsWith(".jar")) {
                    String jar = name.substring("WEB-INF/lib/".length());
                    try (InputStream in = z.getInputStream(e)) {
                        walkJar(jar, in.readAllBytes(), classes, jsps);
                    }
                } else if (jsps != null && JSP_FILE.matcher(name).matches()) {
                    try (InputStream in = z.getInputStream(e)) {
                        jsps.visit(name, name, new String(in.readAllBytes(), StandardCharsets.UTF_8));
                    }
                }
            }
        }
    }

    private void walkJar(String jar, byte[] bytes, ClassFileVisitor classes, TextFileVisitor jsps)
            throws IOException {
        try (ZipInputStream zin = new ZipInputStream(new ByteArrayInputStream(bytes))) {
            for (ZipEntry e = zin.getNextEntry(); e != null; e = zin.getNextEntry()) {
                String name = e.getName();
                if (name.endsWith(".class") && !name.startsWith("META-INF/versions/")) {
                    visitClass(classes, jar, name, zin.readAllBytes());
                } else if (jsps != null
                        && (name.startsWith("META-INF/resources/") || name.startsWith("META-INF/tags/"))
                        && JSP_FILE.matcher(name).matches()) {
                    String location = jar + "!/" + name;
                    jsps.visit(location, name, new String(zin.readAllBytes(), StandardCharsets.UTF_8));
                }
            }
        }
    }

    /** A text rule over JSPs and tag files. */
    static final class JspRule {
        final String id;
        final Pattern pattern;
        final String spec;
        final String springTagName; // when set, the match is a tag of the Spring tag library

        JspRule(String id, String regex, String spec, String springTagName) {
            this.id = id;
            this.pattern = Pattern.compile(regex, Pattern.DOTALL);
            this.spec = spec;
            this.springTagName = springTagName;
        }

        static List<JspRule> defaults() {
            List<JspRule> r = new ArrayList<>();
            r.add(new JspRule("jsp:plugin", "<jsp:(plugin|params|fallback)\\b", "Pages-4.0", null));
            r.add(new JspRule(
                    "isThreadSafe",
                    "(<%@\\s*page\\b[^%]*?|<jsp:directive\\.page\\b[^>]*?)\\bisThreadSafe\\s*=",
                    "Pages-4.0",
                    null));
            r.add(new JspRule(
                    "removed-member",
                    "\\bsession\\s*\\.\\s*(getValue|putValue|getValueNames|removeValue|getSessionContext)\\s*\\("
                            + "|\\brequest\\s*\\.\\s*(isRequestedSessionIdFromUrl|getRealPath)\\s*\\("
                            + "|\\bresponse\\s*\\.\\s*(encodeUrl|encodeRedirectUrl)\\s*\\("
                            + "|\\bresponse\\s*\\.\\s*setStatus\\s*\\([^,()]*,"
                            + "|\\bapplication\\s*\\.\\s*(getServlet|getServlets|getServletNames)\\s*\\("
                            + "|\\b(pageContext|jspContext)\\s*\\.\\s*(getExpressionEvaluator|getVariableResolver)\\s*\\(",
                    "Servlet-6.0/Pages-4.0",
                    null));
            r.add(new JspRule(
                    "removed-class",
                    "\\b(javax|jakarta)\\.servlet\\.jsp\\.el\\.(ExpressionEvaluator|VariableResolver|ELException"
                            + "|ELParseException|Expression|FunctionMapper)\\b"
                            + "|\\b(SingleThreadModel|HttpSessionContext|HttpUtils|EVAL_BODY_TAG)\\b",
                    "Servlet-6.0/Pages-4.0",
                    null));
            r.add(new JspRule("spring:eval", "(?!)", "Pages-4.0 (Spring EvalTag before Spring 5)", "eval"));
            return r;
        }

        /** {line, text} of every match. */
        List<String[]> find(String text) {
            List<String[]> found = new ArrayList<>();
            Pattern p = pattern;
            if (springTagName != null) {
                List<String> prefixes = springPrefixes(text);
                if (prefixes.isEmpty()) {
                    return found;
                }
                p = Pattern.compile("<(" + String.join("|", prefixes) + "):" + springTagName + "\\b");
            }
            Matcher m = p.matcher(text);
            while (m.find()) {
                int line = 1;
                for (int i = 0; i < m.start(); i++) {
                    if (text.charAt(i) == '\n') {
                        line++;
                    }
                }
                String what = m.group().replaceAll("\\s+", " ");
                if (what.length() > 60) {
                    what = what.substring(what.length() - 60);
                }
                found.add(new String[] {"line " + line, id + ": " + what.trim()});
            }
            return found;
        }

        private static List<String> springPrefixes(String text) {
            List<String> prefixes = new ArrayList<>();
            Matcher d = Pattern.compile("<%@\\s*taglib\\b([^%]*)%>").matcher(text);
            while (d.find()) {
                String attrs = d.group(1);
                Matcher uri = Pattern.compile("\\buri\\s*=\\s*[\"']([^\"']+)[\"']").matcher(attrs);
                Matcher prefix = Pattern.compile("\\bprefix\\s*=\\s*[\"']([\\w-]+)[\"']").matcher(attrs);
                if (uri.find()
                        && prefix.find()
                        && uri.group(1).equals("http://www.springframework.org/tags")) {
                    prefixes.add(Pattern.quote(prefix.group(1)));
                }
            }
            return prefixes;
        }
    }
}
