"""Author the proposed role catalog/schema; never installs skills or calls AI."""
from pathlib import Path
import json

OUT = Path(__file__).resolve().parents[1] / 'contracts'
VERSION = '1.0.0'

# Logical product packages. Candidate sources are references, not deployed skills.
SKILLS = [
    ('delivery-core', '版本化交付与局部修改', [], ['asset.read','asset.write','delivery.package']),
    ('fullstack-engineering', '全栈业务实现', [], ['code.read','code.patch','process.run.allowed']),
    ('frontend-implementation', '前端组件与响应式实现', ['frontend-design'], ['code.read','code.patch','process.run.allowed','browser.preview']),
    ('backend-api', '接口、数据与服务实现', [], ['code.read','code.patch','api.test','database.test.native']),
    ('qa-testing', '验收、缺陷与回归', [], ['code.read','code.patch','api.test','browser.preview','process.run.allowed']),
    ('ux-research', '用户流程与交互设计', ['ui-ux-pro-max'], ['asset.read','asset.write']),
    ('ui-system', '组件与视觉规范', ['ui-ux-pro-max','frontend-design'], ['layout.render','browser.preview']),
    ('creative-direction', '设计简报与创意方向', ['frontend-design'], ['asset.read','asset.write']),
    ('image-art-direction', '图像构图、参考与一致性', ['image_gen_prompting_guide'], ['asset.read','asset.write']),
    ('image2-production', '内部 Image 2 生图与编辑', ['image_gen_gpt_image2'], ['image.generate.internal','image.edit.internal']),
    ('brand-system', '品牌视觉系统与应用', [], ['vector.render','layout.render','font.inspect']),
    ('ad-creative', '广告创意和规格变体', ['video-cut-ad-creative'], ['layout.render','asset.write']),
    ('ecommerce-visual', '商品一致性与详情物料', ['image_gen_ecommerce'], ['asset.read','layout.render']),
    ('social-content', '社媒系列内容与轮播', [], ['asset.write','layout.render']),
    ('illustration-ip', '插画角色与系列连续性', [], ['asset.read','asset.write']),
    ('typography-layout', '字体、繁英排版与校样', [], ['font.inspect','layout.render','document.render']),
    ('presentation-production', '可编辑演示及逐页渲染', ['presentations:Presentations'], ['slides.build','slides.render']),
    ('landing-page', '转化路径与落地页设计', ['frontend-design','ui-ux-pro-max'], ['code.read','code.patch','browser.preview']),
    ('dataviz', '信息图及可复算图表', ['spreadsheets:Spreadsheets'], ['sheet.calculate','chart.render']),
    ('deterministic-metrics', '确定性指标与数据口径', ['spreadsheets:Spreadsheets'], ['sheet.calculate','dataset.read']),
    ('video-storyboard', '视频脚本与分镜', ['video-cut-video-content-strategist'], ['asset.read','asset.write']),
    ('motion-composition', '时间线、字幕及动效', ['hyperframes:hyperframes','video-cut-timeline'], ['timeline.edit','video.render']),
    ('media-render', '成片、编码与播放验证', ['video-cut-ffmpeg'], ['video.render','media.inspect']),
    ('ads-analysis', '广告及网站证据复盘', ['video-cut-campaign-analytics'], ['dataset.read','connector.read']),
    ('workflow-design', '流程诊断与 SOP', [], ['workflow.validate','asset.write']),
    ('workflow-execution', '有界流程执行与恢复', [], ['workflow.run','connector.read']),
    ('video-generation', '内部生成式视频作业', [], ['video.generate.internal']),
    ('speech-production', '内部配音与字幕作业', [], ['speech.generate.internal']),
]

