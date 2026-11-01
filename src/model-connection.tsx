import { useState } from "react";
import { api } from "./api";
import { ErrorNotice, Field, useI18n } from "./ui";
import {
  capabilityRoot,
  type CapabilityAccess,
  type CapabilityRelease,
} from "./capability-model";

export function ModelConnectionFields({ from }: { from?: CapabilityRelease }) {
  const { t } = useI18n(),
    [keepKey, setKeepKey] = useState(Boolean(from?.document.upstream)),
    [apiKey, setApiKey] = useState(""),
    [baseURL, setBaseURL] = useState(from?.document.upstream?.base_url ?? ""),
    [privateNetwork, setPrivateNetwork] = useState(
      from?.document.upstream?.allow_private_network ?? false,
    );
  const sameScope = Boolean(
    from?.document.upstream &&
      baseURL.trim().replace(/\/+$/, "") ===
        from.document.upstream.base_url.replace(/\/+$/, "") &&
      privateNetwork === from.document.upstream.allow_private_network,
  );
  return (
    <fieldset className="form-stack model-connection-fields">
      <legend>{t("此模型的上游接口", "This model's upstream API")}</legend>
      <Field
        label="API Base URL"
        hint={t(
          "填寫完整基礎地址，例如 https://gateway.example/v1；不要填入 /responses。",
          "Enter the complete base URL, such as https://gateway.example/v1; omit /responses.",
        )}
      >
        <input
          name="upstream_base_url"
          type="url"
          required
          maxLength={2048}
          autoComplete="off"
          placeholder="https://gateway.example/v1"
          value={baseURL}
          onChange={(e) => {
            setBaseURL(e.target.value);
            setKeepKey(false);
          }}
        />
      </Field>
      <Field
        label="API Key"
        hint={t(
          "僅在伺服器加密保存，儲存後不回傳完整密鑰。每個模型可使用不同的 Key。",
          "Encrypted on the server and never returned. Each model can use a different key.",
        )}
      >
        <input
          name="upstream_api_key"
          type="password"
          required={!(keepKey && sameScope)}
          value={apiKey}
          onChange={(e) => {
            setApiKey(e.target.value);
            if (e.target.value) setKeepKey(false);
          }}
          maxLength={8192}
          autoComplete="new-password"
          spellCheck={false}
          placeholder={
            keepKey && sameScope
              ? t(
                  "已配置；輸入新 Key 可替換",
                  "Configured; enter a new key to replace it",
                )
              : "sk-…"
          }
        />
      </Field>
      {from?.document.upstream && (
        <label className="checkbox">
          <input
            name="upstream_reuse_from"
            type="checkbox"
            value={from.id}
            checked={keepKey && sameScope}
            disabled={!sameScope}
            onChange={(e) => {
              setKeepKey(e.target.checked);
              if (e.target.checked) setApiKey("");
            }}
          />
          {t(
            "保留已保存的密鑰（更換地址或網絡範圍須填新 Key）",
            "Retain saved key (a new key is required after changing address or network scope)",
          )}
        </label>
      )}
      <label className="checkbox">
        <input
          name="upstream_private"
          type="checkbox"
          checked={privateNetwork}
          onChange={(e) => {
            setPrivateNetwork(e.target.checked);
            setKeepKey(false);
          }}
        />
        {t(
          "允許公司內網地址／內網 HTTP",
          "Allow company private-network addresses / internal HTTP",
        )}
      </label>
      <p className="muted">
        {t(
          "文字模型須支援 OpenAI Responses API。驗證及執行會使用此模型指定的上游；新版本保留其他模型及既有工作的連線。",
          "Text models must support the OpenAI Responses API. Validation and execution use this model's upstream; new versions preserve other models and existing task connections.",
        )}
      </p>
    </fieldset>
  );
}

export function ModelConnectionCheck({
  release,
  access,
}: {
  release: CapabilityRelease;
  access: CapabilityAccess;
}) {
  const { t } = useI18n(),
    [busy, setBusy] = useState(false),
    [error, setError] = useState<Error | null>(null),
    [result, setResult] = useState<{
      reachable: boolean;
      model_available: boolean | null;
      error_code?: string;
    } | null>(null);
  if (!release.document.upstream)
    return (
      <p className="muted">
        {t(
          "歷史配置使用伺服器預設連線。建立新版本可設定獨立接口及 API Key。",
          "This legacy version uses server defaults. Create a new version to bind its own API URL and key.",
        )}
      </p>
    );
  const labels: Record<string, string> = {
    MODEL_AUTHENTICATION_FAILED: t(
      "上游拒絕密鑰，請核對 API Key 及權限。",
      "Upstream authentication failed. Check the key and permissions.",
    ),
    MODEL_LIST_UNSUPPORTED: t(
      "上游不支援模型列表；請使用下方完整能力驗證。",
      "The upstream does not support model listing. Use the full capability validation below.",
    ),
    MODEL_CONNECTION_ADDRESS_BLOCKED: t(
      "地址不在允許的網絡範圍。",
      "The address is outside the allowed network scope.",
    ),
  };
  return (
    <section
      className="form-stack"
      aria-label={t("上游連線測試", "Upstream connection test")}
    >
      <p className="muted">
        {t(
          "連線測試只讀取 /models，不產生推理；通過後仍需驗證能力及發佈。完整驗證與正式執行會消耗實際上游額度。",
          "This check only reads /models. Full capability validation and publication remain required; validation and execution consume actual upstream credit.",
        )}
      </p>
      {access.has("admin.catalog.publish") && (
        <button
          type="button"
          className="button secondary"
          disabled={busy}
          onClick={async () => {
            setBusy(true);
            setError(null);
            setResult(null);
            try {
              setResult(
                await api(`${capabilityRoot}/${release.id}/connection-test`, {
                  method: "POST",
                  body: JSON.stringify({
                    expected_version: release.version,
                    reason:
                      "Administrator checks this model upstream connection",
                  }),
                }),
              );
            } catch (e) {
              setError(e as Error);
            } finally {
              setBusy(false);
            }
          }}
        >
          {busy
            ? t("正在測試…", "Testing…")
            : t("測試此模型連線", "Test this model connection")}
        </button>
      )}
      <ErrorNotice error={error} />
      {result && (
        <p className="notice" role="status">
          {result.reachable
            ? result.model_available
              ? t(
                  "接口及密鑰有效，模型列表包含此模型。",
                  "Connection and key work; the model is listed.",
                )
              : t(
                  "接口及密鑰有效，但模型列表未列出此別名。請核對別名並進行完整能力驗證。",
                  "Connection and key work, but this alias is not listed. Check the alias and run full capability validation.",
                )
            : (labels[result.error_code ?? ""] ??
              t(
                "無法連接此模型上游。請核對地址、網絡及服務狀態。",
                "Cannot connect to this model upstream. Check its URL, network and service status.",
              ))}
        </p>
      )}
    </section>
  );
}
