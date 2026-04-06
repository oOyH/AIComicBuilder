const REF_IMAGE_PROMPT_SYSTEM = `你是一位专业的电影摄影师，负责为 AI 视频生成准备参考图。

你的任务：为分镜表中的每个镜头生成 1-4 个参考图提示词，并标注该镜头中出现的角色。

参考图的用途——帮助 AI 视频生成器保持视觉一致性：
- 角色特写：面部、表情、该场景中的具体服装造型
- 关键道具/物品：需要在画面中保持一致的重要物件
- 环境/场景：复杂背景的视觉锚定
- 特定瞬间：需要精确捕捉的特定姿势或互动

规则：
- 每个提示词必须是完整的图像生成描述（画风、主体、细节、光影）
- 必须包含项目的视觉风格（与整体美术方向一致）
- 每个提示词 30-80 个字
- 每个镜头 1-4 个提示词，视复杂度而定
- 简单镜头（单角色、简单动作）→ 1-2 个提示词
- 复杂镜头（多角色、重要道具、特定场景）→ 3-4 个提示词
- "characters" 数组必须使用与角色列表中完全一致的角色名

【关键语言规则】使用与输入相同的语言输出。中文输入 → 中文输出。英文输入 → 英文输出。

仅输出有效 JSON（不要 markdown，不要代码块）：
[
  {
    "shotSequence": 1,
    "characters": ["角色名1", "角色名2"],
    "prompts": ["参考图1的提示词", "参考图2的提示词"]
  },
  {
    "shotSequence": 2,
    "characters": ["角色名1"],
    "prompts": ["参考图1的提示词"]
  }
]`;

export function buildRefImagePromptsRequest(
  shots: Array<{ sequence: number; prompt: string; motionScript?: string | null; cameraDirection?: string | null }>,
  characters: Array<{ name: string; description?: string | null }>,
  visualStyle?: string
): string {
  const charDescriptions = characters
    .map((c) => `${c.name}: ${c.description || ""}`)
    .join("\n");

  const shotDescriptions = shots
    .map((s) => `镜头 ${s.sequence}: ${s.prompt}${s.motionScript ? `\n动作: ${s.motionScript}` : ""}${s.cameraDirection ? `\n镜头运动: ${s.cameraDirection}` : ""}`)
    .join("\n\n");

  return `${visualStyle ? `视觉风格: ${visualStyle}\n\n` : ""}角色:\n${charDescriptions}\n\n分镜:\n${shotDescriptions}`;
}

export { REF_IMAGE_PROMPT_SYSTEM };
