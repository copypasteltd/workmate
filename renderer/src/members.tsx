import { useEffect, useState } from "react";
import { Plus } from "lucide-react";
import { api, patch, post } from "./api";
import { completeOperation, operationKey } from "./operation-key";
import { useWorkspace } from "./context";
import {
  AsyncForm,
  Badge,
  DateText,
  ErrorNotice,
  Field,
  Loading,
  Modal,
  PageHeader,
  useData,
  useI18n,
} from "./ui";

export function Members() {
  const { t } = useI18n(),
    w = useWorkspace();
  const [refresh, setRefresh] = useState(0),
    [open, setOpen] = useState(false),
    [editing, setEditing] = useState<any>(null),
    [removing, setRemoving] = useState<any>(null),
    [inviteAction, setInviteAction] = useState<any>(null);
  const [cursor, setCursor] = useState(""),
    [history, setHistory] = useState<string[]>([]),
    [inviteCursor, setInviteCursor] = useState(""),
    [inviteHistory, setInviteHistory] = useState<string[]>([]);
  useEffect(() => {
    setCursor("");
    setHistory([]);
    setInviteCursor("");
    setInviteHistory([]);
    setEditing(null);
    setRemoving(null);
    setInviteAction(null);
    setOpen(false);
  }, [w.tenant]);
  const base = `/v1/tenants/${w.tenant}`;
  const members = useData(
    `${base}/member-directory?limit=20${cursor ? "&cursor=" + cursor : ""}`,
    refresh,
  );
  const invites = useData(
    `${base}/invites?limit=20${inviteCursor ? "&cursor=" + inviteCursor : ""}`,
    refresh,
    5000,
  );
  const owner =
    w.me?.memberships.find((m: any) => m.id === w.tenant)?.role === "owner";
  const roles = owner
    ? ["member", "approver", "viewer", "admin", "owner"]
    : ["member", "approver", "viewer"];
  const attempt = (action: string, body: unknown) =>
    operationKey(w.me.user.id, base + action, body);
  const reload = async () => {
    setRefresh((v) => v + 1);
    await w.refresh();
  };
  return (
    <>
      <PageHeader
        eyebrow="THE PEOPLE BEHIND THE WORK."
        title={t("成員與權限", "Members & access")}
        description={t(
          "按企業與專案授予存取權，管理邀請與成員。",
          "Manage workspace access, project permissions and invitations.",
        )}
        action={
          <button className="button primary" onClick={() => setOpen(true)}>
            <Plus size={17} />
            {t("邀請成員", "Invite a member")}
          </button>
        }
      />
      <ErrorNotice error={members.error} />
      {members.loading && !members.data && <Loading />}
      <div className="card table-scroll">
        <table>
          <thead>
            <tr>
              <th>{t("成員", "Member")}</th>
              <th>{t("郵箱", "Email")}</th>
              <th>{t("角色", "Role")}</th>
              <th>{t("狀態", "Status")}</th>
              <th>{t("管理", "Manage")}</th>
            </tr>
          </thead>
          <tbody>
            {members.data?.items.map((m: any) => (
              <tr key={m.id} data-member-id={m.id}>
                <td>{m.name}</td>
                <td title={m.email}>{m.email}</td>
                <td>{m.role}</td>
                <td>
                  <Badge value={m.state} />
                </td>
                <td>
                  <div className="row-actions">
                    {owner && m.state === "active" && (
                      <button
                        className="text-button"
                        onClick={() => setEditing(m)}
                      >
                        {t("修改權限", "Edit access")}
                      </button>
                    )}
                    {m.state === "active" &&
                      (owner || !["owner", "admin"].includes(m.role)) && (
                        <button
                          className="text-button"
                          onClick={() => setRemoving(m)}
                        >
                          {t("移除成員", "Remove member")}
                        </button>
                      )}
                  </div>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      <div className="row-actions">
        <button
          className="button"
          disabled={!history.length}
          onClick={() => {
            setCursor(history.at(-1)!);
            setHistory((h) => h.slice(0, -1));
          }}
        >
          {t("上一頁", "Previous")}
        </button>
        <button
          className="button"
          disabled={!members.data?.next_cursor}
          onClick={() => {
            setHistory((h) => [...h, cursor]);
            setCursor(members.data.next_cursor);
          }}
        >
          {t("下一頁", "Next")}
        </button>
      </div>
      <h2>{t("邀請紀錄", "Invitations")}</h2>
      <ErrorNotice error={invites.error} />
      <div className="card table-scroll">
        <table>
          <thead>
            <tr>
              <th>{t("郵箱", "Email")}</th>
              <th>{t("角色", "Role")}</th>
              <th>{t("狀態", "Status")}</th>
              <th>{t("郵件", "Email delivery")}</th>
              <th>{t("到期", "Expires")}</th>
              <th>{t("管理", "Manage")}</th>
            </tr>
          </thead>
          <tbody>
            {invites.data?.items.map((i: any) => (
              <tr key={i.id} data-invite-id={i.id}>
                <td title={i.email}>{i.email}</td>
                <td>{i.role}</td>
                <td>
                  <Badge value={i.state} />
                </td>
                <td>
                  {
                    (
                      {
                        queued: t("等待寄送", "Queued"),
                        sending: t("寄送中", "Sending"),
                        delivered: t("已寄送", "Sent"),
                        failed: t(
                          "寄送失敗，可重發",
                          "Delivery failed; resend available",
                        ),
                        cancelled: t("已停止寄送", "Delivery stopped"),
                        unknown: t("尚無寄送紀錄", "No delivery record"),
                      } as Record<string, string>
                    )[i.delivery]
                  }
                </td>
                <td>
                  <DateText value={i.expires_at} />
                </td>
                <td>
                  {["pending", "expired"].includes(i.state) &&
                    (owner || !["owner", "admin"].includes(i.role)) && (
                      <div className="row-actions">
                        <button
                          className="text-button"
                          onClick={() =>
                            setInviteAction({ ...i, action: "resend" })
                          }
                        >
                          {t("重新寄送", "Resend")}
                        </button>
                        <button
                          className="text-button"
                          onClick={() =>
                            setInviteAction({ ...i, action: "revoke" })
                          }
                        >
                          {t("撤銷邀請", "Revoke")}
                        </button>
                      </div>
                    )}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      <div className="row-actions">
        <button
          className="button"
          disabled={!inviteHistory.length}
          onClick={() => {
            setInviteCursor(inviteHistory.at(-1)!);
            setInviteHistory((h) => h.slice(0, -1));
          }}
        >
          {t("上一頁", "Previous")}
        </button>
        <button
          className="button"
          disabled={!invites.data?.next_cursor}
          onClick={() => {
            setInviteHistory((h) => [...h, inviteCursor]);
            setInviteCursor(invites.data.next_cursor);
          }}
        >
          {t("下一頁", "Next")}
        </button>
      </div>
      {editing && (
        <Modal
          title={t("修改成員權限", "Edit member access")}
          onClose={() => setEditing(null)}
        >
          <AsyncForm
            submitLabel={t("儲存權限", "Save access")}
            onSubmit={async (f) => {
              await patch(`${base}/members/${editing.user_id}`, {
                role: String(f.get("role")),
                status: "active",
                version: editing.auth_version,
                project_ids: f.getAll("projects").map(String),
              });
              setEditing(null);
              await reload();
            }}
          >
            <p>{editing.email}</p>
            <Field label={t("企業角色", "Workspace role")}>
              <select name="role" defaultValue={editing.role}>
                {["owner", "admin", "member", "approver", "viewer"].map((r) => (
                  <option key={r}>{r}</option>
                ))}
              </select>
            </Field>
            <Field
              label={t("授權專案（可複選）", "Authorized projects (multiple)")}
            >
              <select
                multiple
                name="projects"
                defaultValue={editing.project_ids}
              >
                {w.projects.map((p) => (
                  <option key={p.id} value={p.id}>
                    {p.name}
                  </option>
                ))}
              </select>
            </Field>
          </AsyncForm>
        </Modal>
      )}
      {removing && (
        <Modal
          title={t("移除成員", "Remove member")}
          onClose={() => setRemoving(null)}
        >
          <AsyncForm
            submitLabel={t("確認移除", "Confirm removal")}
            onSubmit={async () => {
              const k = await attempt(`/remove/${removing.id}`, {
                version: removing.auth_version,
              });
              await api(`/v1/members/${removing.id}`, {
                method: "DELETE",
                headers: { "X-Tenant-ID": w.tenant, "Idempotency-Key": k },
              });
              setRemoving(null);
              await reload();
            }}
          >
            <p>{removing.email}</p>
            <p>
              {t(
                "成員將立即失去此企業與專案的存取權。",
                "This member will lose access to the workspace and its projects immediately.",
              )}
            </p>
          </AsyncForm>
        </Modal>
      )}
      {inviteAction && (
        <Modal
          title={
            inviteAction.action === "resend"
              ? t("重新寄送邀請", "Resend invitation")
              : t("撤銷邀請", "Revoke invitation")
          }
          onClose={() => setInviteAction(null)}
        >
          <AsyncForm
            submitLabel={t("確認", "Confirm")}
            onSubmit={async () => {
              const body = { version: inviteAction.version };
              const k = await attempt(
                `/invites/${inviteAction.id}/${inviteAction.action}`,
                body,
              );
              await post(
                `${base}/invites/${inviteAction.id}/${inviteAction.action}`,
                body,
                k,
              );
              setInviteAction(null);
              await reload();
            }}
          >
            <p>{inviteAction.email}</p>
            <p>
              {inviteAction.action === "resend"
                ? t(
                    "系統會寄送新的邀請；原有連結隨即失效。",
                    "A new invitation will be sent and the previous link will expire.",
                  )
                : t(
                    "此邀請連結將無法再使用。",
                    "This invitation link will no longer work.",
                  )}
            </p>
          </AsyncForm>
        </Modal>
      )}
      {open && (
        <Modal
          title={t("邀請成員", "Invite a member")}
          onClose={() => setOpen(false)}
        >
          <AsyncForm
            submitLabel={t("建立邀請", "Create invitation")}
            onSubmit={async (f) => {
              const body = {
                email: String(f.get("email")).trim().toLowerCase(),
                role: String(f.get("role")),
                project_ids: f.getAll("projects").map(String).sort(),
              };
              const k = await attempt("/invites", body);
              await post(`${base}/invites`, body, k);
              await completeOperation(w.me.user.id, base + "/invites", body);
              setOpen(false);
              await reload();
            }}
          >
            <Field label={t("郵箱", "Email")}>
              <input type="email" name="email" required />
            </Field>
            <Field label={t("企業角色", "Workspace role")}>
              <select name="role" defaultValue="member">
                {roles.map((r) => (
                  <option key={r}>{r}</option>
                ))}
              </select>
            </Field>
            <Field
              label={t("授權專案（可複選）", "Authorized projects (multiple)")}
            >
              <select
                name="projects"
                multiple
                defaultValue={w.project ? [w.project] : []}
              >
                {w.projects.map((p) => (
                  <option key={p.id} value={p.id}>
                    {p.name}
                  </option>
                ))}
              </select>
            </Field>
            <p className="muted small-text">
              {t(
                "邀請將寄至此郵箱，有效期 7 天。收件人需使用相同郵箱登入。請在邀請紀錄中確認寄送狀態。",
                "The invitation expires in 7 days. The recipient must sign in using this email. Check Invitations for delivery status.",
              )}
            </p>
          </AsyncForm>
        </Modal>
      )}
    </>
  );
}