# number, key, label, category, required skills, required input, optional input,
# process, deliverables (label:format), example, normal/revision/failure evidence.
ROLES = [
    (1,'fullstack','全栈开发工程师','engineering',
     'fullstack-engineering frontend-implementation backend-api qa-testing',
     'business_goal runtime_target', 'repository api_constraints brand_assets',
     '业务验收与接口设计→前后端实现→原生构建和集成验证→源码与运行交接',
     '前后端源码:source;接口契约:json;启动与验证说明:md',
     '做一个有客户登录、素材上传和审核状态的小工具。',
     '按说明启动前后端并完成客户登录至审批的关键业务闭环。',
     '修改一个字段后迁移、API 与页面同步更新，原交付版本仍能定位。',
     '运行环境或数据库缺失时给出阻塞及已有成果，不声称服务已启动。'),
    (2,'frontend','前端开发工程师','engineering',
     'frontend-implementation ui-system qa-testing',
     'page_goal runtime_target', 'design_assets api_contract brand_assets',
     '组件和状态设计→页面交互实现→响应式与键盘验证→源码与组件交付',
     '页面和组件:source;交互检查记录:md',
     '把这个设计做成可用的客户资料页面。',
     '页面可构建并操作，加载、空、错误、提交状态有运行证据。',
     '局部组件修改生成新版本且保持其他页面关键交互。',
     '接口未接通时明确开发 mock，浏览器失败/取消后清理本任务不用页面。'),
    (3,'backend-api','后端与 API 工程师','engineering',
     'backend-api qa-testing',
     'business_rules runtime_target', 'api_consumers auth_policy data_samples',
     '接口和数据契约→服务及迁移实现→权限幂等异常验证→接口与运维交接',
     '服务代码及迁移:source;API 契约:json;接口测试报告:md',
     '为现有网站增加素材审批 API。',
     '服务响应、迁移和权限行为符合接口约定，保留测试证据。',
     '修改一项业务规则后契约、代码、迁移影响与测试一起更新。',
     '无权限数据库或未授权生产目标不得写入，依赖阻塞清晰记录。'),
    (4,'software-qa','软件测试工程师','engineering',
     'qa-testing frontend-implementation',
     'acceptance_scope test_target', 'test_accounts requirement_files',
     '范围与场景→API和页面验证→证据与缺陷→回归测试及报告',
     '测试场景与缺陷:md;可执行回归测试:source;证据清单:json',
     '验证这个客户后台从登录到导出是否可用。',
     '缺陷具有版本、步骤、预期实际和可核查证据。',
     '修复后重跑受影响场景，保留前后结果及覆盖缺口。',
     '账号失效标记环境阻塞，失败/取消均回收测试创建的无用 tab/context。'),
    (5,'ui-ux','UI/UX 设计师','design',
     'ux-research ui-system frontend-implementation',
     'users primary_goal', 'brand_assets key_screens research_material',
     '用户流程与信息架构→线框和组件规范→交互原型→状态检查与开发交接',
     '用户流程与规范:md;可交互原型:html;设计交接:json',
     '为广告分析工具设计从导入到复盘的流程。',
     '原型可操作，主流程及空错等待态齐全，关键组件可供开发复用。',
     '修改一个流程后相关原型、状态和规范同步，保留基版本。',
     '缺用户目标时就地补齐；可选图片能力不可用不阻止纯交互原型。'),
    (6,'designer','设计师','design',
     'creative-direction image-art-direction image2-production typography-layout',
     'purpose approved_copy output_specs', 'brand_assets reference_assets',
     '设计简报和视觉方向→Image 2真实生图编辑→真实字体分层排版→规格检查及交付',
     '主视觉及尺寸变体:png;可恢复布局:json;素材字体清单:json',
     '用这款产品和品牌色做一组繁中、英文推广海报。',
     '经内部 Image 2 交付真实图片，繁英价格准确，品牌和商品对照通过。',
     '仅改价格保留背景、仅改背景保留文字；版本、成本与修改范围可查。',
     '内部 Image 2 或必需 Skill 未验证时禁止直接出图，不静默改模型。'),
    (7,'brand-visual','品牌视觉设计师','design',
     'brand-system image-art-direction image2-production typography-layout',
     'brand_position audience applications', 'existing_logo font_assets reference_assets',
     '方向板与定位→标识和视觉探索→字体色彩及应用→规范和素材交接',
     '品牌规范:pdf;标识矢量与位图:svg;包装应用版面:json',
     '为香港咖啡品牌做视觉系统和开业物料。',
     '标识提案与名片、包装应用遵守统一规范，矢量文件可实际解析。',
     '修改品牌主色后应用稿和规范同步生成新版本。',
     '矢量工具缺失不得用位图改后缀冒充，字体来源缺口可定位。'),
    (8,'ad-creative','广告创意设计师','design',
     'ad-creative image-art-direction image2-production typography-layout',
     'product_facts audience channels output_matrix', 'brand_assets performance_brief',
     '创意假设和文案→主视觉→语言尺寸变体→渠道检查及测试矩阵',
     '广告素材矩阵:png;可编辑布局:json;测试假设:md',
     '为同一产品做三种方向、繁中英文、三个尺寸的广告。',
     '18 单元文件、文案、规格和状态一致，真实图片可用。',
     '只修改一个变体，不重做或重复计费其余已完成单元。',
     '某单元生图失败时保留局部成功和可重试范围，未授权不得发布广告。'),
    (9,'ecommerce','电商商品设计师','design',
     'ecommerce-visual image-art-direction image2-production typography-layout',
     'product_references product_facts output_specs', 'brand_assets protected_features',
     '锁定商品特征→主图场景和卖点→详情页物料→一致性和规格检查',
     '商品图及详情物料:png;详情布局:json;商品一致性记录:md',
     '保留瓶身标签，做白底主图及三张生活场景图。',
     '形状、标签和关键属性与商品参考一致，每张原尺寸文件可下载。',
     '替换场景保留商品身份，不改既有卖点事实与标签。',
     '无真实商品参考先收集必要素材，不自行虚构商品外观或性能。'),
    (10,'social-content','社媒内容设计师','design',
     'social-content image2-production typography-layout',
     'platform theme language quantity', 'brand_assets date_range product_facts',
     '主题与文案→系列视觉和轮播→平台规格检查→日历与素材包',
     '系列帖文轮播:png;可编辑文字布局:json;内容日历:csv',
     '准备下周五篇 Instagram 内容和两组轮播。',
     '轮播顺序、视觉、文案和日历逐项对应，文件可编辑复用。',
     '改一篇内容时系列规范保留，日历和素材关系同步。',
     '平台发布授权缺失不影响素材交付，也不宣称已发布。'),
    (11,'illustration-ip','插画与 IP 设计师','design',
     'illustration-ip image-art-direction image2-production',
     'character_brief visual_style output_specs', 'reference_assets scene_brief',
     '角色设定→参考图→姿态表情场景延展→连续性比对与套图交付',
     '角色及场景插画:png;角色设定和一致性说明:md',
     '做一个品牌吉祥物及六种工作表情。',
     '各图角色身份和风格一致，数量与尺寸齐全。',
     '指定姿态修订基于接受参考版本，其他图保持可追溯。',
     '身份偏移或缺失参考时标记返工，不能把不一致套图报完整通过。'),
    (12,'typography-layout','字体与版式设计师','design',
     'typography-layout image-art-direction image2-production',
     'approved_copy language output_specs', 'font_assets brand_assets print_specs',
     '字形与文字层级→栅格及繁英混排→缺字溢出与印刷校样→编辑源及导出',
     '海报册页包装版面:pdf;可编辑文字布局:json;字形视觉方案:png',
     '把繁中英文菜单排成可修改的双面印刷版。',
     '正文逐字准确可编辑，输出符合已确认出血和色彩规格。',
     '修改文案后真实字体重排，检查换行、溢出和跨页影响。',
     '缺字或字体不可用提示具体位置，艺术字图像不冒充可安装字库。'),
    (13,'presentation','演示文稿设计师','design',
     'presentation-production typography-layout dataviz',
     'audience purpose source_material page_count', 'brand_assets illustration_brief',
     '叙事结构→页面与图表→可编辑PPTX→逐页渲染及源文件交付',
     '可编辑演示:pptx;演示校样:pdf;图表源数据:csv',
     '把市场报告做成 15 页客户提案。',
     '文字图表可编辑，PPTX/PDF 一致，无缺字溢出且数字可追溯。',
     '修改一页图表并重渲染，图表数值与源数据一致。',
     '缺少数据来源提示限制；不可用整页图片冒充可编辑演示。'),
    (14,'landing-page','网页与落地页设计师','design',
     'landing-page ui-system frontend-implementation image2-production',
     'campaign_goal audience primary_action', 'brand_assets form_contract analytics_contract',
     '信息与转化路径→视觉配图→页面实现→响应式表单验证与发布交接',
     '可运行落地页:html;视觉素材:png;表单和埋点约定:json',
     '做一页收集企业试用申请的双语落地页。',
     '页面可运行、视觉资源一致、主要行动和表单行为有验证。',
     '修改首屏活动信息不破坏表单，双语版本一致更新。',
     '无域名或部署权限时只交付可运行页面，不擅自上线或接入追踪服务。'),
    (15,'information-design','信息图与数据可视化设计师','design',
     'dataviz deterministic-metrics typography-layout',
     'dataset metric_definitions output_medium', 'brand_assets audience',
     '数据检查与计算→图形和信息层级→图表及信息图渲染→数值复核和数据交付',
     '信息图:svg;交互报告:html;图表源数据:csv',
     '把月度广告数据做成管理层信息图。',
     '坐标和数字由计算绘图工具产生，单位、时间、币种和表格替代齐全。',
     '更换数据后图表、说明和表格一致，保留旧快照。',
     '零分母或缺转化保留未知，不用生成图像编造图表数字。'),
    (16,'video-motion','视频与动效设计师','design',
     'video-storyboard motion-composition media-render',
     'purpose duration aspect_ratio source_assets', 'approved_copy brand_assets audio_rights',
     '脚本分镜→素材与时间线→字幕片头转场→真实渲染和播放校验',
     '可播放成片:mp4;可恢复时间线:json;分镜与字幕:md',
     '用产品图做一条 15 秒竖版促销视频，有片头和价格动效。',
     'MP4 可播放且时长比例字幕音轨正确，时间线可恢复。',
     '修改价格字幕和一个转场后只生成新版本，帧与字幕同步。',
     '基础模板无需生成式视频；可选生成视频或配音缺失只阻塞相应步骤。'),
    (17,'marketing-analyst','营销数据分析师','marketing',
     'ads-analysis deterministic-metrics dataviz',
     'data_source date_range currency conversion_definition', 'brand_assets creative_mapping website_data',
     '映射和口径检查→确定性计算→渠道创意网站复盘→证据报告及测试brief',
     '证据报告:html;指标与图表数据:csv;创意测试brief:md',
     '分析上月广告花费和落地页，给出下月创意建议。',
     '关键数字能回溯快照和公式，缺失、多币种、平台归因明确。',
     '更新日期范围后计算和解释同步，不继承过期结论。',
     '账户未授权时支持用户导入的获准数据，不伪造平台取数结果。'),
    (18,'workflow-consultant','企业流程自动化顾问','operations',
     'workflow-design workflow-execution',
     'current_process input_output exception_examples', 'systems permissions frequency',
     '现状与重复点→SOP和流程依赖→有界流程版本→试运行及异常恢复',
     'SOP及责任说明:md;可执行流程版本:json;异常恢复记录:md',
     '把每周报表整理和内部审批变成可复用流程。',
     '流程输入输出责任和失败策略明确，承诺执行的版本有真实运行成果。',
     '修改一项流程后新运行采用新版，旧运行保持原方法。',
     '重复触发不重复外部写入，连接撤销后禁止后续调用。'),
]

