package org.apereo.portal.start.removedapi;

import static org.junit.jupiter.api.Assertions.assertEquals;
import static org.junit.jupiter.api.Assertions.assertNull;
import static org.junit.jupiter.api.Assertions.assertTrue;

import java.io.ByteArrayOutputStream;
import java.io.File;
import java.io.FileOutputStream;
import java.io.IOException;
import java.net.URISyntaxException;
import java.nio.charset.StandardCharsets;
import java.nio.file.Files;
import java.nio.file.Path;
import java.util.ArrayList;
import java.util.List;
import java.util.Map;
import java.util.TreeMap;
import java.util.stream.Collectors;
import java.util.zip.ZipEntry;
import java.util.zip.ZipOutputStream;
import org.junit.jupiter.api.Test;
import org.junit.jupiter.api.io.TempDir;
import org.objectweb.asm.ClassWriter;
import org.objectweb.asm.MethodVisitor;
import org.objectweb.asm.Opcodes;

/**
 * Seeded faults:  a WAR with known uses of removed APIs, in its classes, in a jar and in JSPs, must
 * produce exactly those hits;  the same WAR without them must produce none.
 */
class RemovedApiScannerTest {

    @TempDir Path dir;

    @Test
    void findsEverySeededUse() throws Exception {
        Map<String, byte[]> war = new TreeMap<>();
        war.put("WEB-INF/classes/seed/Clean.class", cleanClass());
        war.put("WEB-INF/classes/seed/UsesSession.class", sessionGetValue());
        war.put("WEB-INF/classes/seed/MyWrapper.class", wrapperCallingInheritedEncodeUrl());
        war.put("WEB-INF/lib/seeded-lib.jar", jar("seed/lib/Evaluator.class", jspElField()));
        war.put("WEB-INF/lib/boot-like.jar", jar("seed/lib/Embedded.class", tomcatInternal()));
        war.put("WEB-INF/jsp/applet.jsp", text("<%@ page isThreadSafe=\"false\" %>\n<jsp:plugin type=\"applet\" code=\"A\"/>"));
        war.put("WEB-INF/jsp/scriptlet.jsp", text("<% Object o = session.getValue(\"x\"); %>"));
        war.put(
                "WEB-INF/jsp/eval.jsp",
                text("<%@ taglib prefix=\"s\" uri=\"http://www.springframework.org/tags\" %>\n<s:eval expression=\"1\"/>"));
        war.put("WEB-INF/jsp/fine.jsp", text("<%@ taglib prefix=\"c\" uri=\"http://java.sun.com/jsp/jstl/core\" %>\n<c:set var=\"a\" value=\"1\"/>"));

        List<RemovedApiScanner.Hit> hits = scan(war);
        List<String> found = hits.stream()
                .map(h -> h.kind + " " + h.location + " " + h.source + " " + h.api)
                .sorted()
                .collect(Collectors.toList());

        assertEquals(
                List.of(
                        "class boot-like.jar seed/lib/Embedded org/apache/coyote/http11/AbstractHttp11JsseProtocol",
                        "class seeded-lib.jar seed/lib/Evaluator javax/servlet/jsp/el/VariableResolver",
                        "jsp WEB-INF/jsp/applet.jsp line 1 isThreadSafe: <%@ page isThreadSafe=",
                        "jsp WEB-INF/jsp/applet.jsp line 2 jsp:plugin: <jsp:plugin",
                        "jsp WEB-INF/jsp/eval.jsp line 2 spring:eval: <s:eval",
                        "jsp WEB-INF/jsp/scriptlet.jsp line 1 removed-member: session.getValue(",
                        "member WEB-INF/classes seed/MyWrapper javax/servlet/http/HttpServletResponseWrapper#encodeUrl(Ljava/lang/String;)Ljava/lang/String;",
                        "member WEB-INF/classes seed/UsesSession javax/servlet/http/HttpSession#getValue(Ljava/lang/String;)Ljava/lang/Object;"),
                found);
    }

    @Test
    void cleanWarHasNoHits() throws Exception {
        Map<String, byte[]> war = new TreeMap<>();
        war.put("WEB-INF/classes/seed/Clean.class", cleanClass());
        war.put("WEB-INF/jsp/fine.jsp", text("<% Object o = session.getAttribute(\"x\"); %>"));
        assertTrue(scan(war).isEmpty());
    }

