/*
 * Portlet definitions for the JSR-286 portlets of Apache Pluto's test suite
 * (overlays/pluto-testsuite), which the quickstart data does not register.
 * pluto-testsuite.spec.ts imports them for the run and deletes them after.
 * Only Portal Developers may browse and subscribe to them.
 */

function definition(
  fname: string,
  title: string,
  portletName: string,
  description: string,
): string {
  return `<?xml version="1.0" encoding="UTF-8"?>
<portlet-definition xmlns="https://source.jasig.org/schemas/uportal/io/portlet-definition" xmlns:ns2="https://source.jasig.org/schemas/uportal" version="4.0">
    <title>${title}</title>
    <name>${title}</name>
    <fname>${fname}</fname>
    <desc>${description}</desc>
    <type>Portlet</type>
    <timeout>600000</timeout>
    <portlet-descriptor>
        <ns2:webAppName>/pluto-testsuite</ns2:webAppName>
        <ns2:portletName>${portletName}</ns2:portletName>
    </portlet-descriptor>
    <category>Testing</category>
    <group>Portal Developers</group>
    <permissions>
        <permission system="UP_PORTLET_SUBSCRIBE" activity="BROWSE">
            <group>Portal Developers</group>
        </permission>
    </permissions>
</portlet-definition>
`;
}

export const PLUTO_286_TEST_DEFINITION = definition(
  "pluto-286-test",
  "Pluto JSR-286 Test Portlet",
  "286TestPortlet",
  "JSR-286 tests from Apache Pluto (registered by the Playwright suite)",
);

export const PLUTO_286_COMPANION_DEFINITION = definition(
  "pluto-286-companion",
  "Pluto JSR-286 Test Companion",
  "286TestCompanionPortlet",
  "Companion of the JSR-286 test portlet (registered by the Playwright suite)",
);
