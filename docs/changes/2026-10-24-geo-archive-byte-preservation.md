# 质量证据原始字节保存 / Exact quality evidence bytes

发布后补充核对实际读取 7,175 个质量文件，发现 18 项工作区原始 CRLF 字节曾在 Git 提交时转换为 LF。其中一项是 Stage83 的历史 Desktop 检查脚本；归档中的原始 `.gitattributes` 覆盖了根目录的保存规则。其余 17 项是早期质量文档和版本记录。所有差异仅为换行，JSON 内容与原始验收记录没有语义变化。

追加提交将这 18 项的 Git 对象恢复为已经留存哈希的工作区原始字节。历史归档的脚本目录新增明确标注的保存元数据，防止后续 Git 写入再次转换；原始捕获的父级规则文件仍保留原字节。新增规则属于归档保存元数据，不冒充原始源码。

[实际初始核对结果](../quality/history/stage83-quality-bytes-before-repair.json)保留原提交和差异哈希。[增量修复核对](../quality/geo-archive-byte-preservation-01.json)验证所有 18 项 Git 索引字节、原始哈希及 JSON 语义，并核对其他原质量对象未改动。发布清单属于单独生成的控制文件。产品、运行时、测试、README、媒体及六个组件提交均未变化，因此不重复产品测试；原有 968 项平台、124 项客户端和 37 项原生 Desktop 等证据保持各自既定范围。

English: An actual read-only check of 7,175 quality files found 18 prior CRLF-to-LF Git normalizations: one archived Stage83 Desktop script and 17 older quality documents. This additive correction restores their already-hashed original working bytes. New, explicitly labelled metadata prevents the captured parent Git rules from normalizing that script again; captured source files and original rule bytes are unchanged. The follow-up verifies every repair and all other original quality Git objects, with the publication control plan treated separately. Product/runtime/test bytes and the six component commits remain unchanged; no duplicate product test run or new acceptance claim is made.