    @Test
    void tomcatInternalShippedByTheWarIsNotAHit() throws Exception {
        Map<String, byte[]> war = new TreeMap<>();
        war.put("WEB-INF/lib/boot-like.jar", jar("seed/lib/Embedded.class", tomcatInternal()));
        war.put(
                "WEB-INF/lib/own-copy.jar",
                jar("org/apache/coyote/http11/AbstractHttp11JsseProtocol.class",
                        emptyClass("org/apache/coyote/http11/AbstractHttp11JsseProtocol", "java/lang/Object")));
        assertTrue(scan(war).isEmpty());
    }

    @Test
    void classPatchedIntoWebInfClassesShadowsTheJarCopy() throws Exception {
        Map<String, byte[]> war = new TreeMap<>();
        war.put("WEB-INF/lib/seeded-lib.jar", jar("seed/lib/Evaluator.class", jspElField()));
        war.put("WEB-INF/classes/seed/lib/Evaluator.class", emptyClass("seed/lib/Evaluator", "java/lang/Object"));
        assertTrue(scan(war).isEmpty());
    }

    @Test
    void allowlistAcceptsOnlyWhatItNamesAndNeedsAReason() throws Exception {
        Map<String, byte[]> war = new TreeMap<>();
        war.put("WEB-INF/lib/seeded-lib.jar", jar("seed/lib/Evaluator.class", jspElField()));
        war.put("WEB-INF/classes/seed/UsesSession.class", sessionGetValue());
        List<RemovedApiScanner.Hit> hits = scan(war);
        assertEquals(2, hits.size());

        File list = dir.resolve("allowlist.txt").toFile();
        Files.writeString(list.toPath(), "# comment\nmy-app | seeded-lib.jar | seed/lib/* | javax/servlet/jsp/el/* | seeded\n");
        RemovedApiAllowlist allowlist = RemovedApiAllowlist.read(list);
        int accepted = 0;
        for (RemovedApiScanner.Hit h : hits) {
            if (allowlist.accepting("my-app", h) != null) {
                accepted++;
            }
            assertNull(allowlist.accepting("other-app", h));
        }
        assertEquals(1, accepted);

        Files.writeString(list.toPath(), "my-app | * | * | * |   \n");
        try {
            RemovedApiAllowlist.read(list);
            throw new AssertionError("an entry without a reason was accepted");
        } catch (IOException expected) {
            // The reason for the refusal, not any IOException (a missing file is one too)
            assertTrue(
                    String.valueOf(expected.getMessage())
                            .endsWith(":1: expected 'webapp | location | source | api | reason' with a reason"),
                    expected.toString());
        }
    }

    // --- the seeded WAR ---

    private List<RemovedApiScanner.Hit> scan(Map<String, byte[]> entries) throws Exception {
        File war = dir.resolve("seeded-" + System.nanoTime() + ".war").toFile();
        try (ZipOutputStream out = new ZipOutputStream(new FileOutputStream(war))) {
            for (Map.Entry<String, byte[]> e : entries.entrySet()) {
                out.putNextEntry(new ZipEntry(e.getKey()));
                out.write(e.getValue());
                out.closeEntry();
            }
        }
        return new RemovedApiScanner(RemovedApiRules.load(), referenceApis()).scan(war);
    }

    /** The javax Servlet, JSP and EL API jars on the test classpath. */
    private static List<File> referenceApis() throws URISyntaxException {
        List<File> jars = new ArrayList<>();
        for (String c : new String[] {"javax.servlet.http.HttpSession", "javax.servlet.jsp.PageContext", "javax.el.ELContext"}) {
            try {
                jars.add(new File(Class.forName(c).getProtectionDomain().getCodeSource().getLocation().toURI()));
            } catch (ClassNotFoundException e) {
                throw new AssertionError(c + " is not on the test classpath", e);
            }
        }
        return jars;
    }

    private static byte[] text(String s) {
        return s.getBytes(StandardCharsets.UTF_8);
    }

    private static byte[] jar(String name, byte[] bytes) throws IOException {
        ByteArrayOutputStream buf = new ByteArrayOutputStream();
        try (ZipOutputStream out = new ZipOutputStream(buf)) {
            out.putNextEntry(new ZipEntry(name));
            out.write(bytes);
            out.closeEntry();
        }
        return buf.toByteArray();
    }

    private static ClassWriter begin(String name, String superName) {
        ClassWriter cw = new ClassWriter(ClassWriter.COMPUTE_FRAMES | ClassWriter.COMPUTE_MAXS);
        cw.visit(Opcodes.V11, Opcodes.ACC_PUBLIC, name, null, superName, null);
        return cw;
    }

