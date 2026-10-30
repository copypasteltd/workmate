# 阶段136发布目录修正 / Publication output correction

只读检查在任何V1审计或推送执行前发现：新发布器准备写入本轮`business-inputs-136`目录，V1审计器的输出范围却仍限制为旧`client-errors-135`目录。若直接执行会在审计前拒绝。V2统一为本轮目录；没有放宽文件范围、移除来源检查或改变产品源码。审计范围文字也改为实际已发布的阶段135基线。

V1准备器确实执行并生成了本地清单及证明分片，原始脚本、清单、证明、阶段135回执和原文档提交均保留。最终V2清单标记V1为`locally_prepared_not_published`并绑定其原提交。原V1治理说明另存历史，不重写执行原件，也不把预备绑定称为已经推送。

最终使用`docs/tools/prepare_business_inputs_publication_136_v2.py --prepare`与`docs/tools/publish_business_inputs_136_v2.py --push`。原业务资格检查点、122项后端集成、61项扩展状态、12项文件绑定及14项实际三端检查均维持原结果，未进行新的模型或整个平台重跑。远端结果以发布器原始回执为准。

Read-only review found an incompatible audit-output guard before either V1 audit or push ran. V2 limits the auditor to the actual current delivery-record directory and corrects its baseline description. It preserves every V1 script, locally prepared manifest, proof shard and original documentation commit. The final manifest explicitly labels that provisional binding as unpublished; product source and qualification remain unchanged. Publication uses the V2 tools and ordinary eight-ref push with remote SHA verification.

[最终清单](../quality/workmate-publication-136-v2.json) · [产品检查点](../quality/business-inputs-checkpoint-136.json) · [本轮变更](136-business-brief-clarification.md) · [同步规则](../governance/04-git-branches-and-publication.md)
