/*
 * Accessibility violations recorded on the 6.0 integration branch (5.17.10
 * behaviour), by page, axe rule and node
 * (see key-pages.a11y.ts). Recorded from Integration run 38100770775 (the
 * "a11y observed" annotations); keep it sorted. The fixes of MOD-I252 removed
 * the entries they fixed; the ones left come from the esco-content-menu
 * webjar and the Calendar portlet.
 */
export const baseline: Record<string, Record<string, string[]>> = {
  "admin-home": {
    "select-name": ["esco-content-grid >>> select"],
  },
  "faculty-home": {
    label: [".upcal-date-input", 'input[multiple="multiple"]'],
  },
  "staff-home": {
    label: [".upcal-date-input", 'input[multiple="multiple"]'],
  },
  "student-home": {
    label: [".upcal-date-input", 'input[multiple="multiple"]'],
  },
};
