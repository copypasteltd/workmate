import { useEffect, useRef, useState, type SetStateAction } from "react";
import {
  readMotionDraft,
  keepMotionDraft,
  forgetMotionDraft,
  type MotionSnapshot,
  type MotionPending,
} from "./motion-draft-state";
import type { MotionDefinition } from "./motion-editor-model";

export function useMotionEditor(
  scope: string,
  id: string,
  version: number,
  initial: MotionSnapshot,
) {
  const [snapshot, setSnapshot] = useState(() => structuredClone(initial)),
    ref = useRef(snapshot),
    past = useRef<MotionSnapshot[]>([]),
    future = useRef<MotionSnapshot[]>([]);
  const [recovery, setRecovery] = useState(() =>
      scope ? readMotionDraft(scope, id) : null,
    ),
    [pending, setPendingState] = useState<MotionPending | null>(null),
    [stored, setStored] = useState(true),
    [revision, tick] = useState(0);
  const [baseVersion, setBaseVersion] = useState(version);
  const request = useRef<MotionPending | null>(null),
    initialText = useRef(JSON.stringify(initial)),
    dirty = JSON.stringify(snapshot) !== initialText.current;
  const record = (next: MotionSnapshot) => {
    if (request.current || recovery) return;
    if (JSON.stringify(next) === JSON.stringify(ref.current)) return;
    past.current.push(structuredClone(ref.current));
    while (
      past.current.length > 30 ||
      (past.current.length > 1 &&
        JSON.stringify(past.current).length > 2_000_000)
    )
      past.current.shift();
    future.current = [];
    ref.current = next;
    setSnapshot(next);
    tick((v) => v + 1);
  };
  const setDefinition = (action: SetStateAction<MotionDefinition>) =>
    record({
      ...ref.current,
      definition:
        typeof action === "function"
          ? action(structuredClone(ref.current.definition))
          : action,
    });
  const setName = (name: string) => record({ ...ref.current, name });
  const travel = (direction: "undo" | "redo") => {
    if (request.current || recovery) return;
    const from = direction === "undo" ? past.current : future.current,
      to = direction === "undo" ? future.current : past.current,
      next = from.pop();
    if (!next) return;
    to.push(structuredClone(ref.current));
    ref.current = next;
    setSnapshot(next);
    tick((v) => v + 1);
  };
  const setPending = (next: MotionPending | null) => {
    request.current = next;
    setPendingState(next);
    if (scope)
      setStored(keepMotionDraft(scope, id, baseVersion, ref.current, next));
  };
  const restore = () => {
    if (!recovery || (recovery.version !== version && !recovery.pending))
      return;
    ref.current = structuredClone(recovery.snapshot);
    setSnapshot(ref.current);
    setBaseVersion(recovery.version);
    request.current = recovery.pending;
    setPendingState(recovery.pending);
    setRecovery(null);
    tick((v) => v + 1);
  };
  const discard = () => {
    if (recovery?.pending) return;
    forgetMotionDraft(scope, id);
    setRecovery(null);
  };
  const completed = () => {
    forgetMotionDraft(scope, id);
    initialText.current = JSON.stringify(ref.current);
    request.current = null;
    setPendingState(null);
  };
  useEffect(() => {
    if (!scope || recovery) return;
    if (dirty || pending)
      setStored(keepMotionDraft(scope, id, baseVersion, snapshot, pending));
    else forgetMotionDraft(scope, id);
  }, [scope, id, baseVersion, snapshot, pending, recovery, dirty]);
  useEffect(() => {
    if (!dirty) return;
    const guard = (e: BeforeUnloadEvent) => {
      e.preventDefault();
      e.returnValue = "";
    };
    window.addEventListener("beforeunload", guard);
    return () => window.removeEventListener("beforeunload", guard);
  }, [dirty]);
  return {
    definition: snapshot.definition,
    name: snapshot.name,
    setDefinition,
    setName,
    dirty,
    recovery,
    restore,
    discard,
    completed,
    pending,
    request,
    setPending,
    stored,
    baseVersion,
    undo: () => travel("undo"),
    redo: () => travel("redo"),
    canUndo: revision >= 0 && past.current.length > 0,
    canRedo: revision >= 0 && future.current.length > 0,
  };
}
