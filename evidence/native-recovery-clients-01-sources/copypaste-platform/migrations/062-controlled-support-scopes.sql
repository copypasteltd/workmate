-- Forward only. Legacy support records are retained byte-for-byte and cannot
-- become scoped customer views without a new, explicit canonical command.
CREATE TABLE support_grants (
 id uuid PRIMARY KEY DEFAULT gen_random_uuid(), tenant_id uuid NOT NULL REFERENCES tenants(id),
 granted_by uuid NOT NULL REFERENCES users(id), issuer_auth_version integer NOT NULL CHECK(issuer_auth_version>0),
 issuer_membership_version integer NOT NULL CHECK(issuer_membership_version>0),
 project_ids uuid[] NOT NULL CHECK(cardinality(project_ids)<=100 AND array_position(project_ids,NULL) IS NULL),
 reason text NOT NULL CHECK(length(btrim(reason))>0),
 data_mode text NOT NULL CHECK(data_mode IN ('simulated','configured_services')),
 created_at timestamptz NOT NULL DEFAULT clock_timestamp(), expires_at timestamptz NOT NULL,
 revoked_at timestamptz, CHECK(expires_at>created_at AND expires_at<=created_at+interval '1 hour'),
 CHECK(revoked_at IS NULL OR revoked_at>=created_at)
);
CREATE INDEX support_grants_scope ON support_grants(tenant_id,data_mode,created_at DESC,id DESC);
CREATE TABLE support_session_contexts (
 id uuid PRIMARY KEY REFERENCES support_sessions(id), actor_session_id uuid NOT NULL REFERENCES sessions(id),
 target_user_id uuid NOT NULL REFERENCES users(id), target_auth_version integer NOT NULL CHECK(target_auth_version>0),
 target_membership_version integer NOT NULL CHECK(target_membership_version>0),
 project_ids uuid[] NOT NULL CHECK(cardinality(project_ids)<=100 AND array_position(project_ids,NULL) IS NULL),
 support_grant_id uuid REFERENCES support_grants(id),
 data_mode text NOT NULL CHECK(data_mode IN ('simulated','configured_services')),
 created_at timestamptz NOT NULL DEFAULT clock_timestamp()
);
CREATE INDEX support_session_contexts_created ON support_session_contexts(data_mode,created_at DESC,id DESC);

CREATE FUNCTION support_target_current(w uuid,recipient uuid,av integer,mv integer,projects uuid[]) RETURNS boolean
 LANGUAGE sql STABLE SECURITY DEFINER SET search_path=pg_catalog,public AS $$
 SELECT EXISTS(SELECT 1 FROM memberships m JOIN users u ON u.id=m.user_id JOIN tenants t ON t.id=m.tenant_id
 WHERE m.tenant_id=w AND m.user_id=recipient AND m.status='active' AND NOT m.admin_suspended
 AND m.version=mv AND u.auth_version=av AND u.status='active' AND u.admin_closed_at IS NULL
 AND t.status='active' AND t.admin_closed_at IS NULL
 AND cardinality(projects)=(SELECT count(DISTINCT x) FROM unnest(projects) x)
 AND NOT EXISTS(SELECT 1 FROM unnest(projects) x WHERE NOT EXISTS(SELECT 1 FROM public.projects p
   WHERE p.id=x AND p.tenant_id=w AND NOT p.archived AND (m.role IN ('owner','admin')
      OR EXISTS(SELECT 1 FROM project_members pm WHERE pm.project_id=p.id AND pm.user_id=recipient)))))
$$;
ALTER FUNCTION support_target_current(uuid,uuid,integer,integer,uuid[]) OWNER TO cp_control;
REVOKE ALL ON FUNCTION support_target_current(uuid,uuid,integer,integer,uuid[]) FROM PUBLIC;
CREATE FUNCTION support_grant_current(grant_id uuid) RETURNS boolean
 LANGUAGE sql STABLE SECURITY DEFINER SET search_path=pg_catalog,public AS $$
 SELECT EXISTS(SELECT 1 FROM support_grants g JOIN memberships m ON m.tenant_id=g.tenant_id AND m.user_id=g.granted_by
 WHERE g.id=grant_id AND g.revoked_at IS NULL AND g.expires_at>clock_timestamp() AND m.role IN ('owner','admin')
 AND support_target_current(g.tenant_id,g.granted_by,g.issuer_auth_version,g.issuer_membership_version,g.project_ids))
$$;
ALTER FUNCTION support_grant_current(uuid) OWNER TO cp_control;
REVOKE ALL ON FUNCTION support_grant_current(uuid) FROM PUBLIC;

CREATE FUNCTION guard_support_scope() RETURNS trigger
 LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog,public AS $$
