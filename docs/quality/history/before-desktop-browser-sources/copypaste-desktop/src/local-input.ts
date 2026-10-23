/** Bounded projection of the pinned native request_user_input protocol. */
export interface LocalInputQuestion {
  id: string; header: string; question: string; isOther: boolean; isSecret: boolean;
  options: { label: string; description: string }[] | null;
}
export interface LocalInputRequest {
  threadId: string; turnId: string; itemId: string; isBlocking: boolean;
  questions: LocalInputQuestion[];
}
export type LocalInputAnswers = Record<string, { answers: string[] }>;
export interface LocalPendingInput extends LocalInputRequest { requestId: string; submitting: boolean }
export class LocalInputError extends Error {
  readonly code: string;
  constructor(code: string) { super(code); this.code = code; }
}
function object(value: unknown): asserts value is Record<string, unknown> {
  if (!value || typeof value !== "object" || Array.isArray(value)) throw new LocalInputError("LOCAL_INPUT_INVALID");
}
function text(value: unknown, max: number, empty = false): asserts value is string {
  if (typeof value !== "string" || value.length > max || (!empty && !value.trim()) || value.includes("\0"))
    throw new LocalInputError("LOCAL_INPUT_INVALID");
}
export function parseLocalInput(value: unknown): LocalInputRequest {
  object(value);
  text(value.threadId, 160); text(value.turnId, 160); text(value.itemId, 160);
  if (typeof value.isBlocking !== "boolean" || !Array.isArray(value.questions) || !value.questions.length || value.questions.length > 3)
    throw new LocalInputError("LOCAL_INPUT_INVALID");
  const ids = new Set<string>();
  const questions = value.questions.map(raw => {
    object(raw); text(raw.id, 80); text(raw.header, 80); text(raw.question, 4000);
    if (ids.has(raw.id) || ["__proto__", "prototype", "constructor"].includes(raw.id)
      || (raw.isOther !== undefined && typeof raw.isOther !== "boolean")
      || (raw.isSecret !== undefined && typeof raw.isSecret !== "boolean")) throw new LocalInputError("LOCAL_INPUT_INVALID");
    ids.add(raw.id);
    let options: LocalInputQuestion["options"] = null;
    if (raw.options !== undefined && raw.options !== null) {
      if (!Array.isArray(raw.options) || !raw.options.length || raw.options.length > 8) throw new LocalInputError("LOCAL_INPUT_INVALID");
      const labels = new Set<string>();
      options = raw.options.map(option => {
        object(option); text(option.label, 240); text(option.description, 1200, true);
        if (labels.has(option.label)) throw new LocalInputError("LOCAL_INPUT_INVALID");
        labels.add(option.label); return { label: option.label, description: option.description };
      });
    }
    return { id: raw.id, header: raw.header, question: raw.question, options, isOther: raw.isOther === true, isSecret: raw.isSecret === true };
  });
  const result = { threadId: value.threadId, turnId: value.turnId, itemId: value.itemId, isBlocking: value.isBlocking, questions };
  if (JSON.stringify(result).length > 24000) throw new LocalInputError("LOCAL_INPUT_INVALID");
  return result;
}
export function parseLocalAnswers(request: LocalInputRequest, value: unknown): LocalInputAnswers {
  object(value);
  const ids = request.questions.map(question => question.id);
  if (Object.keys(value).length !== ids.length || Object.keys(value).some(id => !ids.includes(id)))
    throw new LocalInputError("LOCAL_INPUT_ANSWERS_INVALID");
  const result: LocalInputAnswers = Object.create(null);
  let length = 0;
  for (const question of request.questions) {
    const row = value[question.id]; object(row);
    if (Object.keys(row).length !== 1 || !Array.isArray(row.answers) || row.answers.length !== 1)
      throw new LocalInputError("LOCAL_INPUT_ANSWERS_INVALID");
    const answer = row.answers[0]; text(answer, 8000);
    length += answer.length;
    if (question.options && !question.isOther && !question.options.some(option => option.label === answer))
      throw new LocalInputError("LOCAL_INPUT_ANSWERS_INVALID");
    result[question.id] = { answers: [answer] };
  }
  if (length > 16000) throw new LocalInputError("LOCAL_INPUT_ANSWERS_INVALID");
  return result;
}
