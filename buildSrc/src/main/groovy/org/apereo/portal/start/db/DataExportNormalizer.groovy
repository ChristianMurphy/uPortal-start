package org.apereo.portal.start.db

import java.nio.charset.StandardCharsets
import java.util.regex.Matcher
import java.util.regex.Pattern
import javax.xml.XMLConstants
import javax.xml.parsers.DocumentBuilder
import javax.xml.parsers.DocumentBuilderFactory
import org.w3c.dom.Attr
import org.w3c.dom.Document
import org.w3c.dom.Element
import org.w3c.dom.NamedNodeMap
import org.w3c.dom.Node

/**
 * Turns a `dataExport` directory into a canonical text form, one file per exported entity, so that
 * two exports of the same data compare equal line by line and a difference reads as a small diff
 * (see docs/migration-equivalence.md).
 *
 * Every file is parsed and printed again the same way: one element per line, indented, attributes
 * sorted, namespace declarations dropped and namespaces shown with fixed prefixes, whitespace
 * between elements dropped, and the text of an element kept exactly (tabs, line breaks and
 * backslashes are shown as \t, \n, \r and \\, so a value stays on one line). Comments are dropped.
 *
 * Children whose order the database does not keep are sorted (UNORDERED below; each entry says
 * why). Everything else keeps the order of the export, because uPortal stores it: layout nodes,
 * preference values and attribute values (index columns), lifecycle entries (by date).
 *
 * With maskVolatile, values that differ between two runs of the same import are replaced by a
 * marker (MASKS below; each entry says why). That form is the one compared with the recorded
 * reference. Without it, nothing is masked; that form compares two exports of one database, such
 * as 5.17 and the current build reading the same rows.
 *
 * With wholeSeconds, the fractional seconds of every xs:dateTime value are dropped: 5.17 stores
 * timestamps without fractions on MySQL and MariaDB (MOD-I95), so a copy into those servers cannot
 * keep them.
 */
class DataExportNormalizer {

    static final String MASK = '\u2039masked\u203a'

    /** Fixed prefixes for the namespaces uPortal's exports use; others print as {uri}. */
    static final Map<String, String> PREFIXES = [
        'https://source.jasig.org/schemas/uportal': 'up',
        'https://source.jasig.org/schemas/uportal/io': 'io',
        'http://www.w3.org/2001/XMLSchema-instance': 'xsi',
        'http://www.uportal.org/layout/dlm': 'dlm',
        'http://org.apereo.portal.layout.dlm.config': 'dlmc',
    ].asImmutable()

    /**
     * Children whose order carries no meaning, as "root element: path of the parent > child name"
     * (or "*" for every child element). They are sorted by their printed form.
     */
    static final Map<String, String> UNORDERED = [
        // UP_GROUP_MEMBERSHIP has no order; the export lists PAGS and local members as the
        // group stores return them
        'group: group/children > *': 'group membership is a set',
        // UP_PERMISSION rows; the export orders them by the target's group key, which is
        // generated (local.<n>) and compares differently under different collations
        'permission-set: permission-set > target': 'permission targets are UP_PERMISSION rows',
        // Category and group membership, and the users and groups of a permission, are sets
        'portlet-definition: portlet-definition > category': 'categories are group memberships',
        'portlet-definition: portlet-definition > group': 'SUBSCRIBE principals are UP_PERMISSION rows',
        'portlet-definition: portlet-definition > user': 'SUBSCRIBE principals are UP_PERMISSION rows',
        'portlet-definition: portlet-definition/permissions > permission': 'UP_PERMISSION rows',
        'portlet-definition: portlet-definition/permissions/permission > group': 'UP_PERMISSION rows',
        'portlet-definition: portlet-definition/permissions/permission > user': 'UP_PERMISSION rows',
        // PortletDefinitionImpl.parameters is a Map keyed by name, read in database order
        'portlet-definition: portlet-definition > parameter': 'parameters are a map keyed by name',
        // PAGS test groups (OR) and tests (AND) are JPA sets, and so are a group's members
        'pags-group: pags-group/selection-test > test-group': 'PAGS test groups are a set',
        'pags-group: pags-group/selection-test/test-group > test': 'PAGS tests are a set',
        'pags-group: pags-group/members > member-name': 'PAGS members are a set',
        // Activities are a JPA set of the owner
        'permission-owner: permission-owner > activity': 'activities are a set',
        // Structure attributes are UP_LAYOUT_PARAM rows, without an order column
        'layout: */folder > structure-attribute': 'structure attributes are UP_LAYOUT_PARAM rows',
        'layout: */folder > theme-attribute': 'theme attributes are UP_LAYOUT_PARAM rows',
        'layout: */channel > parameter': 'channel parameters are UP_LAYOUT_PARAM rows',
    ].asImmutable()