def build_catalog():
    skill_rows = []
    for key, purpose, candidates, tools in SKILLS:
        dependency = {'image2-production':'internal-image2-v1', 'video-generation':'internal-video-v1', 'speech-production':'internal-speech-v1'}.get(key)
        skill_rows.append({'skill_key':key, 'version':VERSION, 'purpose':purpose,
                           'candidate_sources':candidates, 'package_state':'planned', 'package_sha256':None,
                           'ai_network_policy':'internal_only', 'tool_ids':tools,
                           'required_model_profiles':[dependency] if dependency else [],
                           'supported_clients':['web','extension','desktop']})
    by_key = {r['skill_key']:r for r in skill_rows}
    roles = []
    for n,key,label,category,required,inputs,optional,workflow,deliverables,sample,normal,revision,failure in ROLES:
        mandatory = required.split() + ['delivery-core']
        optional_skills = []
        if n in [2,5,13,15,16]:
            optional_skills.append('image2-production')
        if n == 16:
            optional_skills += ['video-generation','speech-production']
        bindings = [{'skill_key':k, 'version':VERSION, 'required':k in mandatory} for k in mandatory+optional_skills]
        profiles = [{'profile_key':'internal-text-v1', 'required':True}]
        for binding in bindings:
            for dep in by_key[binding['skill_key']]['required_model_profiles']:
                profiles.append({'profile_key':dep, 'required':binding['required']})
        steps = workflow.split('→')
        roles.append({'role_key':key, 'catalog_id':f'R{n:02d}', 'version':VERSION, 'display_name':label,
                      'category':category, 'status':'design_only', 'runtime_profile':'codex-internal-v1',
                      'skill_bindings':bindings, 'model_bindings':profiles,
                      'tool_ids':sorted({tool for k in mandatory+optional_skills for tool in by_key[k]['tool_ids']}),
                      'input_contract':{'required_fields':inputs.split(), 'optional_fields':optional.split()},
                      'workflow':[{'step_key':f'step-{i+1}', 'instruction':text} for i,text in enumerate(steps)],
                      'deliverables':[{'label':item.rsplit(':',1)[0], 'format':item.rsplit(':',1)[1],
                                       'editable_scope':'按角色约定保存源代码、文字/图表、产品布局或时间线；第三方专业工程需独立验证。'} for item in deliverables.split(';')],
                      'sample_task':sample, 'acceptance_checks':[normal,revision,failure],
                      'qualification_cases':{'normal':normal, 'revision':revision, 'dependency_or_permission_failure':failure, 'execution_status':'not_run'},
                      'initial_stage':'M2' if n==18 else 'M1', 'readiness_evidence':[]})
    models = []
    for key,kind,requested,official,protocol in [
        ('internal-text-v1','text','gpt 6 luna max',None,'openai_responses'),
        ('internal-image2-v1','image','Image 2','gpt-image-2','openai_images'),
        ('internal-video-v1','video','内部生成式视频能力（型号待选）',None,'openai_compatible_pending_verification'),
        ('internal-speech-v1','audio','内部配音能力（型号待选）',None,'openai_audio'),
    ]:
        models.append({'profile_key':key, 'kind':kind, 'requested_model':requested,
                       'official_model_reference':official, 'internal_model_alias':None,
                       'gateway_route':'company_internal', 'wire_protocol':protocol,
                       'verification_state':'unverified', 'silent_substitution_allowed':False})
    return {'catalog_version':VERSION, 'status':'design_only', 'origin_id':'ROLE01',
            'minimum_qualified_roles':12, 'required_categories':['engineering','design'],
            'required_role_keys':['designer'], 'all_ai_via_internal_gateway':True,
            'runtime_profiles':[{'profile_key':'codex-internal-v1','kernel':'codex',
                                 'pinned_runtime_version':None, 'verification_state':'unverified',
                                 'skill_loading':'bound_required_at_step_optional_on_demand'}],
            'model_profiles':models, 'skill_catalog':skill_rows, 'roles':roles}

