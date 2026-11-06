from pathlib import Path
R=Path(__file__).resolve().parents[2];D=R/'dev';web=D/'copypaste-web/src';native=D/'copypaste-desktop/renderer/src'
import json
def replace(p,old,new):
 s=p.read_text('utf8'); assert old in s,(str(p),old[:100]);p.write_text(s.replace(old,new,1),encoding='utf8',newline='\n')
p=native/'api.ts'
start=p.read_text('utf8').index('export async function download('); s=p.read_text('utf8');a=s[:start];b=s[start:]
old='      ...(tenantId ? { headers: { "X-Tenant-ID": tenantId } } : {}),';assert old in b
b=b.replace(old,'      ...(postBody === undefined ? {} : { method: "POST", body: JSON.stringify(postBody) }),\n      headers: { ...(tenantId ? { "X-Tenant-ID": tenantId } : {}), ...(postBody === undefined ? {} : { "Content-Type": "application/json", "X-CSRF-Token": csrfToken }) },',1)
old='  if (!response.ok) throw new ApiError("DOWNLOAD_UNAVAILABLE", "Download unavailable", response.status);';assert old in b
b=b.replace(old,'  if (!response.ok && postBody !== undefined) { const problem = await clientJson(response, "POST"); current(); throw new ApiError(problem?.error?.code ?? "DOWNLOAD_UNAVAILABLE", problem?.error?.message ?? "Download unavailable", response.status); }\n'+old,1)
old='  current();\n  const url = URL.createObjectURL(blob);';assert old in b
b=b.replace(old,'  current();\n  if (postBody !== undefined) { const expected = response.headers.get("x-content-sha256"); if (!expected || !/^[a-f0-9]{64}$/.test(expected) || blob.size > 8 * 1024 ** 2) throw new ApiError("DOWNLOAD_INTEGRITY", "Invalid review download", 422); const bytes = await blob.arrayBuffer(), actual = [...new Uint8Array(await crypto.subtle.digest("SHA-256", bytes))].map(n => n.toString(16).padStart(2, "0")).join(""); current(); if (actual !== expected) throw new ApiError("DOWNLOAD_INTEGRITY", "Review download checksum mismatch", 422); }\n  const url = URL.createObjectURL(blob);',1)
p.write_text(a+b,encoding='utf8',newline='\n')
# V1 stopped before the client component/versions section. Keep its executed
# source unchanged, and execute that not-yet-applied remainder exactly once.
source=(R/'docs/tools/implement-marketing-review-202-v1.py').read_text('utf8')
exec(source[source.index("\np=web/'marketing-reports.tsx'"):])
