# 阶段141：收口默认测试入口

修正默认 `npm test` 混入保留旧失败尝试的问题，按各组最新数字版本选择当前测试，普通测试继续参与，原失败可显式复现。六项端到端入口检查、真实 npm 查看与编译通过；134组完整回归未在本轮重跑。

产品运行时与阶段140三端操作、PNG／MP4、ZIP恢复及截图／录制保持原字节。只改变测试命令和测试基础设施，补充当前源码／Git检查点；不新增完整需求验收关闭。详见[入口说明](../development/141-current-test-discovery.md)、[补充检查点](../quality/test-discovery-checkpoint-141.json)及[原完整编号](../quality/remaining-work-stage140.md)。
