-- SQL001-101 retain their published bytes. Model arguments cannot supply
-- customer authorization; every new operation binds a separate session action.
CREATE TABLE audio_authorizations (
 id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
 tenant_id uuid NOT NULL REFERENCES tenants(id),project_id uuid NOT NULL REFERENCES projects(id),
 task_id uuid NOT NULL REFERENCES tasks(id),actor_id uuid NOT NULL REFERENCES users(id),
 actor_auth_version integer NOT NULL,private_owner uuid REFERENCES users(id),
 origin_fencing uuid NOT NULL,origin_attempt integer NOT NULL CHECK(origin_attempt>0),
 data_mode text NOT NULL CHECK(data_mode IN('simulated','configured_services')),
 call_id text NOT NULL CHECK(length(call_id) BETWEEN 1 AND 200),
 capability_version_id uuid NOT NULL REFERENCES internal_capability_versions(id),
 model_alias text NOT NULL,gateway_fingerprint text NOT NULL,
 specification jsonb NOT NULL CHECK(jsonb_typeof(specification)='object'),
 specification_hash text NOT NULL CHECK(specification_hash ~ '^[a-f0-9]{64}$'),
 source_asset_id uuid,source_version integer,source_sha256 text,source_probe jsonb,
 quoted_units bigint NOT NULL CHECK(quoted_units BETWEEN 1 AND 600000),
 rate_micros bigint NOT NULL CHECK(rate_micros BETWEEN 1 AND 1000000000),
 quoted_micros bigint NOT NULL CHECK(quoted_micros BETWEEN 1 AND 9007199254740991),
 state text NOT NULL DEFAULT 'pending' CHECK(state IN('pending','confirmed','declined','withdrawn','expired','cancelled')),
 revision integer NOT NULL DEFAULT 1 CHECK(revision>0),
 confirmed_by uuid REFERENCES users(id),confirmed_session_id uuid REFERENCES sessions(id),confirmed_at timestamptz,
 confirmation jsonb NOT NULL DEFAULT '{}' CHECK(jsonb_typeof(confirmation)='object'),
 confirmation_hash text CHECK(confirmation_hash ~ '^[a-f0-9]{64}$'),
 decision_reason text,decided_by uuid REFERENCES users(id),decided_at timestamptz,
 created_at timestamptz NOT NULL DEFAULT clock_timestamp(),
 expires_at timestamptz NOT NULL DEFAULT clock_timestamp()+interval '5 minutes',
 erased_at timestamptz,
 UNIQUE(task_id,call_id),UNIQUE(task_id,specification_hash,capability_version_id),
 FOREIGN KEY(source_asset_id,source_version) REFERENCES asset_versions(asset_id,version),
 CHECK(quoted_micros::numeric=quoted_units::numeric*rate_micros::numeric),
 CHECK(expires_at>created_at AND expires_at<=created_at+interval '6 minutes'),
 CHECK((confirmed_by IS NULL AND confirmed_session_id IS NULL AND confirmed_at IS NULL AND confirmation_hash IS NULL)
  OR (confirmed_by=actor_id AND confirmed_session_id IS NOT NULL AND confirmed_at IS NOT NULL AND confirmation_hash IS NOT NULL)),
 CHECK(state<>'confirmed' OR confirmed_by IS NOT NULL),
 CHECK((source_asset_id IS NULL AND source_version IS NULL AND source_sha256 IS NULL AND source_probe IS NULL)
  OR (source_asset_id IS NOT NULL AND source_version>0 AND source_sha256 ~ '^[a-f0-9]{64}$' AND source_probe IS NOT NULL))
);
CREATE INDEX audio_authorizations_task ON audio_authorizations(task_id,created_at DESC,id);
ALTER TABLE ai_audio_jobs ADD COLUMN authorization_id uuid REFERENCES audio_authorizations(id);
CREATE UNIQUE INDEX ai_audio_job_one_authorization ON ai_audio_jobs(authorization_id) WHERE authorization_id IS NOT NULL;
CREATE TABLE audio_authorization_events (
 id uuid PRIMARY KEY DEFAULT gen_random_uuid(),authorization_id uuid NOT NULL REFERENCES audio_authorizations(id),
 state text NOT NULL,revision integer NOT NULL,actor_id uuid REFERENCES users(id),
 specification_hash text NOT NULL,confirmation_hash text,created_at timestamptz NOT NULL DEFAULT clock_timestamp(),
 UNIQUE(authorization_id,revision)
);
CREATE TRIGGER immutable_audio_authorization_events BEFORE UPDATE OR DELETE ON audio_authorization_events
 FOR EACH ROW EXECUTE FUNCTION guard_ai_gateway_history();

