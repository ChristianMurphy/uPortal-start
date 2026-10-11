/*
 * Every portlet definition in the quickstart data (data/base and
 * data/quickstart), with the portlet modes its descriptor declares for
 * text/html (WEB-INF/portlet.xml of its web application) and the groups
 * that may subscribe to it. portlet-modes.spec.ts renders each portlet in
 * each mode, maximised and in normal state.
 *
 * Generated from the bundled WARs of uPortal 5.17.9 and the portlet
 * versions in gradle.properties.example; portlet-modes.spec.ts checks that
 * the portal registers exactly these fnames, so a portlet added to the data
 * without a row here fails the spec. "config" appears where the portlet
 * itself declares the uPortal CONFIG mode (portlet administrators only).
 */

export interface BundledPortlet {
  fname: string;
  webapp: string;
  modes: ("view" | "edit" | "help" | "config" | "about")[];
  groups: string[];
}

export const BUNDLED_PORTLETS: BundledPortlet[] = [
  {
    fname: "about-college-life",
    webapp: "/NewsReaderPortlet",
    modes: ["edit", "help", "view"],
    groups: ["Everyone"],
  },
  {
    fname: "admin-dashboard",
    webapp: "/SimpleContentPortlet",
    modes: ["config", "view"],
    groups: ["Everyone"],
  },
  {
    fname: "admin-feature",
    webapp: "/uPortal",
    modes: ["view"],
    groups: ["Portal Administrators"],
  },
  {
    fname: "announcements",
    webapp: "/Announcements",
    modes: ["config", "edit", "view"],
    groups: ["Authenticated Users"],
  },
  {
    fname: "announcementsAdmin",
    webapp: "/Announcements",
    modes: ["help", "view"],
    groups: ["Portal Administrators"],
  },
  {
    fname: "attachments",
    webapp: "/SimpleContentPortlet",
    modes: ["view"],
    groups: ["Everyone"],
  },
  {
    fname: "AttributeSwapper",
    webapp: "/uPortal",
    modes: ["view"],
    groups: ["Portal Administrators"],
  },
  {
    fname: "background-preference",
    webapp: "/uPortal",
    modes: ["view"],
    groups: ["Authenticated Users"],
  },
  {
    fname: "basiclti-portlet",
    webapp: "/basiclti-portlet",
    modes: ["config", "edit", "view"],
    groups: ["Authenticated Users"],
  },
  {
    fname: "bookmarks",
    webapp: "/BookmarksPortlet",
    modes: ["edit", "view"],
    groups: ["Everyone"],
  },
  {
    fname: "cache-manager",
    webapp: "/uPortal",
    modes: ["view"],
    groups: ["Portal Administrators"],
  },
  {
    fname: "calendar",
    webapp: "/CalendarPortlet",
    modes: ["edit", "view"],
    groups: ["Everyone"],
  },
  {
    fname: "campus-news",
    webapp: "/NewsReaderPortlet",
    modes: ["edit", "help", "view"],
    groups: ["Everyone"],
  },
  {
    fname: "chronicle-wired",
    webapp: "/NewsReaderPortlet",
    modes: ["edit", "help", "view"],
    groups: ["Everyone"],
  },
  {
    fname: "courses",
    webapp: "/SimpleContentPortlet",
    modes: ["config", "view"],
    groups: ["Everyone"],
  },
  {
    fname: "daily-business-cartoon",
    webapp: "/uPortal",
    modes: ["view"],
    groups: ["Everyone"],
  },
  {
    fname: "demo-feature",
    webapp: "/uPortal",
    modes: ["view"],
    groups: ["Everyone"],
  },
  {
    fname: "directory",
    webapp: "/uPortal",
    modes: ["view"],
    groups: ["Authenticated Users"],
  },
  {
    fname: "dynamic-respondr-skin",
    webapp: "/uPortal",
    modes: ["config", "view"],
    groups: ["Everyone"],
  },
  {
    fname: "e-online",
    webapp: "/NewsReaderPortlet",
    modes: ["edit", "help", "view"],
    groups: ["Everyone"],
  },
  {
    fname: "emergency-alert",
    webapp: "/NotificationPortlet",
    modes: ["view"],
    groups: ["Everyone"],
  },
  {
    fname: "emergency-alert-admin",
    webapp: "/NotificationPortlet",
    modes: ["view"],
    groups: ["Portal Administrators"],
  },
  { fname: "error", webapp: "/uPortal", modes: ["view"], groups: ["Everyone"] },
  {
    fname: "esup-filemanager-demo",
    webapp: "/esup-filemanager",
    modes: ["about", "edit", "help", "view"],
    groups: ["Everyone"],
  },
  {
    fname: "faculty-feature",
    webapp: "/uPortal",
    modes: ["view"],
    groups: ["Everyone"],
  },
  {
    fname: "favorites",
    webapp: "/uPortal",
    // A Web Component channel since 8b44d0a37: uPortal's WebComponent
    // portlet, which declares VIEW only
    modes: ["view"],
    groups: ["Everyone"],
  },
  {
    fname: "favorites-carousel",
    webapp: "/SimpleContentPortlet",
    modes: ["config", "view"],
    groups: ["Everyone"],
  },
  {
    fname: "feedback",
    webapp: "/FeedbackPortlet",
    modes: ["view"],
    groups: ["Authenticated Users"],
  },
  {
    fname: "feedback-admin",
    webapp: "/FeedbackPortlet",
    modes: ["view"],
    groups: ["Portal Administrators"],
  },
  {
    fname: "feedback-navigation",
    webapp: "/SimpleContentPortlet",
    modes: ["config", "view"],
    groups: ["Authenticated Users"],
  },
  {
    fname: "forgot-password",
    webapp: "/uPortal",
    modes: ["view"],
    groups: ["Everyone"],
  },
  {
    fname: "fragment-admin",
    webapp: "/uPortal",
    modes: ["view"],
    groups: ["Portal Administrators", "Tenant Administrators"],
  },
  {
    fname: "fragment-admin-exit",
    webapp: "/uPortal",
    modes: ["view"],
    groups: ["Fragment Owners", "Tenant Fragment Owners"],
  },
  {
    fname: "fragment-audit",
    webapp: "/uPortal",
    modes: ["view"],
    groups: ["Portal Administrators"],
  },
  {
    fname: "google-analytics-config",
    webapp: "/uPortal",
    modes: ["config", "view"],
    groups: ["Everyone"],
  },
  {
    fname: "groupsmanager",
    webapp: "/uPortal",
    modes: ["view"],
    groups: ["Portal Administrators"],
  },
  {
    fname: "ImportExportPortlet",
    webapp: "/uPortal",
    modes: ["view"],
    groups: ["Portal Administrators"],
  },
  {
    fname: "instructions-for-new-tenants",
    webapp: "/SimpleContentPortlet",
    modes: ["config", "view"],
    groups: ["Tenant Administrators"],
  },
  {
    fname: "js-demo",
    webapp: "/SimpleContentPortlet",
    modes: ["config", "view"],
    groups: ["Everyone"],
  },
  {
    fname: "legal-footer",
    webapp: "/SimpleContentPortlet",
    modes: ["config", "view"],
    groups: ["Everyone"],
  },
  {
    fname: "logging-in",
    webapp: "/SimpleContentPortlet",
    modes: ["config", "view"],
    groups: ["Everyone"],
  },
  { fname: "login", webapp: "/uPortal", modes: ["view"], groups: ["Everyone"] },
  {
    fname: "login-launcher",
    webapp: "/uPortal",
    modes: ["view"],
    groups: ["Guests"],
  },
  {
    fname: "logout-launcher",
    webapp: "/uPortal",
    modes: ["view"],
    groups: ["Authenticated Users"],
  },
  {
    fname: "motley-fool",
    webapp: "/NewsReaderPortlet",
    modes: ["edit", "help", "view"],
    groups: ["Everyone"],
  },
  {
    fname: "movie-news",
    webapp: "/NewsReaderPortlet",
    modes: ["edit", "help", "view"],
    groups: ["Everyone"],
  },
  {
    fname: "notification-banner",
    webapp: "/SimpleContentPortlet",
    modes: ["config", "view"],
    groups: ["Authenticated Users"],
  },
  {
    fname: "notification-icon",
    webapp: "/SimpleContentPortlet",
    modes: ["config", "view"],
    groups: ["Authenticated Users"],
  },
  {
    fname: "notification-list",
    webapp: "/SimpleContentPortlet",
    modes: ["config", "view"],
    groups: ["Authenticated Users"],
  },
  {
    fname: "notification-modal",
    webapp: "/SimpleContentPortlet",
    modes: ["config", "view"],
    groups: ["Authenticated Users"],
  },
  {
    fname: "ny-times",
    webapp: "/NewsReaderPortlet",
    modes: ["edit", "help", "view"],
    groups: ["Everyone"],
  },
  {
    fname: "ny-times-education",
    webapp: "/NewsReaderPortlet",
    modes: ["edit", "help", "view"],
    groups: ["Everyone"],
  },
  {
    fname: "passwordmgr",
    webapp: "/uPortal",
    modes: ["view"],
    groups: ["Authenticated Users"],
  },
  {
    fname: "permissionsmanager",
    webapp: "/uPortal",
    modes: ["view"],
    groups: ["Portal Administrators"],
  },
  {
    fname: "personalization-gallery",
    webapp: "/uPortal",
    modes: ["view"],
    groups: ["Authenticated Users"],
  },
  {
    fname: "phd-comics",
    webapp: "/NewsReaderPortlet",
    modes: ["edit", "help", "view"],
    groups: ["Everyone"],
  },
  {
    fname: "please-register",
    webapp: "/SimpleContentPortlet",
    modes: ["config", "view"],
    groups: ["Everyone"],
  },
  {
    fname: "popular-portlets",
    webapp: "/uPortal",
    modes: ["view"],
    groups: ["Everyone"],
  },
  {
    fname: "portal-activity",
    webapp: "/uPortal",
    modes: ["view"],
    groups: ["Everyone"],
  },
  {
    fname: "portal-administration",
    webapp: "/uPortal",
    modes: ["view"],
    groups: ["Portal Administrators"],
  },
  {
    fname: "portal-greeting",
    webapp: "/uPortal",
    modes: ["view"],
    groups: ["Authenticated Users"],
  },
  {
    fname: "portal-logo",
    webapp: "/SimpleContentPortlet",
    modes: ["config", "view"],
    groups: ["Everyone"],
  },
  {
    fname: "portlet-admin",
    webapp: "/uPortal",
    modes: ["view"],
    groups: ["Portal Administrators", "Tenant Administrators"],
  },
  {
    fname: "portlet-cas-test",
    webapp: "/cas-proxy-test-portlet",
    modes: ["edit", "view"],
    groups: ["Everyone"],
  },
  {
    fname: "portletmarketplace",
    webapp: "/uPortal",
    modes: ["view"],
    groups: ["Everyone"],
  },
  {
    fname: "reset-my-layout",
    webapp: "/uPortal",
    // A Web Component channel since e3c7803: uPortal's WebComponent
    // portlet, which declares VIEW only
    modes: ["view"],
    groups: ["Authenticated Users"],
  },
  {
    fname: "salon",
    webapp: "/NewsReaderPortlet",
    modes: ["edit", "help", "view"],
    groups: ["Everyone"],
  },
  {
    fname: "search",
    webapp: "/uPortal",
    modes: ["view"],
    groups: ["Everyone"],
  },
  {
    fname: "search-launcher",
    webapp: "/uPortal",
    modes: ["view"],
    groups: ["Everyone"],
  },
  {
    fname: "session-timeout",
    webapp: "/uPortal",
    modes: ["view"],
    groups: ["Authenticated Users"],
  },
  {
    fname: "sitemap",
    webapp: "/uPortal",
    modes: ["view"],
    groups: ["Everyone"],
  },
  {
    fname: "snappy",
    webapp: "/SimpleContentPortlet",
    modes: ["config", "view"],
    groups: ["Everyone"],
  },
  {
    fname: "snooper",
    webapp: "/uPortal",
    modes: ["view"],
    groups: ["Portal Developers"],
  },
  {
    fname: "sports-illustrated",
    webapp: "/NewsReaderPortlet",
    modes: ["edit", "help", "view"],
    groups: ["Everyone"],
  },
  {
    fname: "staff-feature",
    webapp: "/uPortal",
    modes: ["view"],
    groups: ["Everyone"],
  },
  {
    fname: "statistics",
    webapp: "/uPortal",
    modes: ["view"],
    groups: ["Portal Administrators"],
  },
  {
    fname: "student-feature",
    webapp: "/uPortal",
    modes: ["view"],
    groups: ["Everyone"],
  },
  {
    fname: "tenant-manager",
    webapp: "/uPortal",
    modes: ["view"],
    groups: ["Portal Administrators"],
  },
  {
    fname: "tenant-portal-administration",
    webapp: "/uPortal",
    modes: ["view"],
    groups: ["Tenant Administrators"],
  },
  {
    fname: "test-portlet-1",
    webapp: "/pluto-testsuite",
    modes: ["edit", "help", "view"],
    groups: ["Everyone"],
  },
  {
    fname: "test-portlet-2",
    webapp: "/pluto-testsuite",
    modes: ["edit", "help", "view"],
    groups: ["Everyone"],
  },
  {
    fname: "toggle-resources-aggregation",
    webapp: "/uPortal",
    modes: ["view"],
    groups: ["Portal Administrators"],
  },
  {
    fname: "translator",
    webapp: "/uPortal",
    modes: ["view"],
    groups: ["Portal Developers", "Portal Administrators"],
  },
  {
    fname: "uportal-home-page",
    webapp: "/uPortal",
    modes: ["view"],
    groups: ["Everyone"],
  },
  {
    fname: "uportal-links",
    webapp: "/SimpleContentPortlet",
    modes: ["config", "view"],
    groups: ["Everyone"],
  },
  {
    fname: "user-administration",
    webapp: "/uPortal",
    modes: ["view"],
    groups: ["Portal Administrators"],
  },
  {
    fname: "user-locales-selector",
    webapp: "/uPortal",
    modes: ["view"],
    groups: ["Everyone"],
  },
  {
    fname: "waffle-menu",
    webapp: "/SimpleContentPortlet",
    modes: ["config", "view"],
    groups: ["Everyone"],
  },
  {
    fname: "web-proxy-example",
    webapp: "/WebProxyPortlet",
    modes: ["config", "edit", "view"],
    groups: ["Authenticated Users"],
  },
  {
    fname: "what-is-uportal",
    webapp: "/SimpleContentPortlet",
    modes: ["config", "view"],
    groups: ["Everyone"],
  },
  {
    fname: "whos-online",
    webapp: "/SimpleContentPortlet",
    modes: ["config", "view"],
    groups: ["Everyone"],
  },
  {
    fname: "word-of-the-day",
    webapp: "/NewsReaderPortlet",
    modes: ["edit", "help", "view"],
    groups: ["Everyone"],
  },
  {
    fname: "xkcd",
    webapp: "/NewsReaderPortlet",
    modes: ["edit", "help", "view"],
    groups: ["Everyone"],
  },
];
