-- Highest administrators execute directly; other administrators retain policy review.
-- Historical operations/decisions are not rewritten or attributed to fictitious reviewers.
CREATE FUNCTION admin_is_highest(p_actor uuid,p_version integer) RETURNS boolean
 LANGUAGE sql STABLE SECURITY DEFINER SET search_path=pg_catalog,public AS $$
 SELECT EXISTS(SELECT 1 FROM public.admin_principals p
 JOIN public.admin_bindings b ON b.principal_id=p.id
 JOIN public.admin_roles r ON r.key=b.role_key
 WHERE p.id=p_actor AND p.auth_version=p_version AND p.status='active' AND p.enrollment_state='enrolled'
 AND r.key='super_admin' AND r.builtin AND b.effect='allow' AND b.scope_kind='global'
 AND b.scope_id IS NULL AND (b.expires_at IS NULL OR b.expires_at>statement_timestamp()))
$$;
ALTER FUNCTION admin_is_highest(uuid,integer) OWNER TO cp_control;
REVOKE ALL ON FUNCTION admin_is_highest(uuid,integer) FROM PUBLIC,cp_app,cp_queue;
GRANT EXECUTE ON FUNCTION admin_is_highest(uuid,integer) TO cp_control;

CREATE FUNCTION admin_direct_context_valid(p_actor uuid DEFAULT NULL) RETURNS boolean
 LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path=pg_catalog,public AS $$
DECLARE ctx jsonb; actor uuid; session uuid; revision integer;
BEGIN
 ctx:=nullif(current_setting('app.admin_direct_context',true),'')::jsonb;
 IF ctx IS NULL THEN RETURN false; END IF;
 actor:=(ctx->>'actor_id')::uuid; session:=(ctx->>'session_id')::uuid; revision:=(ctx->>'auth_version')::integer;
 IF actor IS NULL OR session IS NULL OR revision IS NULL OR (p_actor IS NOT NULL AND actor<>p_actor) THEN RETURN false; END IF;
 RETURN public.admin_is_highest(actor,revision) AND EXISTS(
 SELECT 1 FROM public.sessions s WHERE s.id=session AND s.admin_id=actor AND s.audience='admin'
 AND s.auth_version=revision AND s.revoked_at IS NULL AND s.expires_at>statement_timestamp()
 AND s.mfa_at>statement_timestamp()-interval '10 minutes');
EXCEPTION WHEN invalid_text_representation OR numeric_value_out_of_range THEN RETURN false;
END $$;
ALTER FUNCTION admin_direct_context_valid(uuid) OWNER TO cp_control;
REVOKE ALL ON FUNCTION admin_direct_context_valid(uuid) FROM PUBLIC,cp_app,cp_queue;
GRANT EXECUTE ON FUNCTION admin_direct_context_valid(uuid) TO cp_control;

ALTER TABLE admin_operations ADD COLUMN execution_mode text NOT NULL DEFAULT 'legacy'
 CHECK(execution_mode IN ('legacy','policy_direct','independent_review','super_admin_direct'));
ALTER TABLE admin_approval_decisions ADD COLUMN execution_mode text NOT NULL DEFAULT 'independent_review'
 CHECK(execution_mode IN ('independent_review','super_admin_direct'));

CREATE FUNCTION guard_admin_execution_mode() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
 IF TG_OP='INSERT' THEN
  NEW.execution_mode:=CASE WHEN admin_direct_context_valid(NEW.principal_id) THEN 'super_admin_direct'
   WHEN NEW.state='pending_approval' THEN 'independent_review' ELSE 'policy_direct' END;
 ELSIF NEW.execution_mode IS DISTINCT FROM OLD.execution_mode THEN
  RAISE EXCEPTION 'Execution attribution is derived from the live actor' USING ERRCODE='42501';
 END IF;
 IF TG_OP='UPDATE' AND OLD.state='pending_approval' AND NEW.state<>'pending_approval' AND admin_direct_context_valid() THEN
  NEW.execution_mode:='super_admin_direct';
 END IF;
 RETURN NEW;
END $$;
CREATE TRIGGER guard_admin_execution_mode BEFORE INSERT OR UPDATE ON admin_operations
 FOR EACH ROW EXECUTE FUNCTION guard_admin_execution_mode();

-- Preserve all frozen request/version/deadline checks. Only the self-review condition changes.
DO $$ DECLARE definition text; BEGIN
 definition:=pg_get_functiondef('protect_financial_approval()'::regprocedure);
 IF position('r.requester_id=NEW.reviewer_id' IN definition)=0 THEN RAISE EXCEPTION 'Unexpected approval guard'; END IF;
 definition:=replace(definition,'SELECT * INTO r FROM admin_approval_requests WHERE id=NEW.approval_id;',
 'NEW.execution_mode:=CASE WHEN admin_direct_context_valid(NEW.reviewer_id) THEN ''super_admin_direct'' ELSE ''independent_review'' END; SELECT * INTO r FROM admin_approval_requests WHERE id=NEW.approval_id;');
 definition:=replace(definition,'r.requester_id=NEW.reviewer_id','(r.requester_id=NEW.reviewer_id AND NOT admin_direct_context_valid(NEW.reviewer_id))');
 EXECUTE definition;
