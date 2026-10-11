import type { Baseline } from "./layout-checks";

/*
 * Layout problems the pages have today (MOD-D52), by "<visitor> <page>
 * <width>", check and node (see layout-checks.ts). The list only shrinks:
 * a fix removes its entries in the same commit. Keep it sorted.
 */
export const baseline: Baseline = {
  "admin permissionsmanager 768": {
    spill: [
      "#portletContent_ctf#.fl-widget-content.fl-fix.up-portlet-content-wrapper a",
    ],
  },
  "admin portlet-admin 320": {
    "cut-off": [
      "#portletContent_ctf#.fl-widget-content.fl-fix.up-portlet-content-wrapper",
    ],
    spill: ["#Pluto_#_ctf#_#_pagingRow.dt-paging-row"],
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
    ],
    spacing: [
      "#portletContent_ctf#.fl-widget-content.fl-fix.up-portlet-content-wrapper",
    ],
  },
  "admin portlet-admin 768": {
    spill: [
      "#Pluto_#_ctf#_#_portletsList_wrapper.dt-container.dt-bootstrap#.dt-empty-footer",
    ],
  },
  "admin portlet-admin 1024": {
    spill: [
      "#Pluto_#_ctf#_#_portletsList_wrapper.dt-container.dt-bootstrap#.dt-empty-footer",
    ],
  },
  "admin portlet-admin 1366": {
    spill: [
      "#Pluto_#_ctf#_#_portletsList_wrapper.dt-container.dt-bootstrap#.dt-empty-footer",
    ],
  },
  "admin portlet-admin 1920": {
    spill: [
      "#Pluto_#_ctf#_#_portletsList_wrapper.dt-container.dt-bootstrap#.dt-empty-footer",
    ],
  },
  "admin tab admin-tools 320": {
    "cut-off": [
      "#portletContent_u#l#n#.up-portlet-content-wrapper esco-content-grid >>> div.portlet-card-title",
    ],
    spill: [
      "#portletContent_u#l#n#.up-portlet-content-wrapper esco-content-grid >>> div.filter.custom-caret.closed",
    ],
    spacing: [
      "#portletContent_u#l#n#.up-portlet-content-wrapper esco-content-grid >>> div.portlet-card-title",
    ],
  },
  "admin tab admin-tools 390": {
    "cut-off": [
      "#portletContent_u#l#n#.up-portlet-content-wrapper esco-content-grid >>> div.portlet-card-title",
    ],
    spill: [
      "#portletContent_u#l#n#.up-portlet-content-wrapper esco-content-grid >>> div.filter.custom-caret.closed",
    ],
    spacing: [
      "#portletContent_u#l#n#.up-portlet-content-wrapper esco-content-grid >>> div.portlet-card-title",
    ],
  },
  "admin tab admin-tools 768": {
    "cut-off": [
      "#portletContent_u#l#n#.up-portlet-content-wrapper esco-content-grid >>> div.portlet-card-title",
    ],
    spill: [
      "#portalNavigation_u#l#s#.portal-navigation.movable.editable a.nav-tab-controls.portal-navigation-delete",
      "#portletContent_u#l#n#.up-portlet-content-wrapper esco-content-grid >>> div.filter.custom-caret.closed",
      "#tabLink_u#l#s#.portal-navigation-link",
      "#tabLink_u#l#s#.portal-navigation-link.flc-inlineEditable",
    ],
    spacing: [
      "#portletContent_u#l#n#.up-portlet-content-wrapper esco-content-grid >>> div.portlet-card-title",
    ],
  },
  "admin tab admin-tools 1024": {
    spill: [
      "#portalNavigation_u#l#s#.portal-navigation.movable.editable a.nav-tab-controls.portal-navigation-delete",
      "#tabLink_u#l#s#.portal-navigation-link",
      "#tabLink_u#l#s#.portal-navigation-link.flc-inlineEditable",
    ],
    spacing: [
      "#portletContent_u#l#n#.up-portlet-content-wrapper esco-content-grid >>> div.portlet-card-title",
    ],
  },
  "admin tab admin-tools 1366": {
    spill: [
      "#portalNavigation_u#l#s#.portal-navigation.movable.editable a.nav-tab-controls.portal-navigation-delete",
      "#tabLink_u#l#s#.portal-navigation-link",
      "#tabLink_u#l#s#.portal-navigation-link.flc-inlineEditable",
    ],
    spacing: [
      "#portletContent_u#l#n#.up-portlet-content-wrapper esco-content-grid >>> div.portlet-card-title",
    ],
  },
  "admin tab admin-tools 1920": {
    spill: [
      "#portalNavigation_u#l#s#.portal-navigation.movable.editable a.nav-tab-controls.portal-navigation-delete",
      "#tabLink_u#l#s#.portal-navigation-link",
      "#tabLink_u#l#s#.portal-navigation-link.flc-inlineEditable",
    ],
    spacing: [
      "#portletContent_u#l#n#.up-portlet-content-wrapper esco-content-grid >>> div.portlet-card-title",
    ],
  },
  "admin tab development 320": {
    "cut-off": [
      "#portletContent_u#l#n#.fl-widget-content.fl-fix.up-portlet-content-wrapper",
    ],
    spill: [
      "#portletContent_u#l#n#.fl-widget-content.fl-fix.up-portlet-content-wrapper div.content",
    ],
    spacing: [
      "#portletContent_u#l#n#.fl-widget-content.fl-fix.up-portlet-content-wrapper",
    ],
  },
  "admin tab development 390": {
    "cut-off": [
      "#portletContent_u#l#n#.fl-widget-content.fl-fix.up-portlet-content-wrapper",
    ],
    spill: [
      "#portletContent_u#l#n#.fl-widget-content.fl-fix.up-portlet-content-wrapper div.content",
    ],
    spacing: [
      "#portletContent_u#l#n#.fl-widget-content.fl-fix.up-portlet-content-wrapper",
    ],
  },
  "admin tab development 768": {
    "cut-off": [
      "#portletContent_u#l#n#.fl-widget-content.fl-fix.up-portlet-content-wrapper",
    ],
    spill: [
      "#portalNavigation_u#l#s#.portal-navigation.movable.editable a.nav-tab-controls.portal-navigation-delete",
      "#portletContent_u#l#n#.fl-widget-content.fl-fix.up-portlet-content-wrapper div.content",
      "#tabLink_u#l#s#.portal-navigation-link",
      "#tabLink_u#l#s#.portal-navigation-link.flc-inlineEditable",
    ],
    spacing: [
      "#portletContent_u#l#n#.fl-widget-content.fl-fix.up-portlet-content-wrapper",
    ],
  },
  "admin tab development 1024": {
    "cut-off": [
      "#portletContent_u#l#n#.fl-widget-content.fl-fix.up-portlet-content-wrapper",
    ],
    spill: [
      "#portalNavigation_u#l#s#.portal-navigation.movable.editable a.nav-tab-controls.portal-navigation-delete",
      "#portletContent_u#l#n#.fl-widget-content.fl-fix.up-portlet-content-wrapper div.content",
      "#tabLink_u#l#s#.portal-navigation-link",
      "#tabLink_u#l#s#.portal-navigation-link.flc-inlineEditable",
    ],
    spacing: [
      "#portletContent_u#l#n#.fl-widget-content.fl-fix.up-portlet-content-wrapper",
    ],
  },
  "admin tab development 1366": {
    "cut-off": [
      "#portletContent_u#l#n#.fl-widget-content.fl-fix.up-portlet-content-wrapper",
    ],
    spill: [
      "#portalNavigation_u#l#s#.portal-navigation.movable.editable a.nav-tab-controls.portal-navigation-delete",
      "#portletContent_u#l#n#.fl-widget-content.fl-fix.up-portlet-content-wrapper div.content",
      "#tabLink_u#l#s#.portal-navigation-link",
      "#tabLink_u#l#s#.portal-navigation-link.flc-inlineEditable",
    ],
    spacing: [
      "#portletContent_u#l#n#.fl-widget-content.fl-fix.up-portlet-content-wrapper",
    ],
  },
  "admin tab development 1920": {
    "cut-off": [
      "#portletContent_u#l#n#.fl-widget-content.fl-fix.up-portlet-content-wrapper",
    ],
    spill: [
      "#portalNavigation_u#l#s#.portal-navigation.movable.editable a.nav-tab-controls.portal-navigation-delete",
      "#tabLink_u#l#s#.portal-navigation-link",
      "#tabLink_u#l#s#.portal-navigation-link.flc-inlineEditable",
    ],
    spacing: [
      "#portletContent_u#l#n#.fl-widget-content.fl-fix.up-portlet-content-wrapper",
    ],
  },
  "admin tab testing 768": {
    spill: [
      "#tabLink_u#l#s#.portal-navigation-link",
      "#tabLink_u#l#s#.portal-navigation-link.flc-inlineEditable",
    ],
  },
  "admin tab testing 1024": {
    spill: [
      "#tabLink_u#l#s#.portal-navigation-link",
      "#tabLink_u#l#s#.portal-navigation-link.flc-inlineEditable",
    ],
  },
  "admin tab testing 1366": {
    spill: [
      "#tabLink_u#l#s#.portal-navigation-link",
      "#tabLink_u#l#s#.portal-navigation-link.flc-inlineEditable",
    ],
  },
  "admin tab testing 1920": {
    spill: [
      "#tabLink_u#l#s#.portal-navigation-link",
      "#tabLink_u#l#s#.portal-navigation-link.flc-inlineEditable",
    ],
  },
  "faculty tab academics 768": {
    spill: [
      "#portalNavigation_u#l#s#.portal-navigation.movable.editable a.nav-tab-controls.portal-navigation-delete",
      "#tabLink_u#l#s#.portal-navigation-link",
      "#tabLink_u#l#s#.portal-navigation-link.flc-inlineEditable",
    ],
  },
  "faculty tab academics 1024": {
    spill: [
      "#portalNavigation_u#l#s#.portal-navigation.movable.editable a.nav-tab-controls.portal-navigation-delete",
      "#tabLink_u#l#s#.portal-navigation-link",
      "#tabLink_u#l#s#.portal-navigation-link.flc-inlineEditable",
    ],
  },
  "faculty tab academics 1366": {
    spill: [
      "#portalNavigation_u#l#s#.portal-navigation.movable.editable a.nav-tab-controls.portal-navigation-delete",
      "#tabLink_u#l#s#.portal-navigation-link",
      "#tabLink_u#l#s#.portal-navigation-link.flc-inlineEditable",
    ],
  },
  "faculty tab academics 1920": {
    spill: [
      "#portalNavigation_u#l#s#.portal-navigation.movable.editable a.nav-tab-controls.portal-navigation-delete",
      "#tabLink_u#l#s#.portal-navigation-link",
      "#tabLink_u#l#s#.portal-navigation-link.flc-inlineEditable",
    ],
  },
  "faculty tab campus 768": {
    spill: [
      "#tabLink_u#l#s#.portal-navigation-link",
      "#tabLink_u#l#s#.portal-navigation-link.flc-inlineEditable",
    ],
  },
  "faculty tab campus 1024": {
    spill: [
      "#tabLink_u#l#s#.portal-navigation-link",
      "#tabLink_u#l#s#.portal-navigation-link.flc-inlineEditable",
    ],
  },
  "faculty tab campus 1366": {
    spill: [
      "#tabLink_u#l#s#.portal-navigation-link",
      "#tabLink_u#l#s#.portal-navigation-link.flc-inlineEditable",
    ],
  },
  "faculty tab campus 1920": {
    spill: [
      "#tabLink_u#l#s#.portal-navigation-link",
      "#tabLink_u#l#s#.portal-navigation-link.flc-inlineEditable",
    ],
  },
  "faculty tab lms 768": {
    spill: [
      "#portalNavigation_u#l#s#.portal-navigation.movable.editable a.nav-tab-controls.portal-navigation-delete",
      "#tabLink_u#l#s#.portal-navigation-link",
      "#tabLink_u#l#s#.portal-navigation-link.flc-inlineEditable",
    ],
  },
  "faculty tab lms 1024": {
    spill: [
      "#portalNavigation_u#l#s#.portal-navigation.movable.editable a.nav-tab-controls.portal-navigation-delete",
      "#tabLink_u#l#s#.portal-navigation-link",
      "#tabLink_u#l#s#.portal-navigation-link.flc-inlineEditable",
    ],
  },
  "faculty tab lms 1366": {
    spill: [
      "#portalNavigation_u#l#s#.portal-navigation.movable.editable a.nav-tab-controls.portal-navigation-delete",
      "#tabLink_u#l#s#.portal-navigation-link",
      "#tabLink_u#l#s#.portal-navigation-link.flc-inlineEditable",
    ],
  },
  "faculty tab lms 1920": {
    spill: [
      "#portalNavigation_u#l#s#.portal-navigation.movable.editable a.nav-tab-controls.portal-navigation-delete",
      "#tabLink_u#l#s#.portal-navigation-link",
      "#tabLink_u#l#s#.portal-navigation-link.flc-inlineEditable",
    ],
  },
  "faculty tab welcome 320": {
    spill: [
      "#Pluto_#_u#l#n#_#_container.Pluto_#_u#l#n#_#_upcal-miniview.upcal-portlet.upcal-narrowview div.upcal-event-view",
    ],
  },
  "faculty tab welcome 390": {
    spill: [
      "#Pluto_#_u#l#n#_#_container.Pluto_#_u#l#n#_#_upcal-miniview.upcal-portlet.upcal-narrowview div.upcal-event-list",
      "#Pluto_#_u#l#n#_#_container.Pluto_#_u#l#n#_#_upcal-miniview.upcal-portlet.upcal-narrowview div.upcal-event-view",
      "#Pluto_#_u#l#n#_#_container.container.container-fluid.bootstrap-styles div.portlet-section-body",
    ],
  },
  "faculty tab welcome 768": {
    "cut-off": ["#file-uploader div.qq-upload-button.enabled_upload"],
    spill: [
      "#Pluto_#_u#l#n#_#_container.Pluto_#_u#l#n#_#_upcal-miniview.upcal-portlet.upcal-narrowview div.upcal-event-list",
      "#Pluto_#_u#l#n#_#_container.Pluto_#_u#l#n#_#_upcal-miniview.upcal-portlet.upcal-narrowview div.upcal-event-view",
      "#Pluto_#_u#l#n#_#_container.container.container-fluid.bootstrap-styles div.portlet-section-body",
      "#tabLink_u#l#s#.portal-navigation-link",
    ],
    spacing: ["#file-uploader div.qq-upload-button.enabled_upload"],
  },
  "faculty tab welcome 1024": {
    "cut-off": ["#file-uploader div.qq-upload-button.enabled_upload"],
    spill: [
      "#Pluto_#_u#l#n#_#_container.Pluto_#_u#l#n#_#_upcal-miniview.upcal-portlet.upcal-narrowview div.upcal-event-list",
      "#Pluto_#_u#l#n#_#_container.Pluto_#_u#l#n#_#_upcal-miniview.upcal-portlet.upcal-narrowview div.upcal-event-view",
      "#Pluto_#_u#l#n#_#_container.container.container-fluid.bootstrap-styles div.portlet-section-body",
      "#tabLink_u#l#s#.portal-navigation-link",
    ],
    spacing: ["#file-uploader div.qq-upload-button.enabled_upload"],
  },
  "faculty tab welcome 1366": {
    "cut-off": ["#file-uploader div.qq-upload-button.enabled_upload"],
    spill: [
      "#Pluto_#_u#l#n#_#_container.Pluto_#_u#l#n#_#_upcal-miniview.upcal-portlet.upcal-narrowview div.upcal-event-list",
      "#Pluto_#_u#l#n#_#_container.Pluto_#_u#l#n#_#_upcal-miniview.upcal-portlet.upcal-narrowview div.upcal-event-view",
      "#Pluto_#_u#l#n#_#_container.container.container-fluid.bootstrap-styles div.portlet-section-body",
      "#tabLink_u#l#s#.portal-navigation-link",
    ],
    spacing: ["#file-uploader div.qq-upload-button.enabled_upload"],
  },
  "faculty tab welcome 1920": {
    "cut-off": ["#file-uploader div.qq-upload-button.enabled_upload"],
    spill: [
      "#Pluto_#_u#l#n#_#_container.Pluto_#_u#l#n#_#_upcal-miniview.upcal-portlet.upcal-narrowview div.upcal-event-list",
      "#Pluto_#_u#l#n#_#_container.Pluto_#_u#l#n#_#_upcal-miniview.upcal-portlet.upcal-narrowview div.upcal-event-view",
      "#Pluto_#_u#l#n#_#_container.container.container-fluid.bootstrap-styles div.portlet-section-body",
      "#tabLink_u#l#s#.portal-navigation-link",
    ],
    spacing: ["#file-uploader div.qq-upload-button.enabled_upload"],
  },
  "guest login 320": {
    spill: ["#Pluto_#_ctf#_#_search.portlet-section form"],
  },
  "guest login 390": {
    spill: ["#Pluto_#_ctf#_#_search.portlet-section form"],
  },
  "guest login 768": {
    spill: ["#Pluto_#_ctf#_#_search.portlet-section form"],
  },
  "guest login 1024": {
    spill: ["#Pluto_#_ctf#_#_search.portlet-section form"],
  },
  "guest login 1366": {
    spill: ["#Pluto_#_ctf#_#_search.portlet-section form"],
  },
  "guest login 1920": {
    spill: ["#Pluto_#_ctf#_#_search.portlet-section form"],
  },
  "staff tab main-staff-tab 320": {
    "cut-off": [
      "#portletContent_u#l#n#.fl-widget-content.fl-fix.up-portlet-content-wrapper",
    ],
    spill: [
      "#portletContent_u#l#n#.fl-widget-content.fl-fix.up-portlet-content-wrapper p",
    ],
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
    ],
    spacing: [
      "#portletContent_u#l#n#.fl-widget-content.fl-fix.up-portlet-content-wrapper",
    ],
  },
  "staff tab main-staff-tab 768": {
    "cut-off": [
      "#portletContent_u#l#n#.fl-widget-content.fl-fix.up-portlet-content-wrapper",
    ],
    spill: [
      "#portletContent_u#l#n#.fl-widget-content.fl-fix.up-portlet-content-wrapper p",
      "#tabLink_u#l#s#.portal-navigation-link.flc-inlineEditable",
    ],
    spacing: [
      "#portletContent_u#l#n#.fl-widget-content.fl-fix.up-portlet-content-wrapper",
    ],
  },
  "staff tab main-staff-tab 1024": {
    spill: ["#tabLink_u#l#s#.portal-navigation-link.flc-inlineEditable"],
  },
  "staff tab main-staff-tab 1366": {
    spill: ["#tabLink_u#l#s#.portal-navigation-link.flc-inlineEditable"],
  },
  "staff tab main-staff-tab 1920": {
    spill: ["#tabLink_u#l#s#.portal-navigation-link.flc-inlineEditable"],
  },
  "staff tab welcome 320": {
    spill: [
      "#Pluto_#_u#l#n#_#_container.Pluto_#_u#l#n#_#_upcal-miniview.upcal-portlet.upcal-narrowview div.upcal-event-view",
    ],
  },
  "staff tab welcome 390": {
    spill: [
      "#Pluto_#_u#l#n#_#_container.Pluto_#_u#l#n#_#_upcal-miniview.upcal-portlet.upcal-narrowview div.upcal-event-list",
      "#Pluto_#_u#l#n#_#_container.Pluto_#_u#l#n#_#_upcal-miniview.upcal-portlet.upcal-narrowview div.upcal-event-view",
      "#Pluto_#_u#l#n#_#_container.container.container-fluid.bootstrap-styles div.portlet-section-body",
    ],
  },
  "staff tab welcome 768": {
    "cut-off": ["#file-uploader div.qq-upload-button.enabled_upload"],
    spill: [
      "#Pluto_#_u#l#n#_#_container.Pluto_#_u#l#n#_#_upcal-miniview.upcal-portlet.upcal-narrowview div.upcal-event-list",
      "#Pluto_#_u#l#n#_#_container.Pluto_#_u#l#n#_#_upcal-miniview.upcal-portlet.upcal-narrowview div.upcal-event-view",
      "#Pluto_#_u#l#n#_#_container.container.container-fluid.bootstrap-styles div.portlet-section-body",
      "#tabLink_u#l#s#.portal-navigation-link",
    ],
    spacing: ["#file-uploader div.qq-upload-button.enabled_upload"],
  },
  "staff tab welcome 1024": {
    "cut-off": ["#file-uploader div.qq-upload-button.enabled_upload"],
    spill: [
      "#Pluto_#_u#l#n#_#_container.Pluto_#_u#l#n#_#_upcal-miniview.upcal-portlet.upcal-narrowview div.upcal-event-list",
      "#Pluto_#_u#l#n#_#_container.Pluto_#_u#l#n#_#_upcal-miniview.upcal-portlet.upcal-narrowview div.upcal-event-view",
      "#Pluto_#_u#l#n#_#_container.container.container-fluid.bootstrap-styles div.portlet-section-body",
      "#tabLink_u#l#s#.portal-navigation-link",
    ],
    spacing: ["#file-uploader div.qq-upload-button.enabled_upload"],
  },
  "staff tab welcome 1366": {
    "cut-off": ["#file-uploader div.qq-upload-button.enabled_upload"],
    spill: [
      "#Pluto_#_u#l#n#_#_container.Pluto_#_u#l#n#_#_upcal-miniview.upcal-portlet.upcal-narrowview div.upcal-event-list",
      "#Pluto_#_u#l#n#_#_container.Pluto_#_u#l#n#_#_upcal-miniview.upcal-portlet.upcal-narrowview div.upcal-event-view",
      "#Pluto_#_u#l#n#_#_container.container.container-fluid.bootstrap-styles div.portlet-section-body",
      "#tabLink_u#l#s#.portal-navigation-link",
    ],
    spacing: ["#file-uploader div.qq-upload-button.enabled_upload"],
  },
  "staff tab welcome 1920": {
    "cut-off": ["#file-uploader div.qq-upload-button.enabled_upload"],
    spill: [
      "#Pluto_#_u#l#n#_#_container.Pluto_#_u#l#n#_#_upcal-miniview.upcal-portlet.upcal-narrowview div.upcal-event-list",
      "#Pluto_#_u#l#n#_#_container.Pluto_#_u#l#n#_#_upcal-miniview.upcal-portlet.upcal-narrowview div.upcal-event-view",
      "#Pluto_#_u#l#n#_#_container.container.container-fluid.bootstrap-styles div.portlet-section-body",
      "#tabLink_u#l#s#.portal-navigation-link",
    ],
    spacing: ["#file-uploader div.qq-upload-button.enabled_upload"],
  },
  "student tab academics 768": {
    spill: [
      "#portalNavigation_u#l#s#.portal-navigation.movable.editable a.nav-tab-controls.portal-navigation-delete",
      "#tabLink_u#l#s#.portal-navigation-link",
      "#tabLink_u#l#s#.portal-navigation-link.flc-inlineEditable",
    ],
  },
  "student tab academics 1024": {
    spill: [
      "#portalNavigation_u#l#s#.portal-navigation.movable.editable a.nav-tab-controls.portal-navigation-delete",
      "#tabLink_u#l#s#.portal-navigation-link",
      "#tabLink_u#l#s#.portal-navigation-link.flc-inlineEditable",
    ],
  },
  "student tab academics 1366": {
    spill: [
      "#portalNavigation_u#l#s#.portal-navigation.movable.editable a.nav-tab-controls.portal-navigation-delete",
      "#tabLink_u#l#s#.portal-navigation-link",
      "#tabLink_u#l#s#.portal-navigation-link.flc-inlineEditable",
    ],
  },
  "student tab academics 1920": {
    spill: [
      "#portalNavigation_u#l#s#.portal-navigation.movable.editable a.nav-tab-controls.portal-navigation-delete",
      "#tabLink_u#l#s#.portal-navigation-link",
      "#tabLink_u#l#s#.portal-navigation-link.flc-inlineEditable",
    ],
  },
  "student tab campus 768": {
    spill: [
      "#tabLink_u#l#s#.portal-navigation-link",
      "#tabLink_u#l#s#.portal-navigation-link.flc-inlineEditable",
    ],
  },
  "student tab campus 1024": {
    spill: [
      "#tabLink_u#l#s#.portal-navigation-link",
      "#tabLink_u#l#s#.portal-navigation-link.flc-inlineEditable",
    ],
  },
  "student tab campus 1366": {
    spill: [
      "#tabLink_u#l#s#.portal-navigation-link",
      "#tabLink_u#l#s#.portal-navigation-link.flc-inlineEditable",
    ],
  },
  "student tab campus 1920": {
    spill: [
      "#tabLink_u#l#s#.portal-navigation-link",
      "#tabLink_u#l#s#.portal-navigation-link.flc-inlineEditable",
    ],
  },
  "student tab lms 768": {
    spill: [
      "#portalNavigation_u#l#s#.portal-navigation.movable.editable a.nav-tab-controls.portal-navigation-delete",
      "#tabLink_u#l#s#.portal-navigation-link",
      "#tabLink_u#l#s#.portal-navigation-link.flc-inlineEditable",
    ],
  },
  "student tab lms 1024": {
    spill: [
      "#portalNavigation_u#l#s#.portal-navigation.movable.editable a.nav-tab-controls.portal-navigation-delete",
      "#tabLink_u#l#s#.portal-navigation-link",
      "#tabLink_u#l#s#.portal-navigation-link.flc-inlineEditable",
    ],
  },
  "student tab lms 1366": {
    spill: [
      "#portalNavigation_u#l#s#.portal-navigation.movable.editable a.nav-tab-controls.portal-navigation-delete",
      "#tabLink_u#l#s#.portal-navigation-link",
      "#tabLink_u#l#s#.portal-navigation-link.flc-inlineEditable",
    ],
  },
  "student tab lms 1920": {
    spill: [
      "#portalNavigation_u#l#s#.portal-navigation.movable.editable a.nav-tab-controls.portal-navigation-delete",
      "#tabLink_u#l#s#.portal-navigation-link",
      "#tabLink_u#l#s#.portal-navigation-link.flc-inlineEditable",
    ],
  },
  "student tab welcome 320": {
    spill: [
      "#Pluto_#_u#l#n#_#_container.Pluto_#_u#l#n#_#_upcal-miniview.upcal-portlet.upcal-narrowview div.upcal-event-view",
    ],
  },
  "student tab welcome 390": {
    spill: [
      "#Pluto_#_u#l#n#_#_container.Pluto_#_u#l#n#_#_upcal-miniview.upcal-portlet.upcal-narrowview div.upcal-event-list",
      "#Pluto_#_u#l#n#_#_container.Pluto_#_u#l#n#_#_upcal-miniview.upcal-portlet.upcal-narrowview div.upcal-event-view",
      "#Pluto_#_u#l#n#_#_container.container.container-fluid.bootstrap-styles div.portlet-section-body",
    ],
  },
  "student tab welcome 768": {
    "cut-off": ["#file-uploader div.qq-upload-button.enabled_upload"],
    spill: [
      "#Pluto_#_u#l#n#_#_container.Pluto_#_u#l#n#_#_upcal-miniview.upcal-portlet.upcal-narrowview div.upcal-event-list",
      "#Pluto_#_u#l#n#_#_container.Pluto_#_u#l#n#_#_upcal-miniview.upcal-portlet.upcal-narrowview div.upcal-event-view",
      "#Pluto_#_u#l#n#_#_container.container.container-fluid.bootstrap-styles div.portlet-section-body",
      "#tabLink_u#l#s#.portal-navigation-link",
    ],
    spacing: ["#file-uploader div.qq-upload-button.enabled_upload"],
  },
  "student tab welcome 1024": {
    "cut-off": ["#file-uploader div.qq-upload-button.enabled_upload"],
    spill: [
      "#Pluto_#_u#l#n#_#_container.Pluto_#_u#l#n#_#_upcal-miniview.upcal-portlet.upcal-narrowview div.upcal-event-list",
      "#Pluto_#_u#l#n#_#_container.Pluto_#_u#l#n#_#_upcal-miniview.upcal-portlet.upcal-narrowview div.upcal-event-view",
      "#Pluto_#_u#l#n#_#_container.container.container-fluid.bootstrap-styles div.portlet-section-body",
      "#tabLink_u#l#s#.portal-navigation-link",
    ],
    spacing: ["#file-uploader div.qq-upload-button.enabled_upload"],
  },
  "student tab welcome 1366": {
    "cut-off": ["#file-uploader div.qq-upload-button.enabled_upload"],
    spill: [
      "#Pluto_#_u#l#n#_#_container.Pluto_#_u#l#n#_#_upcal-miniview.upcal-portlet.upcal-narrowview div.upcal-event-list",
      "#Pluto_#_u#l#n#_#_container.Pluto_#_u#l#n#_#_upcal-miniview.upcal-portlet.upcal-narrowview div.upcal-event-view",
      "#Pluto_#_u#l#n#_#_container.container.container-fluid.bootstrap-styles div.portlet-section-body",
      "#tabLink_u#l#s#.portal-navigation-link",
    ],
    spacing: ["#file-uploader div.qq-upload-button.enabled_upload"],
  },
  "student tab welcome 1920": {
    "cut-off": ["#file-uploader div.qq-upload-button.enabled_upload"],
    spill: [
      "#Pluto_#_u#l#n#_#_container.Pluto_#_u#l#n#_#_upcal-miniview.upcal-portlet.upcal-narrowview div.upcal-event-list",
      "#Pluto_#_u#l#n#_#_container.Pluto_#_u#l#n#_#_upcal-miniview.upcal-portlet.upcal-narrowview div.upcal-event-view",
      "#Pluto_#_u#l#n#_#_container.container.container-fluid.bootstrap-styles div.portlet-section-body",
      "#tabLink_u#l#s#.portal-navigation-link",
    ],
    spacing: ["#file-uploader div.qq-upload-button.enabled_upload"],
  },
};