    private static byte[] emptyClass(String name, String superName) {
        ClassWriter cw = begin(name, superName);
        cw.visitEnd();
        return cw.toByteArray();
    }

    /** Uses only APIs Tomcat 11 still has:  HttpSession.getAttribute. */
    private static byte[] cleanClass() {
        ClassWriter cw = begin("seed/Clean", "java/lang/Object");
        MethodVisitor mv = cw.visitMethod(Opcodes.ACC_PUBLIC | Opcodes.ACC_STATIC, "get",
                "(Ljavax/servlet/http/HttpSession;)Ljava/lang/Object;", null, null);
        mv.visitCode();
        mv.visitVarInsn(Opcodes.ALOAD, 0);
        mv.visitLdcInsn("x");
        mv.visitMethodInsn(Opcodes.INVOKEINTERFACE, "javax/servlet/http/HttpSession", "getAttribute",
                "(Ljava/lang/String;)Ljava/lang/Object;", true);
        mv.visitInsn(Opcodes.ARETURN);
        mv.visitMaxs(0, 0);
        mv.visitEnd();
        cw.visitEnd();
        return cw.toByteArray();
    }

    /** Calls HttpSession.getValue, removed in Servlet 6.0. */
    private static byte[] sessionGetValue() {
        ClassWriter cw = begin("seed/UsesSession", "java/lang/Object");
        MethodVisitor mv = cw.visitMethod(Opcodes.ACC_PUBLIC | Opcodes.ACC_STATIC, "get",
                "(Ljavax/servlet/http/HttpSession;)Ljava/lang/Object;", null, null);
        mv.visitCode();
        mv.visitVarInsn(Opcodes.ALOAD, 0);
        mv.visitLdcInsn("x");
        mv.visitMethodInsn(Opcodes.INVOKEINTERFACE, "javax/servlet/http/HttpSession", "getValue",
                "(Ljava/lang/String;)Ljava/lang/Object;", true);
        mv.visitInsn(Opcodes.ARETURN);
        mv.visitMaxs(0, 0);
        mv.visitEnd();
        cw.visitEnd();
        return cw.toByteArray();
    }

    /** A response wrapper that calls the inherited encodeUrl through its own type (super.encodeUrl). */
    private static byte[] wrapperCallingInheritedEncodeUrl() {
        ClassWriter cw = begin("seed/MyWrapper", "javax/servlet/http/HttpServletResponseWrapper");
        MethodVisitor mv = cw.visitMethod(Opcodes.ACC_PUBLIC, "link", "(Ljava/lang/String;)Ljava/lang/String;", null, null);
        mv.visitCode();
        mv.visitVarInsn(Opcodes.ALOAD, 0);
        mv.visitVarInsn(Opcodes.ALOAD, 1);
        mv.visitMethodInsn(Opcodes.INVOKEVIRTUAL, "seed/MyWrapper", "encodeUrl", "(Ljava/lang/String;)Ljava/lang/String;", false);
        mv.visitInsn(Opcodes.ARETURN);
        mv.visitMaxs(0, 0);
        mv.visitEnd();
        cw.visitEnd();
        return cw.toByteArray();
    }

    /** Only declares a field of a removed type (the class is never called). */
    private static byte[] jspElField() {
        ClassWriter cw = begin("seed/lib/Evaluator", "java/lang/Object");
        cw.visitField(Opcodes.ACC_PRIVATE, "resolver", "Ljavax/servlet/jsp/el/VariableResolver;", null, null).visitEnd();
        cw.visitEnd();
        return cw.toByteArray();
    }

    /** Refers to a Tomcat 9 internal class that Tomcat 11 removed, as Spring Boot 1.5 does. */
    private static byte[] tomcatInternal() {
        ClassWriter cw = begin("seed/lib/Embedded", "java/lang/Object");
        MethodVisitor mv = cw.visitMethod(Opcodes.ACC_PUBLIC | Opcodes.ACC_STATIC, "type", "()Ljava/lang/Class;", null, null);
        mv.visitCode();
        mv.visitLdcInsn(org.objectweb.asm.Type.getObjectType("org/apache/coyote/http11/AbstractHttp11JsseProtocol"));
        mv.visitInsn(Opcodes.ARETURN);
        mv.visitMaxs(0, 0);
        mv.visitEnd();
        cw.visitEnd();
        return cw.toByteArray();
    }
}
