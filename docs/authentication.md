# Choosing how users sign in

uPortal-start can run the portal in one of two authentication modes, chosen with the `authMode`
Gradle property:

| `authMode`        | Sign In goes to                          | Needs                                    |
| ----------------- | ---------------------------------------- | ---------------------------------------- |
| `local` (default) | uPortal's own login form (`/p/login`)    | nothing beyond the portal                |
| `cas`             | the CAS server at `casServerUrl`         | a CAS server: the bundled CAS 8 container, or yours |

Local login is the default for demos and development: a fresh checkout signs users in with no
setup. A production portal should sign users in through the institution's single sign-on, with
`authMode=cas` or its own SSO configuration. uPortal's own `security.properties` defaults are
unchanged.

Both modes keep the URL login that scripts and tests use,
`/uPortal/Login?userName=student&password=student`: uPortal checks the password in its own
database (`SimpleSecurityContextFactory`) either way.

uPortal-start used to deploy a CAS 3.6 server (`overlays/cas`) into the portal's Tomcat. That CAS
was end of life, ran on Spring 3.2 and the javax Servlet API, and could not move to Tomcat 10.1 or 11
with the rest of the portal. It is gone; CAS now runs as its own service, on a current version.

## Local login (the default)

Nothing to set up. `portalInit` (or `tomcatInstall`, which runs `tomcatConfig`) copies
`etc/portal/*.properties` into `portal.home`, and those defaults:

* turn off the CAS security context
  (`org.apereo.portal.security.provider.cas.CasAssertionSecurityContextFactory.enabled=false`);
* point the Sign In button at the login portlet
  (`org.apereo.portal.channels.CLogin.CasLoginUrl=${portal.context}/p/login`; the property
  keeps its historical name);
* send a guest who opens a page that needs a login to that form, with the page in a `refUrl`
  parameter, and open the page after signing in. A wrong password returns to the form, which says
  so (`login.refUrlEncoder=local`);
* send users back to the guest page when they sign out (`logout.redirect=`).

The quickstart users sign in with their user name as password: `admin`, `faculty`, `staff` and
`student`. Change or add local accounts with the portal's User Administration, or import `user`
entity files with `dataImport`.

## CAS with the bundled development server

`docker/cas` runs the official [Apereo CAS image](https://hub.docker.com/r/apereo/cas)
(`apereo/cas:8.0.2`, pinned by digest in `docker/cas/compose.yaml`) with Docker Compose:

* plain HTTP on port `casHttpPort` (8090), at `http://localhost:8090/cas`;
* the quickstart users from a static user store (`cas.authn.accept.users` in
  `docker/cas/config/cas.properties`), with the same passwords as in the portal database. A user
  added to the portal later is not known to this CAS: add them there too;
* one service definition (`docker/cas/services/uPortal-1001.json`) that lets any URL on
  `localhost` use CAS and ask for proxy tickets.

It needs Docker with Compose v2. The container shares the host's network, so that CAS can call the
portal's proxy-granting ticket callback on `localhost`; on Docker Desktop (macOS, Windows) turn on
host networking in its settings.

```console
    $ ./gradlew casStart                       # waits until CAS answers
    $ ./gradlew -PauthMode=cas portalInit       # or tomcatInstall / tomcatConfig on an existing portal
    $ ./gradlew tomcatStart
    ...
    $ ./gradlew casStop
```

Keep `authMode=cas` in `gradle.properties` rather than passing `-P` to every command: any later
`tomcatInstall` or `tomcatConfig` without it writes the local-login settings back.

With `authMode=cas`, `tomcatConfig` appends two files to the copies in `portal.home`:

* `etc/cas/global.properties`: `cas.protocol`, `cas.server` and `cas.context`, split from
  `casServerUrl`. uPortal builds `cas.protocol.server.context` from them, and portlets such as
  esup-filemanager read them too;
* `etc/cas/uPortal.properties`: turns on the CAS security context and the proxy-granting ticket
  callback at `/uPortal/CasProxyServlet`. Sign In goes to
  `<casServerUrl>/login?service=<portal>/Login`, and logout goes through
  `<casServerUrl>/logout?service=<portal>/`.

Later lines of a properties file win. These settings override the local-login defaults above
them.

### Proxy tickets

`overlays/uPortal/src/main/resources/properties/contextOverrides/overridesContext.xml` turns on
uPortal's `casTicketUserInfoService`, which uPortal itself leaves commented out. It gives portlets
that request the `casProxyTicket` user attribute a proxy ticket for their own URL. The *Portlet CAS
Test* portlet (`/uPortal/p/portlet-cas-test`, from `cas-proxy-test-portlet`) shows the result:
"Proxy ticket validated" in CAS mode; with local login, "No proxy ticket in UserInfo map", since
there is no CAS session to get one from. Each render of such a portlet costs a round trip to CAS.

## CAS with your own server

Adopters who already run CAS keep using it. Put `authMode=cas` and your `casServerUrl` in
`gradle.properties` and run `tomcatConfig` (`tomcatInstall` and `portalInit` include it):

```properties
authMode=cas
casServerUrl=https://cas.example.edu/cas
```

Do not run `casStart`. On the CAS side:

* register the portal as a CAS service matching `https://portal.example.edu/uPortal/Login`, the
  `service` the portal sends. With proxy tickets, the service must match the portlets' URLs too;
* for proxy tickets, allow proxying with a callback on `https://portal.example.edu/uPortal/CasProxyServlet`.
  CAS must be able to reach that URL, and production CAS servers call back only over HTTPS;
* for the logout redirect back to the portal, set `cas.logout.follow-service-redirects=true`.

If you used to customise the bundled CAS (`overlays/cas`), move those changes to your CAS server.
Its quirks no longer apply:

* `cas.ticketValidationFilter.encodeServiceUrl=false` was only for CAS 3.6, which could not handle
  encoded service URLs. Leave it at uPortal's default (`true`).
* The CAS data source in `deployerConfigContext.xml` (MOD-I85) is gone: the portal and its
  database no longer depend on a CAS that reads the portal's tables.
* CAS 3.6 accepted `logout?url=`. CAS 5 and later use `logout?service=` and follow it only with
  `cas.logout.follow-service-redirects=true`.

To change one of the CAS settings, edit `etc/cas/uPortal.properties` (or `etc/cas/global.properties`)
rather than `etc/portal/uPortal.properties`: the CAS block is appended after the latter, so it wins.

## Tests

The Playwright specs read `AUTH_MODE` (`local` unless it is `cas`) and `CAS_BASE_URL` (default
`http://localhost:8090/cas/`), and drive the login form of that mode:

```console
    $ npx playwright test --config=tests/uportal-pw.config.ts                     # local login
    $ AUTH_MODE=cas npx playwright test --config=tests/uportal-pw.config.ts \
          tests/ux/auth tests/ux/portlets/cas-proxy-test.spec.ts                   # against CAS
```

`playwrightRun` passes `authMode` on as `AUTH_MODE`. CI runs the whole suite with local login. The
Integration workflow also runs the auth and proxy ticket specs against the CAS container, then
stops CAS and requires the auth spec to fail.
