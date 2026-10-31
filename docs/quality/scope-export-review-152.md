# REQ-049 限定只讀復核 / Bounded independent review

範圍：需求18與src/scope-export.ts、scope-export-catalog.ts、db.ts及既有來源讀取鏈。使用security-review及spec-to-code-compliance，分別執行單項規格檢查與獨立反證，沒有擴大為全平台審計。

| 編號 | 原問題 | 最終修正 |
|---|---|---|
| 1 | cp_app沒有控制專用feedback/publication表SELECT | 保留授權，改受控DTO與同PG snapshot |
| 2 | Admin經私人video/group父記錄取得無private_owner子表正文 | 父selector明確排除私人內容 |
| 3 | Admin控制讀繞過dataset/mapping/report來源隔離 | 明確可用來源、source_state與固定版本檢查 |
| 4 | workflow cached results/named_outputs仍可讀撤回來源 | 復用正常retained source readers與固定輸出檢查 |
| 5 | 原CSV和部分workflow欄位遺漏，錯列靜默null | 原始輸入與正確欄位投影；直接列參照及真實schema逐欄檢查 |
| 6 | 回應交接後慢接收可長期保留暫存/打包槽 | 檔案回應流繼承五分鐘AbortSignal，close清理 |
| 7 | workflows根排除撤回origin，但workflow_versions較寬父CTE仍輸出歷史正文 | 統一父selector、origin及逐版本read-task可用性；新增實際Worker工作流後撤回來源的定向檢查 |

獨立反證最終未發現限定主鏈中的剩餘確鑿阻斷。此結論是靜態只讀複核，不能替代運行證據；backend05的9項和ui03的6組實際下載另有不可變原始報告。大型下載、五分鐘慢接收實機矩陣、全平台/跨OS與生產驗收沒有在本次執行。

The independent refutation found no remaining confirmed blocker within this bounded export chain. Runtime claims are limited to the separate targeted backend and actual-client evidence. No whole-product acceptance is implied.