    /**
     * Values that differ between two imports of the same files, replaced by MASK when masking.
     * Key: root element and the path of the element whose text is masked, with a condition.
     */
    static final List<Map> MASKS = [
        [
            root: 'portlet-definition',
            path: 'portlet-definition/lifecycle/entry',
            when: { Element e -> e.getAttribute('user') == 'system' },
            // dataInit stamps a portlet definition that has no <lifecycle> with PUBLISHED by
            // "system" at the moment it is imported, so the value is the time the job ran.
            // Explicit entries (other users) are compared; same-database comparisons compare all.
            why: 'import time of definitions without a lifecycle',
        ],
    ].asImmutable()

    static final Pattern DATE_TIME =
            Pattern.compile(/^(\d{4}-\d\d-\d\dT\d\d:\d\d:\d\d)(\.\d+)?(Z|[+-]\d\d:\d\d)?$/)

    final boolean maskVolatile
    final boolean wholeSeconds
    private final DocumentBuilder builder

    DataExportNormalizer(boolean maskVolatile, boolean wholeSeconds) {
        this.maskVolatile = maskVolatile
        this.wholeSeconds = wholeSeconds
        DocumentBuilderFactory factory = DocumentBuilderFactory.newInstance()
        factory.namespaceAware = true
        factory.expandEntityReferences = false
        factory.setFeature(XMLConstants.FEATURE_SECURE_PROCESSING, true)
        factory.setFeature('http://apache.org/xml/features/disallow-doctype-decl', true)
        factory.setAttribute(XMLConstants.ACCESS_EXTERNAL_DTD, '')
        factory.setAttribute(XMLConstants.ACCESS_EXTERNAL_SCHEMA, '')
        builder = factory.newDocumentBuilder()
    }

    /**
     * Normalises every .xml file below exportDir into outDir under the same relative path.
     * Returns the number of files written; outDir is emptied first.
     */
    int normalizeDirectory(File exportDir, File outDir) {
        if (!exportDir.directory) {
            throw new IllegalArgumentException("Not a directory: ${exportDir}")
        }
        outDir.deleteDir()
        outDir.mkdirs()
        int count = 0
        exportDir.eachFileRecurse { File f ->
            if (!f.file || !f.name.endsWith('.xml')) {
                return
            }
            String relative = exportDir.toPath().relativize(f.toPath()).toString().replace('\\', '/')
            File out = new File(outDir, relative)
            out.parentFile.mkdirs()
            out.setText(normalize(f), 'UTF-8')
            count++
        }
        return count
    }

    String normalize(File xml) {
        Document document
        try {
            document = xml.withInputStream { builder.parse(it) }
        } catch (Exception e) {
            throw new IllegalStateException("Cannot parse ${xml}: ${e.message}", e)
        }
        Element root = document.documentElement
        StringBuilder out = new StringBuilder()
        print(root, root.localName ?: root.nodeName, '', 0, out)
        return out.toString()
    }

    private void print(Element element, String rootName, String parentPath, int depth, StringBuilder out) {
        String name = qualifiedName(element)
        String path = parentPath ? "${parentPath}/${name}" : name
        String indent = '  ' * depth
        out.append(indent).append('<').append(name)
        attributes(element).each { String attrName, String value ->
            out.append(' ').append(attrName).append('="').append(escape(value, true)).append('"')
        }
        List<Element> children = childElements(element)
        if (children.empty) {
            String text = element.textContent
            if (text == null || text.empty) {
                out.append('/>\n')
                return
            }
            out.append('>').append(escape(leafText(element, rootName, path, text), false))
            out.append('</').append(name).append('>\n')
            return
        }
        out.append('>\n')
        List<String> printed = children.collect { Element child ->
            StringBuilder sb = new StringBuilder()
            print(child, rootName, path, depth + 1, sb)
            sb.toString()
        }
        out.append(orderChildren(rootName, path, children, printed).join(''))
        out.append(indent).append('</').append(name).append('>\n')
    }

