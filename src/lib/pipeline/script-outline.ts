import { db } from "@/lib/db";
import { projects, episodes } from "@/lib/db/schema";
import { resolveAIProvider } from "@/lib/ai/provider-factory";
import type { ModelConfigPayload } from "@/lib/ai/provider-factory";
import { eq } from "drizzle-orm";
import type { Task } from "@/lib/task-queue";

const OUTLINE_SYSTEM = `你是一位屡获殊荣的编剧。根据用户的创意构想，生成一份简洁的故事大纲。

输出格式——纯文本时间轴，不要JSON，不要markdown：

前提：（一句话核心冲突）

1. [节拍名] (占比XX%)
   事件：……
   情感：……

2. [节拍名] (占比XX%)
   事件：……
   情感：……

3. [节拍名] (占比XX%)
   事件：……
   情感：……

高潮：……
结局：……

要求：
- 3-5个关键节拍，每个包含事件和情感转变
- 占比之和应为100%
- 语言规则：使用与用户输入相同的语言（中文输入→中文输出，英文输入→英文输出）
- 直接输出内容，不要任何包裹或标记`;

export async function handleScriptOutline(task: Task) {
  const payload = task.payload as {
    projectId: string;
    episodeId?: string;
    idea: string;
    modelConfig?: ModelConfigPayload;
    userId?: string;
  };

  const { projectId, episodeId, idea } = payload;

  const ai = resolveAIProvider(payload.modelConfig);
  const result = await ai.generateText(`创意构想：${idea}`, {
    systemPrompt: OUTLINE_SYSTEM,
    temperature: 0.7,
  });

  const outline = result.trim();

  // Save outline
  if (episodeId) {
    await db
      .update(episodes)
      .set({ outline, updatedAt: new Date() })
      .where(eq(episodes.id, episodeId));
  } else {
    await db
      .update(projects)
      .set({ outline, updatedAt: new Date() })
      .where(eq(projects.id, projectId));
  }

  return { outline };
}