DECLARE parent support_sessions%ROWTYPE; grant_row support_grants%ROWTYPE;
BEGIN
 IF TG_OP='DELETE' THEN RAISE EXCEPTION 'Support provenance cannot be removed' USING ERRCODE='23514'; END IF;
 IF TG_TABLE_NAME='support_grants' THEN
  IF TG_OP='UPDATE' THEN
   IF (to_jsonb(NEW)-'revoked_at') IS DISTINCT FROM (to_jsonb(OLD)-'revoked_at')
    OR (OLD.revoked_at IS NOT NULL AND NEW.revoked_at IS DISTINCT FROM OLD.revoked_at)
    OR (NEW.revoked_at IS NOT NULL AND NEW.revoked_at>clock_timestamp()) THEN
    RAISE EXCEPTION 'Support grant and revocation are immutable' USING ERRCODE='23514';
   END IF;
   RETURN NEW;
  END IF;
  IF NEW.revoked_at IS NOT NULL OR NEW.created_at>clock_timestamp()
    OR NOT support_target_current(NEW.tenant_id,NEW.granted_by,NEW.issuer_auth_version,NEW.issuer_membership_version,NEW.project_ids)
    OR NOT EXISTS(SELECT 1 FROM memberships WHERE tenant_id=NEW.tenant_id AND user_id=NEW.granted_by AND role IN ('owner','admin'))
    OR NOT EXISTS(SELECT 1 FROM tenants WHERE id=NEW.tenant_id AND data_mode=NEW.data_mode) THEN
   RAISE EXCEPTION 'Support grant requires its current issuer and exact scope' USING ERRCODE='23514';
  END IF;
 ELSE
  IF TG_OP='UPDATE' THEN RAISE EXCEPTION 'Support context is immutable' USING ERRCODE='23514'; END IF;
  SELECT * INTO parent FROM support_sessions WHERE id=NEW.id;
  IF parent.id IS NULL OR parent.revoked_at IS NOT NULL OR parent.body_granted
   OR parent.expires_at<=clock_timestamp() OR parent.expires_at>NEW.created_at+interval '1 hour'
   OR NEW.created_at>clock_timestamp()
   OR NOT support_target_current(parent.tenant_id,NEW.target_user_id,NEW.target_auth_version,NEW.target_membership_version,NEW.project_ids)
   OR NOT EXISTS(SELECT 1 FROM sessions s JOIN admin_principals a ON a.id=s.admin_id
      WHERE s.id=NEW.actor_session_id AND a.id=parent.principal_id AND s.audience='admin'
      AND s.auth_version=a.auth_version AND a.status='active' AND a.enrollment_state='enrolled'
      AND s.revoked_at IS NULL AND s.expires_at>clock_timestamp() AND s.mfa_at>clock_timestamp()-interval '10 minutes')
   OR NOT EXISTS(SELECT 1 FROM tenants WHERE id=parent.tenant_id AND data_mode=NEW.data_mode) THEN
   RAISE EXCEPTION 'Support context requires current identities and exact scope' USING ERRCODE='23514';
  END IF;
  IF NEW.support_grant_id IS NOT NULL THEN
   SELECT * INTO grant_row FROM support_grants WHERE id=NEW.support_grant_id;
   IF grant_row.id IS NULL OR grant_row.tenant_id<>parent.tenant_id OR grant_row.data_mode<>NEW.data_mode
     OR NOT support_grant_current(grant_row.id) OR NOT NEW.project_ids<@grant_row.project_ids
     OR parent.expires_at>grant_row.expires_at THEN
    RAISE EXCEPTION 'Support context exceeds its explicit grant' USING ERRCODE='23514';
   END IF;
  END IF;
 END IF;
 RETURN NEW;
END $$;
ALTER FUNCTION guard_support_scope() OWNER TO cp_control;
REVOKE ALL ON FUNCTION guard_support_scope() FROM PUBLIC;
CREATE TRIGGER support_grant_guard BEFORE INSERT OR UPDATE OR DELETE ON support_grants FOR EACH ROW EXECUTE FUNCTION guard_support_scope();
CREATE TRIGGER support_context_guard BEFORE INSERT OR UPDATE OR DELETE ON support_session_contexts FOR EACH ROW EXECUTE FUNCTION guard_support_scope();
CREATE FUNCTION guard_canonical_support_session() RETURNS trigger
 LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog,public AS $$
BEGIN
 IF EXISTS(SELECT 1 FROM support_session_contexts WHERE id=OLD.id) THEN
  IF TG_OP='DELETE' THEN RAISE EXCEPTION 'Canonical support history cannot be removed' USING ERRCODE='23514'; END IF;
  IF ROW(NEW.id,NEW.principal_id,NEW.tenant_id,NEW.reason,NEW.expires_at,NEW.body_granted)
    IS DISTINCT FROM ROW(OLD.id,OLD.principal_id,OLD.tenant_id,OLD.reason,OLD.expires_at,OLD.body_granted)
    OR (OLD.revoked_at IS NOT NULL AND NEW.revoked_at IS DISTINCT FROM OLD.revoked_at)
    OR (NEW.revoked_at IS NOT NULL AND NEW.revoked_at>clock_timestamp()) THEN
   RAISE EXCEPTION 'Canonical support identity, deadline and revocation are immutable' USING ERRCODE='23514';
  END IF;
 END IF;
 RETURN CASE WHEN TG_OP='DELETE' THEN OLD ELSE NEW END;
END $$;
ALTER FUNCTION guard_canonical_support_session() OWNER TO cp_control;
REVOKE ALL ON FUNCTION guard_canonical_support_session() FROM PUBLIC;
CREATE TRIGGER canonical_support_session_guard BEFORE UPDATE OR DELETE ON support_sessions FOR EACH ROW EXECUTE FUNCTION guard_canonical_support_session();

ALTER TABLE support_grants ENABLE ROW LEVEL SECURITY;
ALTER TABLE support_grants FORCE ROW LEVEL SECURITY;
ALTER TABLE support_session_contexts ENABLE ROW LEVEL SECURITY;
ALTER TABLE support_session_contexts FORCE ROW LEVEL SECURITY;
CREATE POLICY support_grants_control ON support_grants TO cp_control USING(true) WITH CHECK(true);
CREATE POLICY support_contexts_control ON support_session_contexts TO cp_control USING(true) WITH CHECK(true);
REVOKE ALL ON support_grants,support_session_contexts FROM PUBLIC,cp_app;
GRANT SELECT,INSERT ON support_grants,support_session_contexts TO cp_control;
GRANT UPDATE(revoked_at) ON support_grants TO cp_control;
