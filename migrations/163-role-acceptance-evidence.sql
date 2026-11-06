-- Professional evidence is append-only. Counts are never professional approval.
CREATE TABLE role_acceptance_evidence (
 id uuid PRIMARY KEY DEFAULT gen_random_uuid(), template_version_id uuid NOT NULL REFERENCES agent_template_versions(id),
 task_id uuid NOT NULL REFERENCES tasks(id), case_kind text NOT NULL CHECK(case_kind IN ('normal','revision','boundary')),
 decision text NOT NULL CHECK(decision IN ('passed','failed')), comment text NOT NULL CHECK(length(comment) BETWEEN 10 AND 5000),
 proof jsonb NOT NULL, proof_hash text NOT NULL CHECK(proof_hash ~ '^[a-f0-9]{64}$'),
 reviewer_id uuid NOT NULL REFERENCES admin_principals(id), created_at timestamptz NOT NULL DEFAULT now(),
 revoked_at timestamptz, revoked_by uuid REFERENCES admin_principals(id), revocation_reason text,
 CHECK ((revoked_at IS NULL AND revoked_by IS NULL AND revocation_reason IS NULL) OR
  (revoked_at IS NOT NULL AND revoked_by IS NOT NULL AND length(revocation_reason) BETWEEN 3 AND 1000))
);
CREATE INDEX role_acceptance_order ON role_acceptance_evidence(template_version_id,created_at DESC,id DESC);
CREATE UNIQUE INDEX role_acceptance_active_task ON role_acceptance_evidence(template_version_id,task_id,case_kind) WHERE revoked_at IS NULL;
CREATE FUNCTION role_acceptance_immutable() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
 IF TG_OP='DELETE' OR (to_jsonb(NEW)-ARRAY['revoked_at','revoked_by','revocation_reason']) IS DISTINCT FROM
  (to_jsonb(OLD)-ARRAY['revoked_at','revoked_by','revocation_reason']) OR OLD.revoked_at IS NOT NULL THEN
  RAISE EXCEPTION 'Acceptance evidence is immutable; revoke it with an audit reason' USING ERRCODE='23514';
 END IF;
 RETURN NEW;
END $$;
CREATE TRIGGER role_acceptance_immutable BEFORE UPDATE OR DELETE ON role_acceptance_evidence FOR EACH ROW EXECUTE FUNCTION role_acceptance_immutable();
REVOKE ALL ON role_acceptance_evidence FROM PUBLIC,cp_app;
GRANT SELECT,INSERT ON role_acceptance_evidence TO cp_control;
GRANT UPDATE(revoked_at,revoked_by,revocation_reason) ON role_acceptance_evidence TO cp_control;
CREATE FUNCTION role_acceptance_counts() RETURNS TABLE(template_version_id uuid,passed bigint,failed bigint,case_kinds text[],latest_at timestamptz)
 LANGUAGE sql STABLE SECURITY DEFINER SET search_path=pg_catalog,public AS $$
 SELECT e.template_version_id,count(*) FILTER(WHERE decision='passed'),count(*) FILTER(WHERE decision='failed'),
 array_agg(DISTINCT case_kind) FILTER(WHERE decision='passed'),max(created_at)
 FROM public.role_acceptance_evidence e WHERE revoked_at IS NULL GROUP BY e.template_version_id
$$;
REVOKE ALL ON FUNCTION role_acceptance_counts() FROM PUBLIC;
GRANT EXECUTE ON FUNCTION role_acceptance_counts() TO cp_app,cp_control;
