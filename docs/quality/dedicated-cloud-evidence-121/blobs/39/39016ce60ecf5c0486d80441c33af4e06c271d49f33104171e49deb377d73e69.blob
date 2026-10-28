import { check, uuid } from "./protocol.mjs";

export const workspaceMount = "/srv/copypaste-cloud-workspaces";
export function workspacePath(command) {
  check(uuid(command.session_id) && Number.isSafeInteger(command.generation) && command.generation > 0 && command.generation <= 2_147_483_647, "WORKSPACE_IDENTITY_INVALID");
  return `${workspaceMount}/${command.session_id}-g${command.generation}`;
}
export function quotaCommands(command, spec) {
  const directory = workspacePath(command), id = command.generation;
  check(Number.isSafeInteger(spec.plan.disk_mib) && spec.plan.disk_mib >= 1024 && spec.plan.disk_mib <= 4_194_304 && spec.workspace_file_limit === 100000, "WORKSPACE_QUOTA_INVALID");
  return [
    ["-x", "-c", `project -s -p ${directory} ${id}`, workspaceMount],
    ["-x", "-c", `limit -p bsoft=${spec.plan.disk_mib}m bhard=${spec.plan.disk_mib}m isoft=100000 ihard=100000 ${id}`, workspaceMount],
    ["-x", "-c", `project -c -p ${directory} ${id}`, workspaceMount],
  ];
}
export function requireProjectQuotaState(output) {
  const project = output.match(/Project quota state[^\n]*\n([\s\S]*?)(?=\n(?:User|Group|Project) quota state|$)/)?.[1];
  check(project && /^\s*Accounting:\s*ON\s*$/m.test(project) && /^\s*Enforcement:\s*ON\s*$/m.test(project), "PHYSICAL_PROJECT_QUOTA_NOT_ENFORCED");
}