CREATE FUNCTION guard_audio_authorization() RETURNS trigger LANGUAGE plpgsql AS $$
DECLARE t tasks; s sessions;
BEGIN
 IF TG_OP='DELETE' THEN RAISE EXCEPTION 'Retained audio authorization cannot be deleted' USING ERRCODE='23514'; END IF;
 SELECT * INTO STRICT t FROM tasks WHERE id=NEW.task_id;
 IF TG_OP='INSERT' THEN
  IF NEW.state<>'pending' OR NEW.revision<>1 OR NEW.confirmed_by IS NOT NULL OR NEW.confirmation<>'{}'::jsonb
   OR NEW.tenant_id<>t.tenant_id OR NEW.project_id<>t.project_id OR NEW.actor_id<>t.created_by
   OR NEW.actor_auth_version<>t.actor_auth_version OR NEW.private_owner IS DISTINCT FROM t.private_owner
   OR NEW.origin_fencing IS DISTINCT FROM t.fencing_token OR NEW.origin_attempt<>t.attempt OR NEW.data_mode<>t.data_mode
   OR t.status<>'running' OR t.mode<>'execute' OR t.cancel_requested OR t.content_state<>'active' OR t.lease_until<=clock_timestamp()
   OR t.id IS DISTINCT FROM nullif(current_setting('app.task_id',true),'')::uuid
   OR t.created_by IS DISTINCT FROM nullif(current_setting('app.actor_id',true),'')::uuid
   OR t.tenant_id IS DISTINCT FROM nullif(current_setting('app.tenant_id',true),'')::uuid
  THEN RAISE EXCEPTION 'Invalid audio authorization proposal' USING ERRCODE='42501'; END IF;
 ELSE
  IF NEW.revision<>OLD.revision+1 OR
   (to_jsonb(NEW)-ARRAY['state','revision','confirmed_by','confirmed_session_id','confirmed_at','confirmation','confirmation_hash',
    'decision_reason','decided_by','decided_at','specification','erased_at'])
   IS DISTINCT FROM
   (to_jsonb(OLD)-ARRAY['state','revision','confirmed_by','confirmed_session_id','confirmed_at','confirmation','confirmation_hash',
    'decision_reason','decided_by','decided_at','specification','erased_at'])
  THEN RAISE EXCEPTION 'Immutable audio authorization proposal' USING ERRCODE='23514'; END IF;
  IF NOT((OLD.state='pending' AND NEW.state IN('confirmed','declined','withdrawn','expired','cancelled'))
    OR (OLD.state='confirmed' AND NEW.state IN('withdrawn','cancelled'))
    OR (NEW.state=OLD.state AND OLD.erased_at IS NULL AND NEW.erased_at IS NOT NULL))
  THEN RAISE EXCEPTION 'Audio authorization cannot be restored or silently replaced' USING ERRCODE='23514'; END IF;
  IF NEW.specification IS DISTINCT FROM OLD.specification OR NEW.erased_at IS DISTINCT FROM OLD.erased_at THEN
   IF NOT(OLD.erased_at IS NULL AND NEW.erased_at IS NOT NULL AND NEW.specification='{}'::jsonb
    AND NEW.confirmation='{}'::jsonb AND t.content_state='deleted')
   THEN RAISE EXCEPTION 'Audio proposal can only be erased with its source task' USING ERRCODE='23514'; END IF;
  END IF;
  IF OLD.confirmed_by IS NOT NULL AND
   ((NEW.confirmed_by,NEW.confirmed_session_id,NEW.confirmed_at,NEW.confirmation_hash)
     IS DISTINCT FROM (OLD.confirmed_by,OLD.confirmed_session_id,OLD.confirmed_at,OLD.confirmation_hash)
    OR (NEW.confirmation IS DISTINCT FROM OLD.confirmation AND NEW.erased_at IS NULL))
  THEN RAISE EXCEPTION 'Customer confirmation is immutable' USING ERRCODE='23514'; END IF;
  IF OLD.state='pending' AND NEW.state='confirmed' THEN
   SELECT * INTO s FROM sessions WHERE id=NEW.confirmed_session_id;
   IF s.id IS NULL OR NEW.confirmed_session_id IS DISTINCT FROM nullif(current_setting('app.audio_confirmation_session_id',true),'')::uuid
    OR s.token_hash IS DISTINCT FROM current_setting('app.audio_confirmation_session_hash',true)
    OR s.user_id IS DISTINCT FROM NEW.actor_id OR s.audience NOT IN('user','native') OR s.revoked_at IS NOT NULL
    OR s.expires_at<=clock_timestamp() OR s.auth_version<>NEW.actor_auth_version
    OR NOT EXISTS(SELECT 1 FROM users WHERE id=NEW.actor_id AND status='active' AND auth_version=NEW.actor_auth_version)
    OR NEW.confirmed_by IS DISTINCT FROM nullif(current_setting('app.actor_id',true),'')::uuid
    OR t.id IS DISTINCT FROM nullif(current_setting('app.task_id',true),'')::uuid
    OR t.tenant_id IS DISTINCT FROM nullif(current_setting('app.tenant_id',true),'')::uuid
    OR t.status<>'running' OR t.cancel_requested OR t.content_state<>'active'
    OR t.fencing_token IS DISTINCT FROM NEW.origin_fencing OR t.attempt<>NEW.origin_attempt
    OR t.lease_until<=clock_timestamp()
    OR NEW.expires_at<=clock_timestamp() OR NEW.erased_at IS NOT NULL
    OR NEW.confirmation->>'confirm_authorized_use' IS DISTINCT FROM 'true'
    OR coalesce(length(btrim(NEW.confirmation->>'rights_reference')),0) NOT BETWEEN 3 AND 300
    OR coalesce(length(btrim(NEW.confirmation->>'purpose')),0) NOT BETWEEN 3 AND 1000
   THEN RAISE EXCEPTION 'An independent current customer session must confirm audio use' USING ERRCODE='42501'; END IF;
  ELSIF NEW.confirmed_by IS DISTINCT FROM OLD.confirmed_by OR
   (NEW.confirmation IS DISTINCT FROM OLD.confirmation AND NEW.erased_at IS NULL) THEN
   RAISE EXCEPTION 'Only customer confirmation may set audio rights' USING ERRCODE='23514';
  END IF;
 END IF;
 RETURN NEW;
