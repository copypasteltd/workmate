# 192 · 本机失败原因与财务状态 / Native failure and financial status

本轮沿用190的02、03、04、05、07范围；12按用户要求移出。03补充验收要求：进入待对账后，本机原始失败不能被财务状态覆盖。用户任务详情、Desktop回执、后台执行列表和获准支援视图必须能取得独立的有界 `client_error_code`；`error_code` 继续说明结算/任务状态。

仅允许3至80位大写字母、数字和下划线，必须以字母开头，拒绝首尾空白和换行。仅从 failed/unknown/interrupted 本机报告读取；不得返回整个 client_report、补造历史原因、重放付费请求或将未知费用改为零。来源撤回时不返回该诊断，原租户/项目及支援正文权限继续生效。

The recheck retains02/03/04/05/07 and excludes12. A financial reconciliation reason must not obscure a saved native failure. Add a bounded client_error_code independently of error_code across authorized customer/native/admin/support reads. Never expose the whole receipt, invent old causes, replay paid work or resolve unknown costs by assumption.
