import { createServer, type ServerResponse } from "node:http";
import { randomBytes, randomUUID } from "node:crypto";
import type { Config } from "./config.js";
import { pngFromSVG } from "./render.js";
import { listenLoopbackHTTP } from "./loopback-http.js";

/** A loopback-only, synthetic dependency for development. The Codex kernel,
 * authorization, tool execution, assets, queue and ledger remain real. */
export async function startDemoGateway(c: Config) {
  if (!c.DEMO_MODE || c.NODE_ENV === "production")
    throw new Error("DEMO_MODE_FORBIDDEN");
  const secret = randomBytes(32).toString("hex");
  const seen = new Map<string, unknown>();
  const server = createServer(async (req, res) => {
    const json = (status: number, value: unknown) =>
      res
        .writeHead(status, { "Content-Type": "application/json" })
        .end(JSON.stringify(value));
    if (req.headers.authorization !== `Bearer ${secret}`) {
      json(401, { error: { code: "DEMO_AUTH_REQUIRED" } });
      return;
    }
    if (req.method !== "POST") {
      json(405, { error: { code: "METHOD_NOT_ALLOWED" } });
      return;
    }
    try {
      const chunks: Buffer[] = [];
      let size = 0;
      for await (const part of req) {
        const b = Buffer.from(part);
        size += b.length;
        if (size > 40 * 1024 * 1024) {
          json(413, { error: { code: "PAYLOAD_TOO_LARGE" } });
          return;
        }
        chunks.push(b);
      }
      const bytes = Buffer.concat(chunks);
      if (
        req.url === "/v1/images/generations" ||
        req.url === "/v1/images/edits"
      ) {
        const key = String(req.headers["idempotency-key"] ?? randomUUID());
        if (seen.has(key)) {
          json(200, seen.get(key));
          return;
        }
        const b = req.url.endsWith("generations")
          ? JSON.parse(bytes.toString())
          : {};
        const label = String(b.prompt ?? "Image edit preview")
          .replace(/[<>&"']/g, "")
          .slice(0, 80);
        const png = pngFromSVG(
          `<svg xmlns="http://www.w3.org/2000/svg" width="1024" height="1024"><rect width="1024" height="1024" fill="#ebe8e2"/><path d="M120 210h784v540H120z" fill="#3537d3"/><path d="M120 210l392 290 392-290v540H120z" fill="#2524aa"/><text x="72" y="100" font-family="sans-serif" font-size="36" fill="#202020">COPYPASTE · DEMO / 模擬素材</text><text x="72" y="855" font-family="sans-serif" font-size="22" fill="#202020">${label}</text><text x="72" y="920" font-family="sans-serif" font-size="20" fill="#555">Locally rendered fixture · no AI image service invoked</text></svg>`,
        );
        const result = {
          created: Math.floor(Date.now() / 1000),
          data: [{ b64_json: png.toString("base64") }],
          demo: true,
        };
        seen.set(key, result);
        if (seen.size > 128) seen.delete(seen.keys().next().value!);
        json(200, result);
        return;
      }
      if (req.url === "/v1/responses/input_tokens") {
        const body = JSON.parse(bytes.toString());
        if (body.model !== "copypaste-demo") {
          json(400, { error: { code: "DEMO_MODEL_REQUIRED" } });
          return;
        }
        // This fixture declares its synthetic input usage; no tokenizer or
        // external model is invoked and this never qualifies a live service.
        json(200, { object: "response.input_tokens", input_tokens: 100 });
        return;
      }
      if (req.url !== "/v1/responses") {
        json(404, { error: { code: "NOT_FOUND" } });
        return;
      }
      const b = JSON.parse(bytes.toString());
      if (b.model !== "copypaste-demo") {
        json(400, { error: { code: "DEMO_MODEL_REQUIRED" } });
        return;
      }
      const input: Array<any> = Array.isArray(b.input) ? b.input : [];
      // Only consider tool calls since the latest user message: prior turns
      // must not skip today's work or leak responses between conversations.
      let lastUser = -1;
      for (let i = input.length - 1; i >= 0; i--)
        if (input[i].role === "user") {
          lastUser = i;
          break;
        }
      const current = input.slice(lastUser < 0 ? 0 : lastUser);
      const used = (name: string) =>
        current.some((i) => i.type === "function_call" && i.name === name);
      const tools: Array<any> = b.tools ?? [];
      const find = (suffix: string) =>
        tools.find(
          (t) =>
            t.type === "function" &&
            (t.name === suffix || t.name?.endsWith("__" + suffix)),
        );
      const requested = JSON.stringify(
        input.filter((i) => i.role === "user").at(-1) ?? "",
      );
      const reportTool = find("analysis_report_facts");
      let tool: any, args: any;
      if (find("capability_probe") && !used(find("capability_probe").name)) {
        tool = find("capability_probe");
        args = { nonce: tool.parameters?.properties?.nonce?.enum?.[0] };
      } else if (reportTool && !used(reportTool.name)) {
        tool = reportTool;
        args = {};
      } else if (
        !reportTool &&
        find("image2_generate") &&
        !used(find("image2_generate").name)
      ) {
        tool = find("image2_generate");
        args = {
          prompt:
            "Demonstration campaign visual with a blue folded-paper motif",
          filename: "demo-campaign.png",
        };
      } else if (
        find("code_write") &&
        find("code_read") &&
        !used(find("code_read").name)
      ) {
        tool = find("code_read");
        args = { path: "demo.html" };
      } else if (find("code_write") && !used(find("code_write").name)) {
        tool = find("code_write");
        const readCall = current.find(
          (i) =>
            i.type === "function_call" && i.name === find("code_read")?.name,
        );
        const readResult = current.find(
          (i) =>
            i.type === "function_call_output" &&
            i.call_id === readCall?.call_id,
        );
        const digest = (
          typeof readResult?.output === "string"
            ? readResult.output
            : JSON.stringify(readResult?.output ?? "")
        ).match(/sha256[^a-f0-9]*([a-f0-9]{64})/)?.[1];
        args = {
          path: "demo.html",
          ...(digest ? { expected_sha256: digest } : {}),
          content:
            '<!doctype html><html lang="zh-HK"><meta charset="utf-8"><title>CopyPaste demo</title><h1>CopyPaste · 模擬交付</h1><p>Local fixture source. No implementation or tests by an AI model are claimed.</p></html>',
        };
      } else if (
        find("code_package") &&
        used(find("code_write")?.name) &&
        !used(find("code_package").name)
      ) {
        tool = find("code_package");
        args = { filename: "demo-source.zip" };
      } else if (find("design_render") && !used(find("design_render").name)) {
        tool = find("design_render");
        args = {
          filename: "demo-layout",
          format: /video|mp4|影片|視頻/i.test(requested) ? "mp4" : "png",
          duration: 3,
          effect: "fade",
          document: {
            width: 768,
            height: 768,
            background: "#ebe8e2",
            layers: [
              {
                type: "rect",
                x: 48,
                y: 48,
                width: 672,
                height: 490,
                color: "#3537d3",
                radius: 0,
              },
              {
                type: "text",
                x: 64,
                y: 620,
                text: "COPYPASTE · DEMO",
                font_size: 40,
                color: "#202020",
                font_family: "sans",
                weight: "bold",
              },
            ],
          },
        };
      } else if (find("deliver_text") && !used(find("deliver_text").name)) {
        tool = find("deliver_text");
        args = {
          filename: "demo-report.md",
          content:
            "# 模擬工作成果 / Simulated deliverable\n\n此內容由本機固定規則產生，用來驗證 Codex、工具、權限、產物和模擬計費流程。它不是 AI 模型的真實分析。\n\nThis is a deterministic local fixture for workflow testing. It is not real model analysis.",
          mime_type: "text/markdown",
        };
      }
      function evidenceReference(value: any, depth = 0): string | undefined {
        if (depth > 12 || value == null) return;
        if (typeof value === "string") {
          try {
            return evidenceReference(JSON.parse(value), depth + 1);
          } catch {
            return;
          }
        }
        if (typeof value !== "object") return;
        if (
          typeof value.metric_id === "string" &&
          typeof value.snapshot_id === "string" &&
          typeof value.id === "string"
        )
          return value.id;
        for (const item of Object.values(value)) {
          const id = evidenceReference(item, depth + 1);
          if (id) return id;
        }
      }
      const evidenceId = evidenceReference(
        current.filter((i) => i.type === "function_call_output"),
      );
      const reportText = JSON.stringify({
        observations: [
          {
            text: `Simulated observation / 模擬觀察: {{${evidenceId}}}`,
            evidence_ids: [evidenceId],
          },
        ],
        hypotheses: [],
        next_steps: [
          "Review source coverage and verify attribution before changing a campaign. / 先核對資料覆蓋和歸因口徑，再調整活動。",
        ],
      });
      const item = tool
        ? {
            id: "fc_" + randomUUID(),
            type: "function_call",
            name: tool.name,
            call_id: "call_" + randomUUID(),
            arguments: JSON.stringify(args),
          }
        : {
            id: "msg_" + randomUUID(),
            type: "message",
            role: "assistant",
            status: "completed",
            content: [
              {
                type: "output_text",
                text: reportTool
                  ? reportText
                  : "【演示資料 / Simulated data】此回覆由本機模擬服務產生。Codex、授權、工具執行及產物保存流程已運行；內容和用量為測試資料。請在素材與交付查看產物。\n\nThis response uses deterministic test data. Codex and product workflow operations ran locally. Content and usage are synthetic.",
                annotations: [],
              },
            ],
          };
      sendResponse(res, item);
    } catch {
      if (!res.headersSent)
        json(400, { error: { code: "DEMO_REQUEST_INVALID" } });
      else res.end();
    }
  });
  server.requestTimeout = 30_000;
  server.headersTimeout = 10_000;
  const port = await listenLoopbackHTTP(server);
  return {
    config: {
      ...c,
      AI_BASE_URL: `http://127.0.0.1:${port}/v1`,
      AI_ALLOWED_HOSTS: "127.0.0.1",
      AI_API_KEY: secret,
      AI_MODEL: "copypaste-demo",
      AI_IMAGE_MODEL: "copypaste-demo-image",
      AI_VERIFIED: true,
      AI_IMAGE_VERIFIED: true,
      AI_INPUT_COUNT_VERIFIED: true,
      AI_INPUT_COUNT_HKD_MICROS_PER_CALL: 0,
      AI_INPUT_HKD_MICROS_PER_MILLION: 1000000,
      AI_OUTPUT_HKD_MICROS_PER_MILLION: 1000000,
      AI_IMAGE_HKD_MICROS_PER_IMAGE: 10000,
    },
    close: () =>
      new Promise<void>((resolve, reject) => {
        server.close((e) => (e ? reject(e) : resolve()));
        server.closeAllConnections();
      }),
  };
}
function sendResponse(res: ServerResponse, item: any) {
  res.writeHead(200, {
    "Content-Type": "text/event-stream",
    "Cache-Control": "no-cache",
  });
  let sequence = 0;
  const event = (type: string, data: any) =>
    res.write(
      `event: ${type}\ndata: ${JSON.stringify({ type, sequence_number: sequence++, ...data })}\n\n`,
    );
  const response = {
    id: "resp_" + randomUUID(),
    object: "response",
    model: "copypaste-demo",
    created_at: Math.floor(Date.now() / 1000),
    status: "in_progress",
    output: [],
  };
  event("response.created", { response });
  event("response.output_item.added", {
    output_index: 0,
    item:
      item.type === "function_call"
        ? { ...item, arguments: "" }
        : { ...item, status: "in_progress", content: [] },
  });
  if (item.type === "function_call") {
    event("response.function_call_arguments.delta", {
      output_index: 0,
      item_id: item.id,
      delta: item.arguments,
    });
    event("response.function_call_arguments.done", {
      output_index: 0,
      item_id: item.id,
      arguments: item.arguments,
    });
  } else {
    const base = { item_id: item.id, output_index: 0, content_index: 0 };
    event("response.content_part.added", {
      ...base,
      part: { type: "output_text", text: "", annotations: [] },
    });
    event("response.output_text.delta", {
      ...base,
      delta: item.content[0].text,
    });
    event("response.output_text.done", { ...base, text: item.content[0].text });
  }
  event("response.output_item.done", { output_index: 0, item });
  event("response.completed", {
    response: {
      ...response,
      status: "completed",
      output: [item],
      usage: {
        input_tokens: 100,
        output_tokens: 50,
        total_tokens: 150,
        input_tokens_details: { cached_tokens: 0 },
        output_tokens_details: { reasoning_tokens: 0 },
      },
      metadata: { demo: "true" },
    },
  });
  res.end();
}
