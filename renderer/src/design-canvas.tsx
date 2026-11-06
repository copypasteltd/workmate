import { useEffect, useRef, useState, type PointerEvent } from "react";
import { api } from "./api";
import { ErrorNotice, useI18n } from "./ui";
import { gestureLayer, type CanvasLayer, type CanvasScene } from "./design-editor-model";

export function DesignCanvas({ root, current, input, page, selected, disabled, unsaved, select, commit }: {
  root: string; current: any; input: any; page: number; selected: number; disabled: boolean; unsaved: boolean;
  select: (index: number) => void; commit: (layer: CanvasLayer) => void;
}) {
  const { t } = useI18n(), scene: CanvasScene = current.kind === "vector" ? input.scene : input.slides[page].scene;
  const [preview, setPreview] = useState<{ signature: string; url: string } | null>(null), [error, setError] = useState<unknown>(null), [retry, setRetry] = useState(0);
  const [ghost, setGhost] = useState<CanvasLayer | null>(null), svg = useRef<SVGSVGElement>(null), sequence = useRef(0);
  const drag = useRef<{ pointer: number; x: number; y: number; layer: CanvasLayer; resize: boolean; scaleX: number; scaleY: number } | null>(null);
  const signature = JSON.stringify({ id: current.id, base: current.version, head: current.current_version, page, input }), signatureRef = useRef(signature); signatureRef.current = signature;
  useEffect(() => {
    const stamp = ++sequence.current, controller = new AbortController(); setError(null);
    const timer = setTimeout(() => {
      void api(`${root}/${current.id}/draft-preview`, { method: "POST", signal: controller.signal,
        body: JSON.stringify({ expected_version: current.current_version, source_version: current.version, input, page: page + 1 }) })
        .then(async v => { if (stamp !== sequence.current || controller.signal.aborted || signatureRef.current !== signature) return;
          if (v.content_type !== "image/png" || typeof v.base64 !== "string" || v.saved !== false || v.provider_calls !== 0
            || v.project_id !== current.id || v.source_version !== current.version || v.current_version !== current.current_version || v.page !== page + 1) throw Error("Preview unavailable");
          const bytes = Uint8Array.from(atob(v.base64), c => c.charCodeAt(0)), digest = [...new Uint8Array(await crypto.subtle.digest("SHA-256", bytes))].map(b => b.toString(16).padStart(2, "0")).join("");
          if (v.bytes !== bytes.length || v.sha256 !== digest) throw Error("Preview integrity check failed");
          if (stamp !== sequence.current || controller.signal.aborted || signatureRef.current !== signature) return;
          setPreview({ signature, url: "data:image/png;base64," + v.base64 });
        }).catch(e => { if (stamp === sequence.current && !controller.signal.aborted && signatureRef.current === signature) { setPreview(null); setError(e); } });
    }, 450);
    return () => { clearTimeout(timer); controller.abort(); sequence.current++; };
  }, [root, signature, retry]);
  useEffect(() => { drag.current = null; setGhost(null); }, [signature]);
  function begin(e: PointerEvent<SVGElement>, index: number, resize = false) {
    if (disabled || e.button !== 0 || !svg.current || drag.current) return;
    const rect = svg.current.getBoundingClientRect(); if (!rect.width || !rect.height) return;
    e.preventDefault(); e.stopPropagation(); select(index); e.currentTarget.focus();
    const layer = scene.layers[index]; drag.current = { pointer: e.pointerId, x: e.clientX, y: e.clientY, layer, resize, scaleX: scene.width / rect.width, scaleY: scene.height / rect.height };
    setGhost(layer); svg.current.setPointerCapture(e.pointerId);
  }
  function move(e: PointerEvent<SVGSVGElement>) {
    const d = drag.current; if (!d || d.pointer !== e.pointerId) return;
    setGhost(gestureLayer(scene, d.layer, (e.clientX - d.x) * d.scaleX, (e.clientY - d.y) * d.scaleY, d.resize));
  }
  function finish(e: PointerEvent<SVGSVGElement>, cancel = false) {
    const d = drag.current; if (!d || d.pointer !== e.pointerId) return;
    drag.current = null; setGhost(null);
    if (svg.current?.hasPointerCapture(e.pointerId)) svg.current.releasePointerCapture(e.pointerId);
    if (!cancel && !disabled) { const next = gestureLayer(scene, d.layer, (e.clientX - d.x) * d.scaleX, (e.clientY - d.y) * d.scaleY, d.resize);
      if (JSON.stringify(next) !== JSON.stringify(d.layer)) commit(next); }
  }
  const layer = ghost ?? scene.layers[selected], ready = preview?.signature === signature, handle = Math.max(16, scene.width / 30);
  return <section className="design-canvas" aria-label={t("直接編輯畫布", "Direct design canvas")}>
    <div className="design-canvas-caption"><strong>{t("草稿畫布", "Draft canvas")}</strong><span>{scene.width} × {scene.height} · {page + 1}</span></div>
    <p className="muted">{t("選擇圖層後拖動，拖動右下角調整尺寸。方向鍵微調，Shift 加快；儲存後才會建立版本。", "Select and drag a layer. Resize from its lower-right corner. Arrow keys nudge; Shift moves faster. Save to create a version.")}</p>
    <div className="design-canvas-stage" style={{ aspectRatio: `${scene.width}/${scene.height}`, background: scene.background }} aria-busy={!ready && !error}>
      {ready && <img src={preview!.url} alt={unsaved ? t("目前未儲存草稿的實際預覽", "Actual preview of the current unsaved draft") : t(`已儲存版本 v${current.version} 的實際預覽`, `Actual preview of saved version v${current.version}`)} draggable={false} />}
      {!ready && <div className="design-canvas-wait" role="status">{error ? t("草稿預覽暫不可用", "Draft preview unavailable") : t("正在繪製目前草稿…", "Rendering this draft…")}</div>}
      <svg ref={svg} viewBox={`0 0 ${scene.width} ${scene.height}`} role="group" aria-label={t("畫布圖層操作", "Canvas layer controls")}
        onPointerMove={move} onPointerUp={e => finish(e)} onPointerCancel={e => finish(e, true)} onLostPointerCapture={() => { drag.current = null; setGhost(null); }}
        onKeyDown={e => {
          const target = (e.target as SVGElement).closest("[data-canvas-layer]"); if (disabled || !target || e.altKey || e.ctrlKey || e.metaKey) return;
          const index = Number(target.getAttribute("data-canvas-layer")), l = scene.layers[index]; if (!l) return;
          const step = e.shiftKey ? 10 : 1, delta = ({ ArrowLeft: [-step, 0], ArrowRight: [step, 0], ArrowUp: [0, -step], ArrowDown: [0, step] } as Record<string, number[]>)[e.key];
          if (delta) { e.preventDefault(); select(index); commit(gestureLayer(scene, l, delta[0], delta[1], target.hasAttribute("data-resize"))); }
          if (e.key === "Escape") { e.preventDefault(); drag.current = null; setGhost(null); }
        }}>
        {scene.layers.map((l, i) => <rect key={l.id} data-canvas-layer={i} x={l.x} y={l.y} width={l.w} height={l.h} className="design-layer-hit" role="button" tabIndex={disabled ? -1 : 0}
          aria-disabled={disabled} aria-pressed={selected === i} aria-label={`${t("圖層", "Layer")} ${i + 1}: ${String(l.text ?? l.alt ?? l.title ?? l.kind).slice(0, 100)}`}
          onClick={() => select(i)} onFocus={() => select(i)} onPointerDown={e => begin(e, i)} />)}
        {layer && <rect x={layer.x} y={layer.y} width={layer.w} height={layer.h} className="design-layer-selection" vectorEffect="non-scaling-stroke" />}
        {layer && !disabled && <rect data-canvas-layer={selected} data-resize="true" x={layer.x + layer.w - handle} y={layer.y + layer.h - handle} width={handle} height={handle}
          role="button" tabIndex={0} aria-label={t("調整所選圖層尺寸", "Resize selected layer")} className="design-layer-handle" vectorEffect="non-scaling-stroke" onPointerDown={e => begin(e, selected, true)} />}
      </svg>
    </div>
    <div className="design-preview-status" role="status">{ready ? unsaved ? t("草稿預覽已更新 · 尚未儲存", "Draft preview updated · not saved") : t(`預覽已更新 · 已儲存 v${current.version}`, `Preview updated · saved v${current.version}`) : null}</div>
    <ErrorNotice error={error} />{!!error && <button className="text-button" onClick={() => setRetry(v => v + 1)}>{t("重新繪製草稿", "Render draft again")}</button>}
  </section>;
}
