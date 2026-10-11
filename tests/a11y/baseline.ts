/*
 * Accessibility violations recorded on the 6.0 integration branch (5.17.10
 * behaviour), by page, axe rule and node
 * (see key-pages.a11y.ts). Recorded from Integration run 38100770775 (the
 * "a11y observed" annotations); keep it sorted.
 */
export const baseline: Record<string, Record<string, string[]>> = {
  "admin-groups": {
    "aria-allowed-attr": ["#portalNavigation", "#portlet_u#l#n#"],
    "aria-roles": [
      ".grp-mgr",
      '.portlet-titlebar.card-header[role="sectionhead"]',
    ],
    "button-name": ["#webSearchSubmit"],
    "link-in-text-block": [
      'a[href$="www.apereo.org"]',
      'a[title="Apache License, Version #.#"]',
      'a[title="Gnu/FSF-recognized"]',
      'a[title="OSI-certified"]',
      'a[title="uPortal"]',
      'div:nth-child(#) > a[href$="uportal"][target="_blank"]',
    ],
  },
  "admin-home": {
    "aria-allowed-attr": ["#portalNavigation", "#portlet_u#l#n#"],
    "button-name": ["#webSearchSubmit"],
    "link-in-text-block": [
      'a[href$="www.apereo.org"]',
      'a[title="Apache License, Version #.#"]',
      'a[title="Gnu/FSF-recognized"]',
      'a[title="OSI-certified"]',
      'a[title="uPortal"]',
      'div:nth-child(#) > a[href$="uportal"][target="_blank"]',
    ],
    "select-name": ["esco-content-grid >>> select"],
  },
  "admin-permissions": {
    "aria-allowed-attr": ["#portalNavigation", "#portlet_u#l#n#"],
    "aria-roles": [
      '.portlet-titlebar.card-header[role="sectionhead"]',
      ".prm-mgr",
    ],
    "button-name": ["#webSearchSubmit"],
    label: [
      'input[name="activityDisplayName"]',
      'input[name="principalDisplayName"]',
    ],
    "link-in-text-block": [
      'a[href$="www.apereo.org"]',
      'a[title="Apache License, Version #.#"]',
      'a[title="Gnu/FSF-recognized"]',
      'a[title="OSI-certified"]',
      'a[title="uPortal"]',
      'div:nth-child(#) > a[href$="uportal"][target="_blank"]',
    ],
  },
  "admin-portlet-manager": {
    "aria-allowed-attr": ["#portalNavigation", "#portlet_u#l#n#"],
    "aria-roles": [".card-header", "#Pluto_#_ctf#_#_portletBrowser"],
    "button-name": ["#webSearchSubmit"],
    "link-in-text-block": [
      'a[href$="www.apereo.org"]',
      'a[title="Apache License, Version #.#"]',
      'a[title="Gnu/FSF-recognized"]',
      'a[title="OSI-certified"]',
      'a[title="uPortal"]',
      'div:nth-child(#) > a[href$="uportal"][target="_blank"]',
    ],
    "select-name": [".column-filter-widget:nth-child(#) > select"],
  },
  "admin-users": {
    "aria-allowed-attr": ["#portalNavigation", "#portlet_u#l#n#"],
    "aria-roles": [".card-header", ".user-mgr"],
    "button-name": ["#webSearchSubmit"],
    "link-in-text-block": [
      'a[href$="www.apereo.org"]',
      'a[title="Apache License, Version #.#"]',
      'a[title="Gnu/FSF-recognized"]',
      'a[title="OSI-certified"]',
      'a[title="uPortal"]',
      'div:nth-child(#) > a[href$="uportal"][target="_blank"]',
    ],
  },
  "faculty-home": {
    "aria-allowed-attr": ["#portalNavigation", "#portlet_u#l#n#"],
    "button-name": ["#webSearchSubmit"],
    label: [".upcal-date-input", 'input[multiple="multiple"]'],
    "link-in-text-block": [
      'a[href$="www.apereo.org"]',
      'a[title="Apache License, Version #.#"]',
      'a[title="Gnu/FSF-recognized"]',
      'a[title="OSI-certified"]',
      'a[title="uPortal"]',
      'div:nth-child(#) > a[href$="uportal"][target="_blank"]',
    ],
  },
  "guest-welcome": {
    "aria-allowed-attr": ["#portalNavigation", "#portlet_u#l#n#"],
    "aria-roles": [".card"],
    "button-name": ["#webSearchSubmit"],
    "link-in-text-block": [
      '#portletContent_u#l#n# > .up-portlet-content-wrapper-inner > p:nth-child(#) > a[target="_blank"]',
      'a[href$="www.apereo.org"]',
      'a[title="Apache License, Version #.#"]',
      'a[title="Gnu/FSF-recognized"]',
      'a[title="OSI-certified"]',
      'a[title="uPortal"]',
      'div:nth-child(#) > a[href$="uportal"][target="_blank"]',
      'p:nth-child(#) > a[href$="apereo.org/"][target="_blank"]',
      'p:nth-child(#) > a[href$="uportal"][target="_blank"]',
      'p:nth-child(#) > a[target="_blank"]',
    ],
  },
  "staff-home": {
    "aria-allowed-attr": ["#portalNavigation", "#portlet_u#l#n#"],
    "button-name": ["#webSearchSubmit"],
    label: [".upcal-date-input", 'input[multiple="multiple"]'],
    "link-in-text-block": [
      'a[href$="www.apereo.org"]',
      'a[title="Apache License, Version #.#"]',
      'a[title="Gnu/FSF-recognized"]',
      'a[title="OSI-certified"]',
      'a[title="uPortal"]',
      'div:nth-child(#) > a[href$="uportal"][target="_blank"]',
    ],
  },
  "student-home": {
    "aria-allowed-attr": ["#portalNavigation", "#portlet_u#l#n#"],
    "button-name": ["#webSearchSubmit"],
    label: [".upcal-date-input", 'input[multiple="multiple"]'],
    "link-in-text-block": [
      'a[href$="www.apereo.org"]',
      'a[title="Apache License, Version #.#"]',
      'a[title="Gnu/FSF-recognized"]',
      'a[title="OSI-certified"]',
      'a[title="uPortal"]',
      'div:nth-child(#) > a[href$="uportal"][target="_blank"]',
    ],
  },
  "student-maximized-portlet": {
    "aria-allowed-attr": ["#portalNavigation", "#portlet_u#l#n#"],
    "button-name": ["#webSearchSubmit"],
    "link-in-text-block": [
      'a[href$="www.apereo.org"]',
      'a[title="Apache License, Version #.#"]',
      'a[title="Gnu/FSF-recognized"]',
      'a[title="OSI-certified"]',
      'a[title="uPortal"]',
      'div:nth-child(#) > a[href$="uportal"][target="_blank"]',
      'p:nth-child(#) > a[href$="apereo.org/"][target="_blank"]',
      'p:nth-child(#) > a[href$="uportal"][target="_blank"]',
    ],
  },
};