END $$;
CREATE TRIGGER audio_authorization_guard BEFORE INSERT OR UPDATE OR DELETE ON audio_authorizations
 FOR EACH ROW EXECUTE FUNCTION guard_audio_authorization();

CREATE FUNCTION audio_authorization_available(p_id uuid,p_dispatch boolean) RETURNS boolean
 LANGUAGE sql STABLE SECURITY DEFINER SET search_path=pg_catalog,public AS $$
 SELECT EXISTS(SELECT 1 FROM public.audio_authorizations a
  WHERE a.id=p_id AND a.state='confirmed' AND a.erased_at IS NULL AND a.confirmed_by=a.actor_id
  AND (NOT p_dispatch OR (a.expires_at>clock_timestamp() AND EXISTS(
   SELECT 1 FROM public.sessions s JOIN public.users u ON u.id=s.user_id
   WHERE s.id=a.confirmed_session_id AND s.user_id=a.actor_id AND s.revoked_at IS NULL AND s.expires_at>clock_timestamp()
    AND s.auth_version=a.actor_auth_version AND u.auth_version=a.actor_auth_version AND u.status='active'))))
$$;
ALTER FUNCTION audio_authorization_available(uuid,boolean) OWNER TO cp_control;
REVOKE ALL ON FUNCTION audio_authorization_available(uuid,boolean) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION audio_authorization_available(uuid,boolean) TO cp_control;

