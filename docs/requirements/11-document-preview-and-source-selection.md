# 文件预览与来源选择补充 / Document preview and source selection

本补充细化原REQ063及文件／多端相关范围，不缩小原SRS的完整专业和生产验收。

| 编号 | 约束 |
|---|---|
| DP146-01 | 支持实际PDF、DOCX、XLSX、PPTX页面图像、页码和原始字节下载；不以文本清单冒充分页。 |
| DP146-02 | 新引用必须明确选择来源及固定版本；搜索与连续分页覆盖全部当前获准素材。 |
| DP146-03 | 历史版本按用户主动选择载入，来源更新不能静默替换已选择版本。 |
| DP146-04 | 预览前后均检查当前会话、租户、项目、私有权限、来源状态及摘要；缓存不替代授权。 |
| DP146-05 | 打开的预览定期复核，失权或更改后清除正文、图像及敏感标题，明确实际轮询延迟。 |
| DP146-06 | Office转换必须隔离临时配置、禁宏／外链、限制资源并回收进程；禁止本地虚拟化。 |
| DP146-07 | 不支持、超限、未配置或失败需明确反馈并保留合法原件路径，不创建伪成功。 |
| DP146-08 | Extension预览留在原生右侧栏；上传、预览、发送是客户分别触发的动作。 |
| DP146-09 | Desktop保持无边框、隐藏菜单／滚动轨道，无横向溢出；本机Codex架构不变。 |
| DP146-10 | 预览与翻页不启动AI任务、不调用模型、不产生AI费用。 |

These requirements supplement the original SRS; selected evidence proves the bounded document and source-selection increment, not full product or production acceptance.
