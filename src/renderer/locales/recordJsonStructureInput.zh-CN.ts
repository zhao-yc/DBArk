import {objectMemberMoveZh} from './objectMemberMove.zh-CN';
/** 记录结构操作文案集中管理，原始 JSON token 与位置使用不同输入契约。 */
export const recordJsonStructureInputZh={root:'根值不能删除或改名，请使用值编辑',member:'只有对象成员可以改名',object:'只有对象可以追加成员',array:'只有数组可以插入或移动元素',empty:'空数组没有可移动元素',kind:'操作类型已经变化，请重新打开结构操作',index:'请输入从0开始的完整十进制数组下标',limited:'结构操作的原始输入超过单字段预算',
  more:'结构操作',title:'JSON 结构编辑',close:'关闭结构输入',details:'原始值与结构路径',token:'原始 JSON token',path:'操作的结构化路径',keyLabel:'成员名称 JSON 字符串',valueLabel:'新 JSON 值',indexLabel:'插入下标（从 0 开始）',fromLabel:'原下标（从 0 开始）',toLabel:'目标下标（从 0 开始）',hint:'成员名称和字符串值须加双引号；暂存后仍需预览并确认。',removeHint:'暂存后仍需本页数据修改预览提交，才会移除此 JSON 条目。',scope:'保留其它原文与精确数字，并校验完整字段的长度、深度和节点数。',
  actions:{rename:'重命名 JSON 成员',remove:'移除 JSON 条目','append-member':'追加 JSON 成员','insert-element':'插入 JSON 元素','move-element':'移动 JSON 元素','move-member':objectMemberMoveZh.title},
} as const;