def build_schema():
    text = {'type':'string','minLength':1}
    version = {'type':'string','pattern':r'^\d+\.\d+\.\d+$'}
    texts = {'type':'array','items':text,'uniqueItems':True}
    nonempty = {**texts,'minItems':1}
    def obj(properties):
        return {'type':'object','properties':properties,'required':list(properties),'additionalProperties':False}
    def arr(item,minimum=0):
        return {'type':'array','items':item,'minItems':minimum}
    defs = {
        'runtime':obj({'profile_key':text,'kernel':{'const':'codex'},'pinned_runtime_version':{'type':['string','null']},
                       'verification_state':{'const':'unverified'},'skill_loading':text}),
        'model':obj({'profile_key':text,'kind':{'enum':['text','image','video','audio']},'requested_model':text,
                     'official_model_reference':{'type':['string','null']},'internal_model_alias':{'type':['string','null']},
                     'gateway_route':{'const':'company_internal'},'wire_protocol':text,
                     'verification_state':{'const':'unverified'},'silent_substitution_allowed':{'const':False}}),
        'skill':obj({'skill_key':text,'version':version,'purpose':text,'candidate_sources':texts,
                     'package_state':{'const':'planned'},'package_sha256':{'type':'null'},
                     'ai_network_policy':{'const':'internal_only'},'tool_ids':nonempty,
                     'required_model_profiles':texts,'supported_clients':{'const':['web','extension','desktop']}}),
        'binding':obj({'skill_key':text,'version':version,'required':{'type':'boolean'}}),
        'model_binding':obj({'profile_key':text,'required':{'type':'boolean'}}),
        'step':obj({'step_key':text,'instruction':text}),
        'deliverable':obj({'label':text,'format':text,'editable_scope':text}),
        'qualification':obj({'normal':text,'revision':text,'dependency_or_permission_failure':text,
                             'execution_status':{'const':'not_run'}}),
    }
    defs['role'] = obj({'role_key':text,'catalog_id':{'type':'string','pattern':'^R[0-9]{2}$'},
                        'version':version,'display_name':text,'category':{'enum':['engineering','design','marketing','operations']},
                        'status':{'const':'design_only'},'runtime_profile':text,
                        'skill_bindings':arr({'$ref':'#/$defs/binding'},2),
                        'model_bindings':arr({'$ref':'#/$defs/model_binding'},1),'tool_ids':nonempty,
                        'input_contract':obj({'required_fields':nonempty,'optional_fields':texts}),
                        'workflow':arr({'$ref':'#/$defs/step'},2),'deliverables':arr({'$ref':'#/$defs/deliverable'},1),
                        'sample_task':text,'acceptance_checks':{**nonempty,'minItems':3},
                        'qualification_cases':{'$ref':'#/$defs/qualification'},'initial_stage':{'enum':['M1','M2']},
                        'readiness_evidence':{'type':'array','maxItems':0}})
    schema = obj({'catalog_version':version,'status':{'const':'design_only'},'origin_id':{'const':'ROLE01'},
                  'minimum_qualified_roles':{'type':'integer','minimum':12},
                  'required_categories':{'const':['engineering','design']},'required_role_keys':{'const':['designer']},
                  'all_ai_via_internal_gateway':{'const':True},'runtime_profiles':arr({'$ref':'#/$defs/runtime'},1),
                  'model_profiles':arr({'$ref':'#/$defs/model'},2),'skill_catalog':arr({'$ref':'#/$defs/skill'},1),
                  'roles':arr({'$ref':'#/$defs/role'},12)})
    return {'$schema':'https://json-schema.org/draft/2020-12/schema',
            '$id':'https://contracts.example.invalid/role-preset-catalog.schema.json',
            'description':'Documentation design snapshot. Operational publication/readiness are separate product resources.',
            **schema,'$defs':defs}

def generate():
    for name,value in [('role-preset-catalog.json',build_catalog()),('role-preset-catalog.schema.json',build_schema())]:
        (OUT/name).write_text(json.dumps(value,ensure_ascii=False,indent=2)+'\n',encoding='utf-8')

if __name__ == '__main__':
    generate()
    print('Generated 18 proposed roles and 28 logical skills; runtime qualification remains not_run.')