    /** Sorts the runs of children that UNORDERED names; other children keep their place. */
    private List<String> orderChildren(String rootName, String path, List<Element> children, List<String> printed) {
        List<String> result = new ArrayList<>(printed)
        int i = 0
        while (i < children.size()) {
            String childName = qualifiedName(children[i])
            int j = i
            while (j < children.size() && qualifiedName(children[j]) == childName) {
                j++
            }
            if (isUnordered(rootName, path, childName)) {
                if (isUnordered(rootName, path, '*')) {
                    j = children.size()
                }
                List<String> run = new ArrayList<>(result.subList(i, j))
                run.sort()
                for (int k = 0; k < run.size(); k++) {
                    result[i + k] = run[k]
                }
            }
            i = j
        }
        return result
    }

    private static boolean isUnordered(String rootName, String path, String childName) {
        UNORDERED.keySet().any { String key ->
            int colon = key.indexOf(': ')
            String root = key.substring(0, colon)
            String rest = key.substring(colon + 2)
            int gt = rest.indexOf(' > ')
            String parentPattern = rest.substring(0, gt)
            String child = rest.substring(gt + 3)
            root == rootName && (child == '*' || child == childName) && pathMatches(parentPattern, path)
        }
    }

    /** "a/b" matches exactly; "*" + "/b" matches any path ending in /b. */
    private static boolean pathMatches(String pattern, String path) {
        if (pattern.startsWith('*/')) {
            return path.endsWith(pattern.substring(1)) || path == pattern.substring(2)
        }
        return pattern == path
    }

    private String leafText(Element element, String rootName, String path, String text) {
        if (maskVolatile) {
            for (Map mask : MASKS) {
                if (mask.root == rootName && mask.path == path && ((Closure) mask.when).call(element)) {
                    return MASK
                }
            }
        }
        if (wholeSeconds) {
            Matcher m = DATE_TIME.matcher(text)
            if (m.matches()) {
                return m.group(1) + (m.group(3) ?: '')
            }
        }
        return text
    }

    private static List<Element> childElements(Element element) {
        List<Element> result = []
        for (Node n = element.firstChild; n != null; n = n.nextSibling) {
            if (n.nodeType == Node.ELEMENT_NODE) {
                result << (Element) n
            }
        }
        return result
    }

    private static SortedMap<String, String> attributes(Element element) {
        SortedMap<String, String> result = new TreeMap<>()
        NamedNodeMap attrs = element.attributes
        for (int i = 0; i < attrs.length; i++) {
            Attr a = (Attr) attrs.item(i)
            if (XMLConstants.XMLNS_ATTRIBUTE_NS_URI == a.namespaceURI || a.name == 'xmlns' || a.name.startsWith('xmlns:')) {
                continue
            }
            result[qualifiedName(a)] = a.value
        }
        return result
    }

    private static String qualifiedName(Node node) {
        String local = node.localName ?: node.nodeName
        String uri = node.namespaceURI
        if (uri == null || uri.empty) {
            return local
        }
        // An element in the default namespace of its document prints without a prefix when the
        // namespace is uPortal's own io/<type> namespace; that is what the root element uses
        if (uri.startsWith('https://source.jasig.org/schemas/uportal/io/')) {
            return local
        }
        String prefix = PREFIXES[uri]
        return prefix ? "${prefix}:${local}" : "{${uri}}${local}"
    }

    static String escape(String s, boolean attribute) {
        StringBuilder b = new StringBuilder(s.length() + 16)
        for (int i = 0; i < s.length(); i++) {
            char c = s.charAt(i)
            switch (c) {
                case '&': b.append('&amp;'); break
                case '<': b.append('&lt;'); break
                case '>': b.append('&gt;'); break
                case '"': b.append(attribute ? '&quot;' : '"'); break
                case '\\': b.append('\\\\'); break
                case '\n': b.append('\\n'); break
                case '\r': b.append('\\r'); break
                case '\t': b.append('\\t'); break
                default: b.append(c)
            }
        }
        return b.toString()
    }

    static String readUtf8(File f) {
        return new String(f.bytes, StandardCharsets.UTF_8)
    }
}
