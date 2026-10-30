-- A monotonic fence for complete, bounded administrator message navigation.
-- Existing customer messages, authors, ordering and versions remain unchanged.
ALTER TABLE conversations ADD COLUMN history_revision bigint NOT NULL DEFAULT 1
 CHECK(history_revision > 0);

CREATE FUNCTION advance_conversation_history() RETURNS trigger
 LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog,public AS $$
BEGIN
 IF TG_OP <> 'INSERT' THEN
  UPDATE public.conversations SET history_revision=history_revision+1 WHERE id=OLD.conversation_id;
 END IF;
 IF TG_OP='INSERT' OR (TG_OP='UPDATE' AND NEW.conversation_id IS DISTINCT FROM OLD.conversation_id) THEN
  UPDATE public.conversations SET history_revision=history_revision+1 WHERE id=NEW.conversation_id;
 END IF;
 RETURN NULL;
END $$;
CREATE TRIGGER conversation_history_changed AFTER INSERT OR UPDATE OR DELETE ON conversation_messages
 FOR EACH ROW EXECUTE FUNCTION advance_conversation_history();

CREATE FUNCTION guard_conversation_history_revision() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
 IF (TG_OP='INSERT' AND NEW.history_revision<>1) OR
  (TG_OP='UPDATE' AND NEW.history_revision IS DISTINCT FROM OLD.history_revision
   AND (pg_trigger_depth()<2 OR NEW.history_revision<>OLD.history_revision+1)) THEN
  RAISE EXCEPTION 'Conversation history revisions are maintained by message changes' USING ERRCODE='23514';
 END IF;
 RETURN NEW;
END $$;
CREATE TRIGGER conversation_history_revision_guard BEFORE INSERT OR UPDATE ON conversations
 FOR EACH ROW EXECUTE FUNCTION guard_conversation_history_revision();
