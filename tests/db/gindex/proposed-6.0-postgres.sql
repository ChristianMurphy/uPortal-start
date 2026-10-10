-- G-index (MOD-D12): the proposed 6.0 index changes, as PostgreSQL DDL against the 5.17 schema.
-- Apply to a loaded G-index database to measure them:
--   tests/db/gindex/gindex.sh --reuse --ddl tests/db/gindex/proposed-6.0-postgres.sql postgres-18
-- The R numbers are those of docs/developer/modernization/notes/g-index.md. In 6.0 these become
-- @Index declarations (MOD-D11) with clean names; the names here are placeholders.

-- R1: every local-account lookup (login) joins UP_PERSON_ATTR on USER_DIR_ID
CREATE INDEX up_person_attr_user_dir_idx ON up_person_attr (user_dir_id);

-- R2: deleting a portlet definition or an entity's preferences checks UP_PORTLET_ENT
CREATE INDEX up_portlet_ent_def_idx ON up_portlet_ent (portlet_def_id);
CREATE INDEX up_portlet_ent_prefs_idx ON up_portlet_ent (portlet_prefs_id);

-- R3: the expired-cookie purge deletes portal cookies, checked against their portlet cookies
CREATE INDEX up_portlet_cookies_portal_idx ON up_portlet_cookies (portalcookie_portal_cookie_id);

-- R4: closing an aggregation interval deletes its unique strings
CREATE INDEX up_login_event_aggr_ustr_idx ON up_login_event_aggr (unique_strings_id);
CREATE INDEX up_concurrent_user_aggr_ustr_idx ON up_concurrent_user_aggr (unique_strings_id);
CREATE INDEX up_unique_str_segment_str_idx ON up_unique_str_segment (unique_str_id);

-- R5: a portlet definition's parameters and lifecycle are loaded by PORTLET_DEF_ID
CREATE INDEX up_portlet_def_param_def_idx ON up_portlet_def_param (portlet_def_id);
CREATE INDEX up_portlet_lifecycle_def_idx ON up_portlet_lifecycle (portlet_def_id);

-- R8: indexes another index already covers. The idx_up_*_grp indexes on AGGR_GROUP_ID are covered
-- by each table's (AGGR_GROUP_ID, ...) unique key too, but the aggregation job's DISTINCT group
-- query (R7) reads the narrow index whole: dropping them before R7 changes that query turns its
-- index-only scan into a full table scan (G-index found that); they go with R7.
DROP INDEX idx_up_plt_exec_aggr_dti;
DROP INDEX idx_up_tab_rend_aggr_dti;
DROP INDEX idx_message__code;

-- R9: UP_RAW_EVENTS takes 5 million inserts and 5 million AGGREGATED updates a day. Only the
-- timestamp is ever queried (JpaPortalEventStore: by time range, unaggregated by time range,
-- min/max, delete before a time), and idx_up_raw_events_timestamp serves all of them; the
-- session, server, user and flag indexes are never used. Without an index on AGGREGATED the
-- flag update can be a HOT update.
DROP INDEX idx_up_raw_events_session_id;
DROP INDEX idx_up_raw_events_server_id;
DROP INDEX idx_up_raw_events_user_name;
DROP INDEX idx_up_raw_events_err_aggr;
DROP INDEX idx_up_raw_events_aggregated;