CREATE FUNCTION bind_audio_job_authorization() RETURNS trigger LANGUAGE plpgsql AS $$
DECLARE a audio_authorizations;
BEGIN
 IF TG_OP='INSERT' THEN
  SELECT * INTO a FROM audio_authorizations WHERE task_id=NEW.task_id AND specification_hash=NEW.specification_hash
   AND capability_version_id=NEW.capability_version_id FOR UPDATE;
  IF a.id IS NULL OR NOT audio_authorization_available(a.id,true)
   OR a.specification IS DISTINCT FROM NEW.specification OR a.origin_fencing IS DISTINCT FROM NEW.origin_fencing
   OR a.origin_attempt<>NEW.origin_attempt OR a.tenant_id<>NEW.tenant_id OR a.project_id<>NEW.project_id
   OR a.actor_id<>NEW.actor_id OR a.private_owner IS DISTINCT FROM NEW.private_owner OR a.data_mode<>NEW.data_mode
   OR a.model_alias<>NEW.model_alias OR a.gateway_fingerprint<>NEW.gateway_fingerprint
   OR a.quoted_units<>NEW.quoted_units OR a.rate_micros<>NEW.rate_micros OR a.quoted_micros<>NEW.quoted_micros
   OR (a.source_asset_id,a.source_version,a.source_sha256) IS DISTINCT FROM (NEW.source_asset_id,NEW.source_version,NEW.source_sha256)
  THEN RAISE EXCEPTION 'Current customer confirmation must bind this exact audio operation' USING ERRCODE='42501'; END IF;
  NEW.authorization_id:=a.id;
 ELSIF NEW.state='dispatched' AND OLD.state='prepared' AND NOT audio_authorization_available(NEW.authorization_id,true) THEN
  RAISE EXCEPTION 'Audio confirmation expired or was withdrawn before dispatch' USING ERRCODE='42501';
 END IF;
 RETURN NEW;
END $$;
CREATE TRIGGER audio_job_authorization_binding BEFORE INSERT OR UPDATE OF state ON ai_audio_jobs
 FOR EACH ROW EXECUTE FUNCTION bind_audio_job_authorization();

CREATE FUNCTION apply_audio_authorization_state() RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog,public AS $$
BEGIN
 INSERT INTO public.audio_authorization_events(authorization_id,state,revision,actor_id,specification_hash,confirmation_hash)
 VALUES(NEW.id,NEW.state,NEW.revision,NEW.decided_by,NEW.specification_hash,NEW.confirmation_hash);
 IF NEW.state IN('declined','withdrawn','expired','cancelled') THEN
  WITH changed AS (UPDATE public.ai_audio_jobs SET
   state=CASE WHEN state='prepared' THEN 'cancelled' WHEN state='dispatched' THEN 'unknown' ELSE state END,
   usage_known=CASE WHEN state='prepared' THEN true ELSE usage_known END,
   billable_units=CASE WHEN state='prepared' THEN 0 ELSE billable_units END,
   finished_at=CASE WHEN state IN('prepared','dispatched') THEN coalesce(finished_at,clock_timestamp()) ELSE finished_at END,
   cancel_requested_at=coalesce(cancel_requested_at,clock_timestamp()),delivery_state='blocked',
   error_code='AUDIO_AUTHORIZATION_UNAVAILABLE',revision=revision+1
   WHERE authorization_id=NEW.id AND (state IN('prepared','dispatched') OR delivery_state<>'blocked') RETURNING id,state)
  INSERT INTO public.ai_audio_job_events(job_id,kind,body)
   SELECT id,CASE WHEN state IN('cancelled','unknown') THEN state ELSE 'authorization_withdrawn' END,
    jsonb_build_object('authorization_id',NEW.id) FROM changed;
 END IF;
 RETURN NEW;
END $$;
ALTER FUNCTION apply_audio_authorization_state() OWNER TO cp_control;
REVOKE ALL ON FUNCTION apply_audio_authorization_state() FROM PUBLIC;
ALTER TABLE ai_audio_job_events DROP CONSTRAINT ai_audio_job_events_kind_check;
ALTER TABLE ai_audio_job_events ADD CONSTRAINT ai_audio_job_events_kind_check
 CHECK(kind IN('prepared','dispatched','completed','cancelled','unknown','subtitle_revision','erased','authorization_withdrawn'));
CREATE TRIGGER audio_authorization_state AFTER INSERT OR UPDATE ON audio_authorizations
 FOR EACH ROW EXECUTE FUNCTION apply_audio_authorization_state();

CREATE FUNCTION guard_audio_authorized_artifact() RETURNS trigger LANGUAGE plpgsql AS $$
DECLARE j ai_audio_jobs;
BEGIN
 SELECT * INTO STRICT j FROM ai_audio_jobs WHERE id=NEW.job_id;
 IF (j.authorization_id IS NOT NULL AND NOT audio_authorization_available(j.authorization_id,false))
  OR (j.authorization_id IS NULL AND NOT(j.state='completed' AND NEW.kind IN('transcript','srt','vtt') AND NEW.revision>j.subtitle_revision))
 THEN RAISE EXCEPTION 'Unapproved audio cannot create a new delivery' USING ERRCODE='42501'; END IF;
 RETURN NEW;