END $$;

CREATE FUNCTION guard_admin_confirmation_mode() RETURNS trigger LANGUAGE plpgsql AS $$
DECLARE actor uuid;
BEGIN
 actor:=CASE WHEN TG_TABLE_NAME IN ('payment_confirmations','billing_refund_events') THEN (to_jsonb(NEW)->>'verified_by')::uuid ELSE (to_jsonb(NEW)->>'reviewer_id')::uuid END;
 NEW.execution_mode:=CASE WHEN admin_direct_context_valid(actor) THEN 'super_admin_direct' ELSE 'independent_review' END;
 RETURN NEW;
END $$;
DO $$ DECLARE tab text; con record; BEGIN
 FOREACH tab IN ARRAY ARRAY['ai_provider_admin_publications','ai_provider_cost_confirmations','ai_provider_termination_confirmations',
  'ai_provider_task_settlements','ai_audio_cost_confirmations','ai_audio_termination_confirmations'] LOOP
  EXECUTE format('ALTER TABLE %I ADD COLUMN execution_mode text NOT NULL DEFAULT ''independent_review'' CHECK(execution_mode IN (''independent_review'',''super_admin_direct''))',tab);
  FOR con IN SELECT conname FROM pg_constraint WHERE conrelid=tab::regclass AND contype='c'
   AND pg_get_constraintdef(oid) ~ 'actor_id <> reviewer_id' LOOP
   EXECUTE format('ALTER TABLE %I DROP CONSTRAINT %I',tab,con.conname);
  END LOOP;
  EXECUTE format('ALTER TABLE %I ADD CONSTRAINT authorized_reviewer_mode CHECK(actor_id<>reviewer_id OR execution_mode=''super_admin_direct'')',tab);
  EXECUTE format('CREATE TRIGGER a_admin_confirmation_mode BEFORE INSERT ON %I FOR EACH ROW EXECUTE FUNCTION guard_admin_confirmation_mode()',tab);
 END LOOP;
 FOREACH tab IN ARRAY ARRAY['payment_confirmations','billing_refund_events'] LOOP
  EXECUTE format('ALTER TABLE %I ADD COLUMN execution_mode text NOT NULL DEFAULT ''independent_review'' CHECK(execution_mode IN (''independent_review'',''super_admin_direct''))',tab);
  EXECUTE format('CREATE TRIGGER a_admin_confirmation_mode BEFORE INSERT ON %I FOR EACH ROW EXECUTE FUNCTION guard_admin_confirmation_mode()',tab);
 END LOOP;
END $$;

DO $$ DECLARE definition text; signature text; original text; replacement text; BEGIN
 FOR signature,original,replacement IN SELECT * FROM (VALUES
 ('guard_audio_accounting_confirmation()','e.actor_id=NEW.reviewer_id','(e.actor_id=NEW.reviewer_id AND NOT admin_direct_context_valid(NEW.reviewer_id))'),
 ('protect_payment_fact()','NEW.verified_by=p.created_by','(NEW.verified_by=p.created_by AND NOT admin_direct_context_valid(NEW.verified_by))'),
 ('validate_cash_refund_event()','request.created_by IS NOT DISTINCT FROM NEW.verified_by','(request.created_by IS NOT DISTINCT FROM NEW.verified_by AND NOT admin_direct_context_valid(NEW.verified_by))')
 ) AS edits(signature,original,replacement) LOOP
  definition:=pg_get_functiondef(signature::regprocedure);
  IF position(original IN definition)=0 THEN RAISE EXCEPTION 'Unexpected accounting guard: %',signature; END IF;
  EXECUTE replace(definition,original,replacement);
 END LOOP;
END $$;

-- Audit facts commit in the same transaction as the effect. Standard business audit remains intact.
CREATE FUNCTION audit_admin_direct_execution() RETURNS trigger LANGUAGE plpgsql AS $$
DECLARE ctx jsonb;
BEGIN
 IF NEW.state NOT IN ('pending_approval','running') AND admin_direct_context_valid()
 AND (TG_OP='INSERT' OR OLD.state IS DISTINCT FROM NEW.state) THEN
  ctx:=current_setting('app.admin_direct_context')::jsonb;
  INSERT INTO audit_log(principal_id,actor_kind,action,tenant_id,target,outcome,detail)
  VALUES((ctx->>'actor_id')::uuid,'admin','admin.execution.direct',NEW.tenant_id,NEW.id::text,NEW.state,
   jsonb_build_object('execution_mode','super_admin_direct','operation_id',NEW.id,'original_actor_id',NEW.principal_id,
    'actor_session_id',ctx->>'session_id','actor_auth_version',ctx->'auth_version','action',NEW.action,
    'policy_version_id',NEW.policy_version_id,'payload_hash',NEW.payload_hash,
    'reason',coalesce(NEW.payload#>>'{command,reason}',NEW.payload#>>'{command,body,reason}',NEW.payload->>'reason'),
    'before',NEW.payload->'before','after',NEW.result));
 END IF;
 RETURN NEW;
END $$;
CREATE TRIGGER audit_admin_direct_execution AFTER INSERT OR UPDATE ON admin_operations
 FOR EACH ROW EXECUTE FUNCTION audit_admin_direct_execution();
