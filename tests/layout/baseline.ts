import type { Baseline } from "./layout-checks";

/*
 * Layout problems the pages have today (MOD-D52), by "<visitor> <page>
 * <width>", check and node (see layout-checks.ts). The list only shrinks:
 * a fix removes its entries in the same commit. Keep it sorted.
 */
export const baseline: Baseline = {
  "admin groupsmanager 320": {
    scroll: [
      "#portalNavigation_u#l#s#.portal-navigation.movable.editable",
      "#up-sticky-nav a.menu-toggle.float-start",
    ],
    spill: [
      "#portalNavigationList",
      "#portlet_u#l#n#.up-portlet-wrapper.notification-icon notification-icon >>> #dropdownMenuButton",
      "#portlet_u#l#n#.up-portlet-wrapper.waffle-menu waffle-menu >>> button.waffle-trigger",
      "#up-sticky-nav div.portal-global.row",
    ],
    collapse: ["#portlet_u#l#n#.up-portlet-wrapper.feedback-navigation"],
  },
  "admin groupsmanager 390": {
    spill: [
      "#portalNavigationList",
      "#portlet_u#l#n#.up-portlet-wrapper.notification-icon notification-icon >>> #dropdownMenuButton",
      "#portlet_u#l#n#.up-portlet-wrapper.waffle-menu waffle-menu >>> button.waffle-trigger",
      "#up-sticky-nav div.portal-global.row",
    ],
    collapse: ["#portlet_u#l#n#.up-portlet-wrapper.feedback-navigation"],
  },
  "admin groupsmanager 768": {
    spill: ["#portalNavigationList"],
    collapse: ["#portlet_u#l#n#.up-portlet-wrapper.feedback-navigation"],
  },
  "admin groupsmanager 1024": {
    spill: ["#portalNavigationList"],
    collapse: ["#portlet_u#l#n#.up-portlet-wrapper.feedback-navigation"],
  },
  "admin groupsmanager 1366": {
    spill: ["#portalNavigationList"],
    collapse: ["#portlet_u#l#n#.up-portlet-wrapper.feedback-navigation"],
  },
  "admin groupsmanager 1920": {
    spill: ["#portalNavigationList"],
    collapse: ["#portlet_u#l#n#.up-portlet-wrapper.feedback-navigation"],
  },
  "admin permissionsmanager 320": {
    scroll: [
      "#portalNavigation_u#l#s#.portal-navigation.movable.editable",
      "#up-sticky-nav a.menu-toggle.float-start",
    ],
    spill: [
      "#portalNavigationList",
      "#portlet_u#l#n#.up-portlet-wrapper.notification-icon notification-icon >>> #dropdownMenuButton",
      "#portlet_u#l#n#.up-portlet-wrapper.waffle-menu waffle-menu >>> button.waffle-trigger",
      "#up-sticky-nav div.portal-global.row",
    ],
    collapse: ["#portlet_u#l#n#.up-portlet-wrapper.feedback-navigation"],
  },
  "admin permissionsmanager 390": {
    spill: [
      "#portalNavigationList",
      "#portletContent_ctf#.fl-widget-content.fl-fix.up-portlet-content-wrapper a",
      "#portlet_u#l#n#.up-portlet-wrapper.notification-icon notification-icon >>> #dropdownMenuButton",
      "#portlet_u#l#n#.up-portlet-wrapper.waffle-menu waffle-menu >>> button.waffle-trigger",
      "#up-sticky-nav div.portal-global.row",
    ],
    collapse: ["#portlet_u#l#n#.up-portlet-wrapper.feedback-navigation"],
  },
  "admin permissionsmanager 768": {
    spill: [
      "#portalNavigationList",
      "#portletContent_ctf#.fl-widget-content.fl-fix.up-portlet-content-wrapper a",
    ],
    collapse: ["#portlet_u#l#n#.up-portlet-wrapper.feedback-navigation"],
  },
  "admin permissionsmanager 1024": {
    spill: ["#portalNavigationList"],
    collapse: ["#portlet_u#l#n#.up-portlet-wrapper.feedback-navigation"],
  },
  "admin permissionsmanager 1366": {
    spill: ["#portalNavigationList"],
    collapse: ["#portlet_u#l#n#.up-portlet-wrapper.feedback-navigation"],
  },
  "admin permissionsmanager 1920": {
    spill: ["#portalNavigationList"],
    collapse: ["#portlet_u#l#n#.up-portlet-wrapper.feedback-navigation"],
  },
  "admin portlet-admin 320": {
    scroll: [
      "#Pluto_#_ctf#_#_portletsList_info.dt-info",
      "#portalNavigation_u#l#s#.portal-navigation.movable.editable",
      "#up-sticky-nav a.menu-toggle.float-start",
    ],
    "cut-off": [
      "#portletContent_ctf#.fl-widget-content.fl-fix.up-portlet-content-wrapper",
    ],
    spill: [
      "#Pluto_#_ctf#_#_pagingRow.dt-paging-row",
      "#portalNavigationList",
      "#portlet_u#l#n#.up-portlet-wrapper.notification-icon notification-icon >>> #dropdownMenuButton",
      "#portlet_u#l#n#.up-portlet-wrapper.waffle-menu waffle-menu >>> button.waffle-trigger",
      "#up-sticky-nav div.portal-global.row",
    ],
    collapse: ["#portlet_u#l#n#.up-portlet-wrapper.feedback-navigation"],
    spacing: [
      "#portletContent_ctf#.fl-widget-content.fl-fix.up-portlet-content-wrapper",
    ],
  },
  "admin portlet-admin 390": {
    "cut-off": [
      "#portletContent_ctf#.fl-widget-content.fl-fix.up-portlet-content-wrapper",
    ],
    spill: [
      "#Pluto_#_ctf#_#_pagingRow.dt-paging-row",
      "#Pluto_#_ctf#_#_portletsList_wrapper.dt-container.dt-bootstrap#.dt-empty-footer",
      "#Pluto_#_ctf#_#_portletsList_wrapper.dt-container.dt-bootstrap#.dt-empty-footer div.d-md-flex.justify-content-between.align-items-center",
      "#portalNavigationList",
      "#portlet_u#l#n#.up-portlet-wrapper.notification-icon notification-icon >>> #dropdownMenuButton",
      "#portlet_u#l#n#.up-portlet-wrapper.waffle-menu waffle-menu >>> button.waffle-trigger",
      "#up-sticky-nav div.portal-global.row",
    ],
    collapse: ["#portlet_u#l#n#.up-portlet-wrapper.feedback-navigation"],
    spacing: [
      "#portletContent_ctf#.fl-widget-content.fl-fix.up-portlet-content-wrapper",
    ],
  },
  "admin portlet-admin 768": {
    spill: [
      "#Pluto_#_ctf#_#_portletsList_wrapper.dt-container.dt-bootstrap#.dt-empty-footer",
      "#portalNavigationList",
    ],
    collapse: ["#portlet_u#l#n#.up-portlet-wrapper.feedback-navigation"],
  },
  "admin portlet-admin 1024": {
    spill: [
      "#Pluto_#_ctf#_#_portletsList_wrapper.dt-container.dt-bootstrap#.dt-empty-footer",
      "#portalNavigationList",
    ],
    collapse: ["#portlet_u#l#n#.up-portlet-wrapper.feedback-navigation"],
  },
  "admin portlet-admin 1366": {
    spill: [
      "#Pluto_#_ctf#_#_portletsList_wrapper.dt-container.dt-bootstrap#.dt-empty-footer",
      "#portalNavigationList",
    ],
    collapse: ["#portlet_u#l#n#.up-portlet-wrapper.feedback-navigation"],
  },
  "admin portlet-admin 1920": {
    spill: [
      "#Pluto_#_ctf#_#_portletsList_wrapper.dt-container.dt-bootstrap#.dt-empty-footer",
      "#portalNavigationList",
    ],
    collapse: ["#portlet_u#l#n#.up-portlet-wrapper.feedback-navigation"],
  },
  "admin tab admin-tools 320": {
    "cut-off": [
      "#portletContent_u#l#n#.up-portlet-content-wrapper esco-content-grid >>> div.portlet-card-title",
    ],
    spill: [
      "#portalNavigationList",
      "#portletContent_u#l#n#.up-portlet-content-wrapper esco-content-grid >>> div.filter.custom-caret.closed",
      "#portlet_u#l#n#.up-portlet-wrapper.notification-icon notification-icon >>> #dropdownMenuButton",
      "#portlet_u#l#n#.up-portlet-wrapper.waffle-menu waffle-menu >>> button.waffle-trigger",
      "#up-sticky-nav div.portal-global.row",
    ],
    collapse: ["#portlet_u#l#n#.up-portlet-wrapper.feedback-navigation"],
    spacing: [
      "#portletContent_u#l#n#.up-portlet-content-wrapper esco-content-grid >>> div.portlet-card-title",
    ],
  },
  "admin tab admin-tools 390": {
    "cut-off": [
      "#portletContent_u#l#n#.up-portlet-content-wrapper esco-content-grid >>> div.portlet-card-title",
    ],
    spill: [
      "#portalNavigationList",
      "#portletContent_u#l#n#.up-portlet-content-wrapper esco-content-grid >>> div.filter.custom-caret.closed",
      "#portlet_u#l#n#.up-portlet-wrapper.notification-icon notification-icon >>> #dropdownMenuButton",
      "#portlet_u#l#n#.up-portlet-wrapper.waffle-menu waffle-menu >>> button.waffle-trigger",
      "#up-sticky-nav div.portal-global.row",
    ],
    collapse: ["#portlet_u#l#n#.up-portlet-wrapper.feedback-navigation"],
    spacing: [
      "#portletContent_u#l#n#.up-portlet-content-wrapper esco-content-grid >>> div.portlet-card-title",
    ],
  },
  "admin tab admin-tools 768": {
    "cut-off": [
      "#portletContent_u#l#n#.up-portlet-content-wrapper esco-content-grid >>> div.portlet-card-title",
    ],
    spill: [
      "#portalNavigationList",
      "#portalNavigation_u#l#s#.portal-navigation.movable.editable a.nav-tab-controls.portal-navigation-delete",
      "#portletContent_u#l#n#.up-portlet-content-wrapper esco-content-grid >>> div.filter.custom-caret.closed",
      "#tabLink_u#l#s#.portal-navigation-link",
      "#tabLink_u#l#s#.portal-navigation-link.flc-inlineEditable",
    ],
    collapse: ["#portlet_u#l#n#.up-portlet-wrapper.feedback-navigation"],
    spacing: [
      "#portletContent_u#l#n#.up-portlet-content-wrapper esco-content-grid >>> div.portlet-card-title",
    ],
  },
  "admin tab admin-tools 1024": {
    spill: [
      "#portalNavigationList",
      "#portalNavigation_u#l#s#.portal-navigation.movable.editable a.nav-tab-controls.portal-navigation-delete",
      "#tabLink_u#l#s#.portal-navigation-link",
      "#tabLink_u#l#s#.portal-navigation-link.flc-inlineEditable",
    ],
    collapse: ["#portlet_u#l#n#.up-portlet-wrapper.feedback-navigation"],
    spacing: [
      "#portletContent_u#l#n#.up-portlet-content-wrapper esco-content-grid >>> div.portlet-card-title",
    ],
  },
  "admin tab admin-tools 1366": {
    spill: [
      "#portalNavigationList",
      "#portalNavigation_u#l#s#.portal-navigation.movable.editable a.nav-tab-controls.portal-navigation-delete",
      "#tabLink_u#l#s#.portal-navigation-link",
      "#tabLink_u#l#s#.portal-navigation-link.flc-inlineEditable",
    ],
    collapse: ["#portlet_u#l#n#.up-portlet-wrapper.feedback-navigation"],
    spacing: [
      "#portletContent_u#l#n#.up-portlet-content-wrapper esco-content-grid >>> div.portlet-card-title",
    ],
  },
  "admin tab admin-tools 1920": {
    spill: [
      "#portalNavigationList",
      "#portalNavigation_u#l#s#.portal-navigation.movable.editable a.nav-tab-controls.portal-navigation-delete",
      "#tabLink_u#l#s#.portal-navigation-link",
      "#tabLink_u#l#s#.portal-navigation-link.flc-inlineEditable",
    ],
    collapse: ["#portlet_u#l#n#.up-portlet-wrapper.feedback-navigation"],
    spacing: [
      "#portletContent_u#l#n#.up-portlet-content-wrapper esco-content-grid >>> div.portlet-card-title",
    ],
  },
  "admin tab development 320": {
    "cut-off": [
      "#portletContent_u#l#n#.fl-widget-content.fl-fix.up-portlet-content-wrapper",
    ],
    spill: [
      "#portalNavigationList",
      "#portletContent_u#l#n#.fl-widget-content.fl-fix.up-portlet-content-wrapper div.content",
      "#portlet_u#l#n#.up-portlet-wrapper.notification-icon notification-icon >>> #dropdownMenuButton",
      "#portlet_u#l#n#.up-portlet-wrapper.waffle-menu waffle-menu >>> button.waffle-trigger",
      "#up-sticky-nav div.portal-global.row",
    ],
    collapse: ["#portlet_u#l#n#.up-portlet-wrapper.feedback-navigation"],
    spacing: [
      "#portletContent_u#l#n#.fl-widget-content.fl-fix.up-portlet-content-wrapper",
    ],
  },
  "admin tab development 390": {
    "cut-off": [
      "#portletContent_u#l#n#.fl-widget-content.fl-fix.up-portlet-content-wrapper",
    ],
    spill: [
      "#portalNavigationList",
      "#portletContent_u#l#n#.fl-widget-content.fl-fix.up-portlet-content-wrapper div.content",
      "#portlet_u#l#n#.up-portlet-wrapper.notification-icon notification-icon >>> #dropdownMenuButton",
      "#portlet_u#l#n#.up-portlet-wrapper.waffle-menu waffle-menu >>> button.waffle-trigger",
      "#up-sticky-nav div.portal-global.row",
    ],
    collapse: ["#portlet_u#l#n#.up-portlet-wrapper.feedback-navigation"],
    spacing: [
      "#portletContent_u#l#n#.fl-widget-content.fl-fix.up-portlet-content-wrapper",
    ],
  },
  "admin tab development 768": {
    "cut-off": [
      "#portletContent_u#l#n#.fl-widget-content.fl-fix.up-portlet-content-wrapper",
    ],
    spill: [
      "#portalNavigationList",
      "#portalNavigation_u#l#s#.portal-navigation.movable.editable a.nav-tab-controls.portal-navigation-delete",
      "#portletContent_u#l#n#.fl-widget-content.fl-fix.up-portlet-content-wrapper div.content",
      "#tabLink_u#l#s#.portal-navigation-link",
      "#tabLink_u#l#s#.portal-navigation-link.flc-inlineEditable",
    ],
    collapse: ["#portlet_u#l#n#.up-portlet-wrapper.feedback-navigation"],
    spacing: [
      "#portletContent_u#l#n#.fl-widget-content.fl-fix.up-portlet-content-wrapper",
    ],
  },
  "admin tab development 1024": {
    "cut-off": [
      "#portletContent_u#l#n#.fl-widget-content.fl-fix.up-portlet-content-wrapper",
    ],
    spill: [
      "#portalNavigationList",
      "#portalNavigation_u#l#s#.portal-navigation.movable.editable a.nav-tab-controls.portal-navigation-delete",
      "#portletContent_u#l#n#.fl-widget-content.fl-fix.up-portlet-content-wrapper div.content",
      "#tabLink_u#l#s#.portal-navigation-link",
      "#tabLink_u#l#s#.portal-navigation-link.flc-inlineEditable",
    ],
    collapse: ["#portlet_u#l#n#.up-portlet-wrapper.feedback-navigation"],
    spacing: [
      "#portletContent_u#l#n#.fl-widget-content.fl-fix.up-portlet-content-wrapper",
    ],
  },
  "admin tab development 1366": {
    "cut-off": [
      "#portletContent_u#l#n#.fl-widget-content.fl-fix.up-portlet-content-wrapper",
    ],
    spill: [
      "#portalNavigationList",
      "#portalNavigation_u#l#s#.portal-navigation.movable.editable a.nav-tab-controls.portal-navigation-delete",
      "#tabLink_u#l#s#.portal-navigation-link",
      "#tabLink_u#l#s#.portal-navigation-link.flc-inlineEditable",
    ],
    collapse: ["#portlet_u#l#n#.up-portlet-wrapper.feedback-navigation"],
    spacing: [
      "#portletContent_u#l#n#.fl-widget-content.fl-fix.up-portlet-content-wrapper",
    ],
  },
  "admin tab development 1920": {
    "cut-off": [
      "#portletContent_u#l#n#.fl-widget-content.fl-fix.up-portlet-content-wrapper",
    ],
    spill: [
      "#portalNavigationList",
      "#portalNavigation_u#l#s#.portal-navigation.movable.editable a.nav-tab-controls.portal-navigation-delete",
      "#tabLink_u#l#s#.portal-navigation-link",
      "#tabLink_u#l#s#.portal-navigation-link.flc-inlineEditable",
    ],
    collapse: ["#portlet_u#l#n#.up-portlet-wrapper.feedback-navigation"],
    spacing: [
      "#portletContent_u#l#n#.fl-widget-content.fl-fix.up-portlet-content-wrapper",
    ],
  },
  "admin tab testing 320": {
    spill: [
      "#portalNavigationList",
      "#portlet_u#l#n#.up-portlet-wrapper.notification-icon notification-icon >>> #dropdownMenuButton",
      "#portlet_u#l#n#.up-portlet-wrapper.waffle-menu waffle-menu >>> button.waffle-trigger",
      "#up-sticky-nav div.portal-global.row",
    ],
    collapse: ["#portlet_u#l#n#.up-portlet-wrapper.feedback-navigation"],
  },
  "admin tab testing 390": {
    spill: [
      "#portalNavigationList",
      "#portlet_u#l#n#.up-portlet-wrapper.notification-icon notification-icon >>> #dropdownMenuButton",
      "#portlet_u#l#n#.up-portlet-wrapper.waffle-menu waffle-menu >>> button.waffle-trigger",
      "#up-sticky-nav div.portal-global.row",
    ],
    collapse: ["#portlet_u#l#n#.up-portlet-wrapper.feedback-navigation"],
  },
  "admin tab testing 768": {
    spill: [
      "#portalNavigationList",
      "#tabLink_u#l#s#.portal-navigation-link",
      "#tabLink_u#l#s#.portal-navigation-link.flc-inlineEditable",
    ],
    collapse: ["#portlet_u#l#n#.up-portlet-wrapper.feedback-navigation"],
  },
  "admin tab testing 1024": {
    spill: [
      "#portalNavigationList",
      "#tabLink_u#l#s#.portal-navigation-link",
      "#tabLink_u#l#s#.portal-navigation-link.flc-inlineEditable",
    ],
    collapse: ["#portlet_u#l#n#.up-portlet-wrapper.feedback-navigation"],
  },
  "admin tab testing 1366": {
    spill: [
      "#portalNavigationList",
      "#tabLink_u#l#s#.portal-navigation-link",
      "#tabLink_u#l#s#.portal-navigation-link.flc-inlineEditable",
    ],
    collapse: ["#portlet_u#l#n#.up-portlet-wrapper.feedback-navigation"],
  },
  "admin tab testing 1920": {
    spill: [
      "#portalNavigationList",
      "#tabLink_u#l#s#.portal-navigation-link",
      "#tabLink_u#l#s#.portal-navigation-link.flc-inlineEditable",
    ],
    collapse: ["#portlet_u#l#n#.up-portlet-wrapper.feedback-navigation"],
  },
  "admin user-administration 320": {
    scroll: [
      "#portalNavigation_u#l#s#.portal-navigation.movable.editable",
      "#up-sticky-nav a.menu-toggle.float-start",
    ],
    spill: [
      "#portalNavigationList",
      "#portlet_u#l#n#.up-portlet-wrapper.notification-icon notification-icon >>> #dropdownMenuButton",
      "#portlet_u#l#n#.up-portlet-wrapper.waffle-menu waffle-menu >>> button.waffle-trigger",
      "#up-sticky-nav div.portal-global.row",
    ],
    collapse: ["#portlet_u#l#n#.up-portlet-wrapper.feedback-navigation"],
  },
  "admin user-administration 390": {
    spill: [
      "#portalNavigationList",
      "#portlet_u#l#n#.up-portlet-wrapper.notification-icon notification-icon >>> #dropdownMenuButton",
      "#portlet_u#l#n#.up-portlet-wrapper.waffle-menu waffle-menu >>> button.waffle-trigger",
      "#up-sticky-nav div.portal-global.row",
    ],
    collapse: ["#portlet_u#l#n#.up-portlet-wrapper.feedback-navigation"],
  },
  "admin user-administration 768": {
    spill: ["#portalNavigationList"],
    collapse: ["#portlet_u#l#n#.up-portlet-wrapper.feedback-navigation"],
  },
  "admin user-administration 1024": {
    spill: ["#portalNavigationList"],
    collapse: ["#portlet_u#l#n#.up-portlet-wrapper.feedback-navigation"],
  },
  "admin user-administration 1366": {
    spill: ["#portalNavigationList"],
    collapse: ["#portlet_u#l#n#.up-portlet-wrapper.feedback-navigation"],
  },
  "admin user-administration 1920": {
    spill: ["#portalNavigationList"],
    collapse: ["#portlet_u#l#n#.up-portlet-wrapper.feedback-navigation"],
  },
  "faculty tab academics 320": {
    scroll: [
      "#portalNavigation_u#l#s#.portal-navigation.movable.editable",
      "#up-sticky-nav a.menu-toggle.float-start",
    ],
    spill: [
      "#portalNavigationList",
      "#portlet_u#l#n#.up-portlet-wrapper.notification-icon notification-icon >>> #dropdownMenuButton",
      "#portlet_u#l#n#.up-portlet-wrapper.waffle-menu waffle-menu >>> button.waffle-trigger",
      "#up-sticky-nav div.portal-global.row",
    ],
    collapse: ["#portlet_u#l#n#.up-portlet-wrapper.feedback-navigation"],
  },
  "faculty tab academics 390": {
    spill: [
      "#portalNavigationList",
      "#portlet_u#l#n#.up-portlet-wrapper.notification-icon notification-icon >>> #dropdownMenuButton",
      "#portlet_u#l#n#.up-portlet-wrapper.waffle-menu waffle-menu >>> button.waffle-trigger",
      "#up-sticky-nav div.portal-global.row",
    ],
    collapse: ["#portlet_u#l#n#.up-portlet-wrapper.feedback-navigation"],
  },
  "faculty tab academics 768": {
    spill: [
      "#portalNavigationList",
      "#portalNavigation_u#l#s#.portal-navigation.movable.editable a.nav-tab-controls.portal-navigation-delete",
      "#tabLink_u#l#s#.portal-navigation-link",
      "#tabLink_u#l#s#.portal-navigation-link.flc-inlineEditable",
    ],
    collapse: ["#portlet_u#l#n#.up-portlet-wrapper.feedback-navigation"],
  },
  "faculty tab academics 1024": {
    spill: [
      "#portalNavigationList",
      "#portalNavigation_u#l#s#.portal-navigation.movable.editable a.nav-tab-controls.portal-navigation-delete",
      "#tabLink_u#l#s#.portal-navigation-link",
      "#tabLink_u#l#s#.portal-navigation-link.flc-inlineEditable",
    ],
    collapse: ["#portlet_u#l#n#.up-portlet-wrapper.feedback-navigation"],
  },
  "faculty tab academics 1366": {
    spill: [
      "#portalNavigationList",
      "#portalNavigation_u#l#s#.portal-navigation.movable.editable a.nav-tab-controls.portal-navigation-delete",
      "#tabLink_u#l#s#.portal-navigation-link",
      "#tabLink_u#l#s#.portal-navigation-link.flc-inlineEditable",
    ],
    collapse: ["#portlet_u#l#n#.up-portlet-wrapper.feedback-navigation"],
  },
  "faculty tab academics 1920": {
    spill: [
      "#portalNavigationList",
      "#portalNavigation_u#l#s#.portal-navigation.movable.editable a.nav-tab-controls.portal-navigation-delete",
      "#tabLink_u#l#s#.portal-navigation-link",
      "#tabLink_u#l#s#.portal-navigation-link.flc-inlineEditable",
    ],
    collapse: ["#portlet_u#l#n#.up-portlet-wrapper.feedback-navigation"],
  },
  "faculty tab campus 320": {
    scroll: [
      "#portalNavigation_u#l#s#.portal-navigation.movable.editable",
      "#up-sticky-nav a.menu-toggle.float-start",
    ],
    spill: [
      "#portalNavigationList",
      "#portlet_u#l#n#.up-portlet-wrapper.notification-icon notification-icon >>> #dropdownMenuButton",
      "#portlet_u#l#n#.up-portlet-wrapper.waffle-menu waffle-menu >>> button.waffle-trigger",
      "#up-sticky-nav div.portal-global.row",
    ],
    collapse: ["#portlet_u#l#n#.up-portlet-wrapper.feedback-navigation"],
  },
  "faculty tab campus 390": {
    spill: [
      "#portalNavigationList",
      "#portlet_u#l#n#.up-portlet-wrapper.notification-icon notification-icon >>> #dropdownMenuButton",
      "#portlet_u#l#n#.up-portlet-wrapper.waffle-menu waffle-menu >>> button.waffle-trigger",
      "#up-sticky-nav div.portal-global.row",
    ],
    collapse: ["#portlet_u#l#n#.up-portlet-wrapper.feedback-navigation"],
  },
  "faculty tab campus 768": {
    spill: [
      "#portalNavigationList",
      "#tabLink_u#l#s#.portal-navigation-link",
      "#tabLink_u#l#s#.portal-navigation-link.flc-inlineEditable",
    ],
    collapse: ["#portlet_u#l#n#.up-portlet-wrapper.feedback-navigation"],
  },
  "faculty tab campus 1024": {
    spill: [
      "#portalNavigationList",
      "#tabLink_u#l#s#.portal-navigation-link",
      "#tabLink_u#l#s#.portal-navigation-link.flc-inlineEditable",
    ],
    collapse: ["#portlet_u#l#n#.up-portlet-wrapper.feedback-navigation"],
  },
  "faculty tab campus 1366": {
    spill: [
      "#portalNavigationList",
      "#tabLink_u#l#s#.portal-navigation-link",
      "#tabLink_u#l#s#.portal-navigation-link.flc-inlineEditable",
    ],
    collapse: ["#portlet_u#l#n#.up-portlet-wrapper.feedback-navigation"],
  },
  "faculty tab campus 1920": {
    spill: [
      "#portalNavigationList",
      "#tabLink_u#l#s#.portal-navigation-link",
      "#tabLink_u#l#s#.portal-navigation-link.flc-inlineEditable",
    ],
    collapse: ["#portlet_u#l#n#.up-portlet-wrapper.feedback-navigation"],
  },
  "faculty tab lms 320": {
    scroll: [
      "#portalNavigation_u#l#s#.portal-navigation.movable.editable",
      "#up-sticky-nav a.menu-toggle.float-start",
    ],
    spill: [
      "#portalNavigationList",
      "#portlet_u#l#n#.up-portlet-wrapper.notification-icon notification-icon >>> #dropdownMenuButton",
      "#portlet_u#l#n#.up-portlet-wrapper.waffle-menu waffle-menu >>> button.waffle-trigger",
      "#up-sticky-nav div.portal-global.row",
    ],
    collapse: ["#portlet_u#l#n#.up-portlet-wrapper.feedback-navigation"],
  },
  "faculty tab lms 390": {
    spill: [
      "#portalNavigationList",
      "#portlet_u#l#n#.up-portlet-wrapper.notification-icon notification-icon >>> #dropdownMenuButton",
      "#portlet_u#l#n#.up-portlet-wrapper.waffle-menu waffle-menu >>> button.waffle-trigger",
      "#up-sticky-nav div.portal-global.row",
    ],
    collapse: ["#portlet_u#l#n#.up-portlet-wrapper.feedback-navigation"],
  },
  "faculty tab lms 768": {
    spill: [
      "#portalNavigationList",
      "#portalNavigation_u#l#s#.portal-navigation.movable.editable a.nav-tab-controls.portal-navigation-delete",
      "#tabLink_u#l#s#.portal-navigation-link",
      "#tabLink_u#l#s#.portal-navigation-link.flc-inlineEditable",
    ],
    collapse: ["#portlet_u#l#n#.up-portlet-wrapper.feedback-navigation"],
  },
  "faculty tab lms 1024": {
    spill: [
      "#portalNavigationList",
      "#portalNavigation_u#l#s#.portal-navigation.movable.editable a.nav-tab-controls.portal-navigation-delete",
      "#tabLink_u#l#s#.portal-navigation-link",
      "#tabLink_u#l#s#.portal-navigation-link.flc-inlineEditable",
    ],
    collapse: ["#portlet_u#l#n#.up-portlet-wrapper.feedback-navigation"],
  },
  "faculty tab lms 1366": {
    spill: [
      "#portalNavigationList",
      "#portalNavigation_u#l#s#.portal-navigation.movable.editable a.nav-tab-controls.portal-navigation-delete",
      "#tabLink_u#l#s#.portal-navigation-link",
      "#tabLink_u#l#s#.portal-navigation-link.flc-inlineEditable",
    ],
    collapse: ["#portlet_u#l#n#.up-portlet-wrapper.feedback-navigation"],
  },
  "faculty tab lms 1920": {
    spill: [
      "#portalNavigationList",
      "#portalNavigation_u#l#s#.portal-navigation.movable.editable a.nav-tab-controls.portal-navigation-delete",
      "#tabLink_u#l#s#.portal-navigation-link",
      "#tabLink_u#l#s#.portal-navigation-link.flc-inlineEditable",
    ],
    collapse: ["#portlet_u#l#n#.up-portlet-wrapper.feedback-navigation"],
  },
  "faculty tab welcome 320": {
    scroll: [
      "#portalNavigation_u#l#s#.portal-navigation.movable.editable",
      "#up-sticky-nav a.menu-toggle.float-start",
    ],
    spill: [
      "#Pluto_#_u#l#n#_#_container.Pluto_#_u#l#n#_#_upcal-miniview.upcal-portlet.upcal-narrowview div.upcal-event-view",
      "#portalNavigationList",
      "#portlet_u#l#n#.up-portlet-wrapper.notification-icon notification-icon >>> #dropdownMenuButton",
      "#portlet_u#l#n#.up-portlet-wrapper.waffle-menu waffle-menu >>> button.waffle-trigger",
      "#up-sticky-nav div.portal-global.row",
    ],
    collapse: ["#portlet_u#l#n#.up-portlet-wrapper.feedback-navigation"],
  },
  "faculty tab welcome 390": {
    spill: [
      "#Pluto_#_u#l#n#_#_container.Pluto_#_u#l#n#_#_upcal-miniview.upcal-portlet.upcal-narrowview div.upcal-event-list",
      "#Pluto_#_u#l#n#_#_container.Pluto_#_u#l#n#_#_upcal-miniview.upcal-portlet.upcal-narrowview div.upcal-event-view",
      "#portalNavigationList",
      "#portlet_u#l#n#.up-portlet-wrapper.notification-icon notification-icon >>> #dropdownMenuButton",
      "#portlet_u#l#n#.up-portlet-wrapper.waffle-menu waffle-menu >>> button.waffle-trigger",
      "#up-sticky-nav div.portal-global.row",
    ],
    collapse: ["#portlet_u#l#n#.up-portlet-wrapper.feedback-navigation"],
  },
  "faculty tab welcome 768": {
    "cut-off": ["#file-uploader div.qq-upload-button.enabled_upload"],
    spill: [
      "#Pluto_#_u#l#n#_#_container.Pluto_#_u#l#n#_#_upcal-miniview.upcal-portlet.upcal-narrowview div.upcal-event-list",
      "#Pluto_#_u#l#n#_#_container.Pluto_#_u#l#n#_#_upcal-miniview.upcal-portlet.upcal-narrowview div.upcal-event-view",
      "#Pluto_#_u#l#n#_#_container.container.container-fluid.bootstrap-styles div.portlet-section-body",
      "#portalNavigationList",
      "#tabLink_u#l#s#.portal-navigation-link",
    ],
    collapse: ["#portlet_u#l#n#.up-portlet-wrapper.feedback-navigation"],
    spacing: ["#file-uploader div.qq-upload-button.enabled_upload"],
  },
  "faculty tab welcome 1024": {
    spill: [
      "#Pluto_#_u#l#n#_#_container.Pluto_#_u#l#n#_#_upcal-miniview.upcal-portlet.upcal-narrowview div.upcal-event-list",
      "#Pluto_#_u#l#n#_#_container.Pluto_#_u#l#n#_#_upcal-miniview.upcal-portlet.upcal-narrowview div.upcal-event-view",
      "#Pluto_#_u#l#n#_#_container.container.container-fluid.bootstrap-styles div.portlet-section-body",
      "#portalNavigationList",
      "#tabLink_u#l#s#.portal-navigation-link",
    ],
    collapse: ["#portlet_u#l#n#.up-portlet-wrapper.feedback-navigation"],
  },
  "faculty tab welcome 1366": {
    "cut-off": ["#file-uploader div.qq-upload-button.enabled_upload"],
    spill: [
      "#Pluto_#_u#l#n#_#_container.Pluto_#_u#l#n#_#_upcal-miniview.upcal-portlet.upcal-narrowview div.upcal-event-list",
      "#Pluto_#_u#l#n#_#_container.Pluto_#_u#l#n#_#_upcal-miniview.upcal-portlet.upcal-narrowview div.upcal-event-view",
      "#Pluto_#_u#l#n#_#_container.container.container-fluid.bootstrap-styles div.portlet-section-body",
      "#portalNavigationList",
      "#tabLink_u#l#s#.portal-navigation-link",
    ],
    collapse: ["#portlet_u#l#n#.up-portlet-wrapper.feedback-navigation"],
  },
  "faculty tab welcome 1920": {
    "cut-off": ["#file-uploader div.qq-upload-button.enabled_upload"],
    spill: [
      "#Pluto_#_u#l#n#_#_container.Pluto_#_u#l#n#_#_upcal-miniview.upcal-portlet.upcal-narrowview div.upcal-event-list",
      "#Pluto_#_u#l#n#_#_container.Pluto_#_u#l#n#_#_upcal-miniview.upcal-portlet.upcal-narrowview div.upcal-event-view",
      "#Pluto_#_u#l#n#_#_container.container.container-fluid.bootstrap-styles div.portlet-section-body",
      "#portalNavigationList",
      "#tabLink_u#l#s#.portal-navigation-link",
    ],
    collapse: ["#portlet_u#l#n#.up-portlet-wrapper.feedback-navigation"],
    spacing: ["#file-uploader div.qq-upload-button.enabled_upload"],
  },
  "guest login 320": {
    spill: [
      "#Pluto_#_ctf#_#_search.portlet-section div.col-sm-#",
      "#Pluto_#_ctf#_#_search.portlet-section form",
      "#portalCASLoginLink",
      "#portalCASLoginNewLink",
      "#up-sticky-nav div.portal-global.row",
    ],
  },
  "guest login 390": {
    spill: [
      "#Pluto_#_ctf#_#_search.portlet-section form",
      "#portalCASLoginLink",
      "#up-sticky-nav div.portal-global.row",
    ],
  },
  "guest login 768": {
    spill: [
      "#Pluto_#_ctf#_#_search.portlet-section form",
      "#portalNavigationList",
    ],
  },
  "guest login 1024": {
    spill: [
      "#Pluto_#_ctf#_#_search.portlet-section form",
      "#portalNavigationList",
    ],
  },
  "guest login 1366": {
    spill: [
      "#Pluto_#_ctf#_#_search.portlet-section form",
      "#portalNavigationList",
    ],
  },
  "guest login 1920": {
    spill: [
      "#Pluto_#_ctf#_#_search.portlet-section form",
      "#portalNavigationList",
    ],
  },
  "guest tab welcome 320": {
    spill: [
      "#portalCASLoginLink",
      "#portalCASLoginNewLink",
      "#up-sticky-nav div.portal-global.row",
    ],
  },
  "guest tab welcome 390": {
    spill: ["#portalCASLoginLink", "#up-sticky-nav div.portal-global.row"],
  },
  "guest tab welcome 768": {
    spill: ["#portalNavigationList"],
  },
  "guest tab welcome 1024": {
    spill: ["#portalNavigationList"],
  },
  "guest tab welcome 1366": {
    spill: ["#portalNavigationList"],
  },
  "guest tab welcome 1920": {
    spill: ["#portalNavigationList"],
  },
  "staff tab main-staff-tab 320": {
    "cut-off": [
      "#portletContent_u#l#n#.fl-widget-content.fl-fix.up-portlet-content-wrapper",
    ],
    spill: [
      "#portletContent_u#l#n#.fl-widget-content.fl-fix.up-portlet-content-wrapper p",
      "#portlet_u#l#n#.up-portlet-wrapper.notification-icon notification-icon >>> #dropdownMenuButton",
      "#portlet_u#l#n#.up-portlet-wrapper.waffle-menu waffle-menu >>> button.waffle-trigger",
      "#up-sticky-nav div.portal-global.row",
    ],
    collapse: ["#portlet_u#l#n#.up-portlet-wrapper.feedback-navigation"],
    spacing: [
      "#portletContent_u#l#n#.fl-widget-content.fl-fix.up-portlet-content-wrapper",
    ],
  },
  "staff tab main-staff-tab 390": {
    "cut-off": [
      "#portletContent_u#l#n#.fl-widget-content.fl-fix.up-portlet-content-wrapper",
    ],
    spill: [
      "#portletContent_u#l#n#.fl-widget-content.fl-fix.up-portlet-content-wrapper p",
      "#portlet_u#l#n#.up-portlet-wrapper.notification-icon notification-icon >>> #dropdownMenuButton",
      "#portlet_u#l#n#.up-portlet-wrapper.waffle-menu waffle-menu >>> button.waffle-trigger",
      "#up-sticky-nav div.portal-global.row",
    ],
    collapse: ["#portlet_u#l#n#.up-portlet-wrapper.feedback-navigation"],
    spacing: [
      "#portletContent_u#l#n#.fl-widget-content.fl-fix.up-portlet-content-wrapper",
    ],
  },
  "staff tab main-staff-tab 768": {
    "cut-off": [
      "#portletContent_u#l#n#.fl-widget-content.fl-fix.up-portlet-content-wrapper",
    ],
    spill: [
      "#portalNavigationList",
      "#portletContent_u#l#n#.fl-widget-content.fl-fix.up-portlet-content-wrapper p",
      "#tabLink_u#l#s#.portal-navigation-link.flc-inlineEditable",
    ],
    collapse: ["#portlet_u#l#n#.up-portlet-wrapper.feedback-navigation"],
    spacing: [
      "#portletContent_u#l#n#.fl-widget-content.fl-fix.up-portlet-content-wrapper",
    ],
  },
  "staff tab main-staff-tab 1024": {
    spill: [
      "#portalNavigationList",
      "#tabLink_u#l#s#.portal-navigation-link.flc-inlineEditable",
    ],
    collapse: ["#portlet_u#l#n#.up-portlet-wrapper.feedback-navigation"],
  },
  "staff tab main-staff-tab 1366": {
    spill: [
      "#portalNavigationList",
      "#tabLink_u#l#s#.portal-navigation-link.flc-inlineEditable",
    ],
    collapse: ["#portlet_u#l#n#.up-portlet-wrapper.feedback-navigation"],
  },
  "staff tab main-staff-tab 1920": {
    spill: [
      "#portalNavigationList",
      "#tabLink_u#l#s#.portal-navigation-link.flc-inlineEditable",
    ],
    collapse: ["#portlet_u#l#n#.up-portlet-wrapper.feedback-navigation"],
  },
  "staff tab welcome 320": {
    spill: [
      "#Pluto_#_u#l#n#_#_container.Pluto_#_u#l#n#_#_upcal-miniview.upcal-portlet.upcal-narrowview div.upcal-event-view",
      "#portlet_u#l#n#.up-portlet-wrapper.notification-icon notification-icon >>> #dropdownMenuButton",
      "#portlet_u#l#n#.up-portlet-wrapper.waffle-menu waffle-menu >>> button.waffle-trigger",
      "#up-sticky-nav div.portal-global.row",
    ],
    collapse: ["#portlet_u#l#n#.up-portlet-wrapper.feedback-navigation"],
  },
  "staff tab welcome 390": {
    spill: [
      "#Pluto_#_u#l#n#_#_container.Pluto_#_u#l#n#_#_upcal-miniview.upcal-portlet.upcal-narrowview div.upcal-event-list",
      "#Pluto_#_u#l#n#_#_container.Pluto_#_u#l#n#_#_upcal-miniview.upcal-portlet.upcal-narrowview div.upcal-event-view",
      "#portlet_u#l#n#.up-portlet-wrapper.notification-icon notification-icon >>> #dropdownMenuButton",
      "#portlet_u#l#n#.up-portlet-wrapper.waffle-menu waffle-menu >>> button.waffle-trigger",
      "#up-sticky-nav div.portal-global.row",
    ],
    collapse: ["#portlet_u#l#n#.up-portlet-wrapper.feedback-navigation"],
  },
  "staff tab welcome 768": {
    "cut-off": ["#file-uploader div.qq-upload-button.enabled_upload"],
    spill: [
      "#Pluto_#_u#l#n#_#_container.Pluto_#_u#l#n#_#_upcal-miniview.upcal-portlet.upcal-narrowview div.upcal-event-list",
      "#Pluto_#_u#l#n#_#_container.Pluto_#_u#l#n#_#_upcal-miniview.upcal-portlet.upcal-narrowview div.upcal-event-view",
      "#Pluto_#_u#l#n#_#_container.container.container-fluid.bootstrap-styles div.portlet-section-body",
      "#portalNavigationList",
      "#tabLink_u#l#s#.portal-navigation-link",
    ],
    collapse: ["#portlet_u#l#n#.up-portlet-wrapper.feedback-navigation"],
    spacing: ["#file-uploader div.qq-upload-button.enabled_upload"],
  },
  "staff tab welcome 1024": {
    spill: [
      "#Pluto_#_u#l#n#_#_container.Pluto_#_u#l#n#_#_upcal-miniview.upcal-portlet.upcal-narrowview div.upcal-event-list",
      "#Pluto_#_u#l#n#_#_container.Pluto_#_u#l#n#_#_upcal-miniview.upcal-portlet.upcal-narrowview div.upcal-event-view",
      "#Pluto_#_u#l#n#_#_container.container.container-fluid.bootstrap-styles div.portlet-section-body",
      "#portalNavigationList",
      "#tabLink_u#l#s#.portal-navigation-link",
    ],
    collapse: ["#portlet_u#l#n#.up-portlet-wrapper.feedback-navigation"],
  },
  "staff tab welcome 1366": {
    "cut-off": ["#file-uploader div.qq-upload-button.enabled_upload"],
    spill: [
      "#Pluto_#_u#l#n#_#_container.Pluto_#_u#l#n#_#_upcal-miniview.upcal-portlet.upcal-narrowview div.upcal-event-list",
      "#Pluto_#_u#l#n#_#_container.Pluto_#_u#l#n#_#_upcal-miniview.upcal-portlet.upcal-narrowview div.upcal-event-view",
      "#Pluto_#_u#l#n#_#_container.container.container-fluid.bootstrap-styles div.portlet-section-body",
      "#portalNavigationList",
      "#tabLink_u#l#s#.portal-navigation-link",
    ],
    collapse: ["#portlet_u#l#n#.up-portlet-wrapper.feedback-navigation"],
  },
  "staff tab welcome 1920": {
    "cut-off": ["#file-uploader div.qq-upload-button.enabled_upload"],
    spill: [
      "#Pluto_#_u#l#n#_#_container.Pluto_#_u#l#n#_#_upcal-miniview.upcal-portlet.upcal-narrowview div.upcal-event-list",
      "#Pluto_#_u#l#n#_#_container.Pluto_#_u#l#n#_#_upcal-miniview.upcal-portlet.upcal-narrowview div.upcal-event-view",
      "#Pluto_#_u#l#n#_#_container.container.container-fluid.bootstrap-styles div.portlet-section-body",
      "#portalNavigationList",
      "#tabLink_u#l#s#.portal-navigation-link",
    ],
    collapse: ["#portlet_u#l#n#.up-portlet-wrapper.feedback-navigation"],
    spacing: ["#file-uploader div.qq-upload-button.enabled_upload"],
  },
  "student favorites max 320": {
    scroll: [
      "#portalNavigation_u#l#s#.portal-navigation.movable.editable",
      "#up-sticky-nav a.menu-toggle.float-start",
    ],
    spill: [
      "#portalNavigationList",
      "#portlet_u#l#n#.up-portlet-wrapper.notification-icon notification-icon >>> #dropdownMenuButton",
      "#portlet_u#l#n#.up-portlet-wrapper.waffle-menu waffle-menu >>> button.waffle-trigger",
      "#up-sticky-nav div.portal-global.row",
    ],
    collapse: ["#portlet_u#l#n#.up-portlet-wrapper.feedback-navigation"],
  },
  "student favorites max 390": {
    spill: [
      "#portalNavigationList",
      "#portlet_u#l#n#.up-portlet-wrapper.notification-icon notification-icon >>> #dropdownMenuButton",
      "#portlet_u#l#n#.up-portlet-wrapper.waffle-menu waffle-menu >>> button.waffle-trigger",
      "#up-sticky-nav div.portal-global.row",
    ],
    collapse: ["#portlet_u#l#n#.up-portlet-wrapper.feedback-navigation"],
  },
  "student favorites max 768": {
    spill: ["#portalNavigationList"],
    collapse: ["#portlet_u#l#n#.up-portlet-wrapper.feedback-navigation"],
  },
  "student favorites max 1024": {
    spill: ["#portalNavigationList"],
    collapse: ["#portlet_u#l#n#.up-portlet-wrapper.feedback-navigation"],
  },
  "student favorites max 1366": {
    spill: ["#portalNavigationList"],
    collapse: ["#portlet_u#l#n#.up-portlet-wrapper.feedback-navigation"],
  },
  "student favorites max 1920": {
    spill: ["#portalNavigationList"],
    collapse: ["#portlet_u#l#n#.up-portlet-wrapper.feedback-navigation"],
  },
  "student popular-portlets max 320": {
    scroll: [
      "#portalNavigation_u#l#s#.portal-navigation.movable.editable",
      "#up-sticky-nav a.menu-toggle.float-start",
    ],
    spill: [
      "#portalNavigationList",
      "#portlet_u#l#n#.up-portlet-wrapper.notification-icon notification-icon >>> #dropdownMenuButton",
      "#portlet_u#l#n#.up-portlet-wrapper.waffle-menu waffle-menu >>> button.waffle-trigger",
      "#up-sticky-nav div.portal-global.row",
    ],
    collapse: ["#portlet_u#l#n#.up-portlet-wrapper.feedback-navigation"],
  },
  "student popular-portlets max 390": {
    spill: [
      "#portalNavigationList",
      "#portlet_u#l#n#.up-portlet-wrapper.notification-icon notification-icon >>> #dropdownMenuButton",
      "#portlet_u#l#n#.up-portlet-wrapper.waffle-menu waffle-menu >>> button.waffle-trigger",
      "#up-sticky-nav div.portal-global.row",
    ],
    collapse: ["#portlet_u#l#n#.up-portlet-wrapper.feedback-navigation"],
  },
  "student popular-portlets max 768": {
    spill: ["#portalNavigationList"],
    collapse: ["#portlet_u#l#n#.up-portlet-wrapper.feedback-navigation"],
  },
  "student popular-portlets max 1024": {
    spill: ["#portalNavigationList"],
    collapse: ["#portlet_u#l#n#.up-portlet-wrapper.feedback-navigation"],
  },
  "student popular-portlets max 1366": {
    spill: ["#portalNavigationList"],
    collapse: ["#portlet_u#l#n#.up-portlet-wrapper.feedback-navigation"],
  },
  "student popular-portlets max 1920": {
    spill: ["#portalNavigationList"],
    collapse: ["#portlet_u#l#n#.up-portlet-wrapper.feedback-navigation"],
  },
  "student tab academics 320": {
    scroll: [
      "#portalNavigation_u#l#s#.portal-navigation.movable.editable",
      "#up-sticky-nav a.menu-toggle.float-start",
    ],
    spill: [
      "#portalNavigationList",
      "#portlet_u#l#n#.up-portlet-wrapper.notification-icon notification-icon >>> #dropdownMenuButton",
      "#portlet_u#l#n#.up-portlet-wrapper.waffle-menu waffle-menu >>> button.waffle-trigger",
      "#up-sticky-nav div.portal-global.row",
    ],
    collapse: ["#portlet_u#l#n#.up-portlet-wrapper.feedback-navigation"],
  },
  "student tab academics 390": {
    spill: [
      "#portalNavigationList",
      "#portlet_u#l#n#.up-portlet-wrapper.notification-icon notification-icon >>> #dropdownMenuButton",
      "#portlet_u#l#n#.up-portlet-wrapper.waffle-menu waffle-menu >>> button.waffle-trigger",
      "#up-sticky-nav div.portal-global.row",
    ],
    collapse: ["#portlet_u#l#n#.up-portlet-wrapper.feedback-navigation"],
  },
  "student tab academics 768": {
    spill: [
      "#portalNavigationList",
      "#portalNavigation_u#l#s#.portal-navigation.movable.editable a.nav-tab-controls.portal-navigation-delete",
      "#tabLink_u#l#s#.portal-navigation-link",
      "#tabLink_u#l#s#.portal-navigation-link.flc-inlineEditable",
    ],
    collapse: ["#portlet_u#l#n#.up-portlet-wrapper.feedback-navigation"],
  },
  "student tab academics 1024": {
    spill: [
      "#portalNavigationList",
      "#portalNavigation_u#l#s#.portal-navigation.movable.editable a.nav-tab-controls.portal-navigation-delete",
      "#tabLink_u#l#s#.portal-navigation-link",
      "#tabLink_u#l#s#.portal-navigation-link.flc-inlineEditable",
    ],
    collapse: ["#portlet_u#l#n#.up-portlet-wrapper.feedback-navigation"],
  },
  "student tab academics 1366": {
    spill: [
      "#portalNavigationList",
      "#portalNavigation_u#l#s#.portal-navigation.movable.editable a.nav-tab-controls.portal-navigation-delete",
      "#tabLink_u#l#s#.portal-navigation-link",
      "#tabLink_u#l#s#.portal-navigation-link.flc-inlineEditable",
    ],
    collapse: ["#portlet_u#l#n#.up-portlet-wrapper.feedback-navigation"],
  },
  "student tab academics 1920": {
    spill: [
      "#portalNavigationList",
      "#portalNavigation_u#l#s#.portal-navigation.movable.editable a.nav-tab-controls.portal-navigation-delete",
      "#tabLink_u#l#s#.portal-navigation-link",
      "#tabLink_u#l#s#.portal-navigation-link.flc-inlineEditable",
    ],
    collapse: ["#portlet_u#l#n#.up-portlet-wrapper.feedback-navigation"],
  },
  "student tab campus 320": {
    scroll: [
      "#portalNavigation_u#l#s#.portal-navigation.movable.editable",
      "#up-sticky-nav a.menu-toggle.float-start",
    ],
    spill: [
      "#portalNavigationList",
      "#portlet_u#l#n#.up-portlet-wrapper.notification-icon notification-icon >>> #dropdownMenuButton",
      "#portlet_u#l#n#.up-portlet-wrapper.waffle-menu waffle-menu >>> button.waffle-trigger",
      "#up-sticky-nav div.portal-global.row",
    ],
    collapse: ["#portlet_u#l#n#.up-portlet-wrapper.feedback-navigation"],
  },
  "student tab campus 390": {
    spill: [
      "#portalNavigationList",
      "#portlet_u#l#n#.up-portlet-wrapper.notification-icon notification-icon >>> #dropdownMenuButton",
      "#portlet_u#l#n#.up-portlet-wrapper.waffle-menu waffle-menu >>> button.waffle-trigger",
      "#up-sticky-nav div.portal-global.row",
    ],
    collapse: ["#portlet_u#l#n#.up-portlet-wrapper.feedback-navigation"],
  },
  "student tab campus 768": {
    spill: [
      "#portalNavigationList",
      "#tabLink_u#l#s#.portal-navigation-link",
      "#tabLink_u#l#s#.portal-navigation-link.flc-inlineEditable",
    ],
    collapse: ["#portlet_u#l#n#.up-portlet-wrapper.feedback-navigation"],
  },
  "student tab campus 1024": {
    spill: [
      "#portalNavigationList",
      "#tabLink_u#l#s#.portal-navigation-link",
      "#tabLink_u#l#s#.portal-navigation-link.flc-inlineEditable",
    ],
    collapse: ["#portlet_u#l#n#.up-portlet-wrapper.feedback-navigation"],
  },
  "student tab campus 1366": {
    spill: [
      "#portalNavigationList",
      "#tabLink_u#l#s#.portal-navigation-link",
      "#tabLink_u#l#s#.portal-navigation-link.flc-inlineEditable",
    ],
    collapse: ["#portlet_u#l#n#.up-portlet-wrapper.feedback-navigation"],
  },
  "student tab campus 1920": {
    spill: [
      "#portalNavigationList",
      "#tabLink_u#l#s#.portal-navigation-link",
      "#tabLink_u#l#s#.portal-navigation-link.flc-inlineEditable",
    ],
    collapse: ["#portlet_u#l#n#.up-portlet-wrapper.feedback-navigation"],
  },
  "student tab lms 320": {
    scroll: [
      "#portalNavigation_u#l#s#.portal-navigation.movable.editable",
      "#up-sticky-nav a.menu-toggle.float-start",
    ],
    spill: [
      "#portalNavigationList",
      "#portlet_u#l#n#.up-portlet-wrapper.notification-icon notification-icon >>> #dropdownMenuButton",
      "#portlet_u#l#n#.up-portlet-wrapper.waffle-menu waffle-menu >>> button.waffle-trigger",
      "#up-sticky-nav div.portal-global.row",
    ],
    collapse: ["#portlet_u#l#n#.up-portlet-wrapper.feedback-navigation"],
  },
  "student tab lms 390": {
    spill: [
      "#portalNavigationList",
      "#portlet_u#l#n#.up-portlet-wrapper.notification-icon notification-icon >>> #dropdownMenuButton",
      "#portlet_u#l#n#.up-portlet-wrapper.waffle-menu waffle-menu >>> button.waffle-trigger",
      "#up-sticky-nav div.portal-global.row",
    ],
    collapse: ["#portlet_u#l#n#.up-portlet-wrapper.feedback-navigation"],
  },
  "student tab lms 768": {
    spill: [
      "#portalNavigationList",
      "#portalNavigation_u#l#s#.portal-navigation.movable.editable a.nav-tab-controls.portal-navigation-delete",
      "#tabLink_u#l#s#.portal-navigation-link",
      "#tabLink_u#l#s#.portal-navigation-link.flc-inlineEditable",
    ],
    collapse: ["#portlet_u#l#n#.up-portlet-wrapper.feedback-navigation"],
  },
  "student tab lms 1024": {
    spill: [
      "#portalNavigationList",
      "#portalNavigation_u#l#s#.portal-navigation.movable.editable a.nav-tab-controls.portal-navigation-delete",
      "#tabLink_u#l#s#.portal-navigation-link",
      "#tabLink_u#l#s#.portal-navigation-link.flc-inlineEditable",
    ],
    collapse: ["#portlet_u#l#n#.up-portlet-wrapper.feedback-navigation"],
  },
  "student tab lms 1366": {
    spill: [
      "#portalNavigationList",
      "#portalNavigation_u#l#s#.portal-navigation.movable.editable a.nav-tab-controls.portal-navigation-delete",
      "#tabLink_u#l#s#.portal-navigation-link",
      "#tabLink_u#l#s#.portal-navigation-link.flc-inlineEditable",
    ],
    collapse: ["#portlet_u#l#n#.up-portlet-wrapper.feedback-navigation"],
  },
  "student tab lms 1920": {
    spill: [
      "#portalNavigationList",
      "#portalNavigation_u#l#s#.portal-navigation.movable.editable a.nav-tab-controls.portal-navigation-delete",
      "#tabLink_u#l#s#.portal-navigation-link",
      "#tabLink_u#l#s#.portal-navigation-link.flc-inlineEditable",
    ],
    collapse: ["#portlet_u#l#n#.up-portlet-wrapper.feedback-navigation"],
  },
  "student tab welcome 320": {
    scroll: [
      "#portalNavigation_u#l#s#.portal-navigation.movable.editable",
      "#up-sticky-nav a.menu-toggle.float-start",
    ],
    spill: [
      "#Pluto_#_u#l#n#_#_container.Pluto_#_u#l#n#_#_upcal-miniview.upcal-portlet.upcal-narrowview div.upcal-event-view",
      "#portalNavigationList",
      "#portlet_u#l#n#.up-portlet-wrapper.notification-icon notification-icon >>> #dropdownMenuButton",
      "#portlet_u#l#n#.up-portlet-wrapper.waffle-menu waffle-menu >>> button.waffle-trigger",
      "#up-sticky-nav div.portal-global.row",
    ],
    collapse: ["#portlet_u#l#n#.up-portlet-wrapper.feedback-navigation"],
  },
  "student tab welcome 390": {
    spill: [
      "#Pluto_#_u#l#n#_#_container.Pluto_#_u#l#n#_#_upcal-miniview.upcal-portlet.upcal-narrowview div.upcal-event-list",
      "#Pluto_#_u#l#n#_#_container.Pluto_#_u#l#n#_#_upcal-miniview.upcal-portlet.upcal-narrowview div.upcal-event-view",
      "#portalNavigationList",
      "#portlet_u#l#n#.up-portlet-wrapper.notification-icon notification-icon >>> #dropdownMenuButton",
      "#portlet_u#l#n#.up-portlet-wrapper.waffle-menu waffle-menu >>> button.waffle-trigger",
      "#up-sticky-nav div.portal-global.row",
    ],
    collapse: ["#portlet_u#l#n#.up-portlet-wrapper.feedback-navigation"],
  },
  "student tab welcome 768": {
    "cut-off": ["#file-uploader div.qq-upload-button.enabled_upload"],
    spill: [
      "#Pluto_#_u#l#n#_#_container.Pluto_#_u#l#n#_#_upcal-miniview.upcal-portlet.upcal-narrowview div.upcal-event-list",
      "#Pluto_#_u#l#n#_#_container.Pluto_#_u#l#n#_#_upcal-miniview.upcal-portlet.upcal-narrowview div.upcal-event-view",
      "#Pluto_#_u#l#n#_#_container.container.container-fluid.bootstrap-styles div.portlet-section-body",
      "#portalNavigationList",
      "#tabLink_u#l#s#.portal-navigation-link",
    ],
    collapse: ["#portlet_u#l#n#.up-portlet-wrapper.feedback-navigation"],
    spacing: ["#file-uploader div.qq-upload-button.enabled_upload"],
  },
  "student tab welcome 1024": {
    spill: [
      "#Pluto_#_u#l#n#_#_container.Pluto_#_u#l#n#_#_upcal-miniview.upcal-portlet.upcal-narrowview div.upcal-event-list",
      "#Pluto_#_u#l#n#_#_container.Pluto_#_u#l#n#_#_upcal-miniview.upcal-portlet.upcal-narrowview div.upcal-event-view",
      "#Pluto_#_u#l#n#_#_container.container.container-fluid.bootstrap-styles div.portlet-section-body",
      "#portalNavigationList",
      "#tabLink_u#l#s#.portal-navigation-link",
    ],
    collapse: ["#portlet_u#l#n#.up-portlet-wrapper.feedback-navigation"],
  },
  "student tab welcome 1366": {
    "cut-off": ["#file-uploader div.qq-upload-button.enabled_upload"],
    spill: [
      "#Pluto_#_u#l#n#_#_container.Pluto_#_u#l#n#_#_upcal-miniview.upcal-portlet.upcal-narrowview div.upcal-event-list",
      "#Pluto_#_u#l#n#_#_container.Pluto_#_u#l#n#_#_upcal-miniview.upcal-portlet.upcal-narrowview div.upcal-event-view",
      "#Pluto_#_u#l#n#_#_container.container.container-fluid.bootstrap-styles div.portlet-section-body",
      "#portalNavigationList",
      "#tabLink_u#l#s#.portal-navigation-link",
    ],
    collapse: ["#portlet_u#l#n#.up-portlet-wrapper.feedback-navigation"],
  },
  "student tab welcome 1920": {
    "cut-off": ["#file-uploader div.qq-upload-button.enabled_upload"],
    spill: [
      "#Pluto_#_u#l#n#_#_container.Pluto_#_u#l#n#_#_upcal-miniview.upcal-portlet.upcal-narrowview div.upcal-event-list",
      "#Pluto_#_u#l#n#_#_container.Pluto_#_u#l#n#_#_upcal-miniview.upcal-portlet.upcal-narrowview div.upcal-event-view",
      "#Pluto_#_u#l#n#_#_container.container.container-fluid.bootstrap-styles div.portlet-section-body",
      "#portalNavigationList",
      "#tabLink_u#l#s#.portal-navigation-link",
    ],
    collapse: ["#portlet_u#l#n#.up-portlet-wrapper.feedback-navigation"],
    spacing: ["#file-uploader div.qq-upload-button.enabled_upload"],
  },
};