END $$;
CREATE TRIGGER audio_authorized_artifact BEFORE INSERT ON ai_audio_job_artifacts
 FOR EACH ROW EXECUTE FUNCTION guard_audio_authorized_artifact();

CREATE FUNCTION stop_audio_authorizations() RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog,public AS $$
BEGIN
 IF NEW.cancel_requested OR NEW.content_state<>'active' OR NEW.status IN('failed','cancelled','reconciling') THEN
  UPDATE public.audio_authorizations SET state='cancelled',decision_reason='ORIGINATOR_NOT_ACTIVE',
   decided_by=NULL,decided_at=clock_timestamp(),revision=revision+1 WHERE task_id=NEW.id AND state IN('pending','confirmed');
 END IF;
 IF NEW.content_state='deleted' THEN
  UPDATE public.audio_authorizations SET specification='{}',confirmation='{}',erased_at=clock_timestamp(),revision=revision+1
   WHERE task_id=NEW.id AND erased_at IS NULL;
 END IF;
 RETURN NEW;
END $$;
ALTER FUNCTION stop_audio_authorizations() OWNER TO cp_control;
REVOKE ALL ON FUNCTION stop_audio_authorizations() FROM PUBLIC;
CREATE TRIGGER audio_authorization_origin AFTER UPDATE OF status,cancel_requested,content_state ON tasks
 FOR EACH ROW EXECUTE FUNCTION stop_audio_authorizations();

-- Previously submitted requests keep their actual/unknown cost facts. No
-- historical model-supplied declaration is backfilled as human confirmation.
WITH changed AS (UPDATE ai_audio_jobs SET state=CASE WHEN state='prepared' THEN 'cancelled' ELSE 'unknown' END,
 usage_known=(state='prepared'),billable_units=CASE WHEN state='prepared' THEN 0 ELSE NULL END,
 cancel_requested_at=coalesce(cancel_requested_at,clock_timestamp()),error_code='LEGACY_AUDIO_AUTHORIZATION_REQUIRED',
 finished_at=coalesce(finished_at,clock_timestamp()),
 delivery_state='blocked',revision=revision+1 WHERE state IN('prepared','dispatched') RETURNING id,state)
INSERT INTO ai_audio_job_events(job_id,kind) SELECT id,state FROM changed;

CREATE OR REPLACE FUNCTION audio_asset_available(asset uuid) RETURNS boolean LANGUAGE sql STABLE SECURITY DEFINER
 SET search_path=pg_catalog,public AS $$
 SELECT NOT EXISTS(SELECT 1 FROM public.ai_audio_job_artifacts a JOIN public.ai_audio_jobs j ON j.id=a.job_id
  JOIN public.tasks t ON t.id=j.task_id JOIN public.internal_capability_versions c ON c.id=j.capability_version_id
  WHERE a.asset_id=asset AND (j.erased_at IS NOT NULL OR t.content_state<>'active' OR c.revoked
   OR (j.authorization_id IS NOT NULL AND NOT public.audio_authorization_available(j.authorization_id,false))
   OR EXISTS(SELECT 1 FROM public.assets s JOIN public.asset_versions v ON v.asset_id=s.id AND v.version=j.source_version
    WHERE s.id=j.source_asset_id AND (s.state<>'active' OR s.retention_expires_at<=clock_timestamp() OR v.erased_at IS NOT NULL))))
$$;
ALTER TABLE audio_authorizations ENABLE ROW LEVEL SECURITY;
ALTER TABLE audio_authorizations FORCE ROW LEVEL SECURITY;
CREATE POLICY audio_authorizations_control ON audio_authorizations FOR ALL TO cp_control USING(true) WITH CHECK(true);
ALTER TABLE audio_authorization_events ENABLE ROW LEVEL SECURITY;
ALTER TABLE audio_authorization_events FORCE ROW LEVEL SECURITY;
CREATE POLICY audio_authorization_events_control ON audio_authorization_events FOR ALL TO cp_control USING(true) WITH CHECK(true);
REVOKE ALL ON audio_authorizations,audio_authorization_events FROM PUBLIC,cp_app,cp_queue;
GRANT SELECT,INSERT,UPDATE ON audio_authorizations TO cp_control;
GRANT SELECT,INSERT ON audio_authorization_events TO cp_control;
INSERT INTO schema_migrations(version) VALUES(102);
