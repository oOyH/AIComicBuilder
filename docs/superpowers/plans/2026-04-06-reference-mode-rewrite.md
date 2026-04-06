# Reference Mode Pipeline Rewrite

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Completely rewrite the reference image generation pipeline as an independent 5-step flow that never touches firstFrame/lastFrame/videoUrl fields.

**Architecture:** The reference mode pipeline operates as 5 sequential steps, each with its own batch button in the storyboard toolbar and its own section in the shot card. Data flows through: shot text → ref image prompts (RefImage[]) → ref images → video prompt → video. All reference data lives in `referenceImages` (JSON), `sceneRefFrame`, `referenceVideoUrl` — never touching keyframe fields.

**Tech Stack:** Next.js 16, React 19, TypeScript, SQLite/Drizzle ORM, Zustand

---

## The 5-Step Reference Mode Flow

| Step | Input | Output | DB Field |
|------|-------|--------|----------|
| 1. Generate Storyboard | Script + Characters | Shot descriptions, duration, dialogues | `prompt`, `motionScript`, `duration` etc |
| 2. Generate Ref Image Prompts | Shot descriptions + Characters | 1-4 prompts per shot | `referenceImages` (RefImage[] with status=pending) |
| 3. Generate Ref Images | Ref prompts + Character images | Generated images | `referenceImages` (RefImage[] with status=generated) |
| 4. Generate Video Prompts | Ref images + Shot descriptions | Video generation prompt | `videoPrompt` |
| 5. Generate Videos | Ref images + Video prompt + Character images | Video | `referenceVideoUrl` |

## File Map

| File | Change | Purpose |
|------|--------|---------|
| `src/app/api/projects/[id]/generate/route.ts` | Modify | Add `generate_ref_prompts` action handler |
| `src/components/editor/shot-card.tsx` | Modify | Rewrite reference mode Step 2 section |
| `src/app/[locale]/project/[id]/episodes/[episodeId]/storyboard/page.tsx` | Modify | Replace Row 2 in reference mode with new 2-step flow |
| `src/lib/ai/prompts/ref-image-prompts.ts` | Create | System prompt for generating reference image prompts |

---

### Task 1: Create ref image prompt generator

**Files:**
- Create: `src/lib/ai/prompts/ref-image-prompts.ts`

- [ ] **Step 1: Create the prompt builder**

```typescript
// src/lib/ai/prompts/ref-image-prompts.ts

const REF_IMAGE_PROMPT_SYSTEM = `You are a professional cinematographer preparing reference images for AI video generation.

For each shot in the storyboard, generate 1-4 reference image prompts. Each prompt describes one image that will be generated and used as a visual reference when creating the video.

Think about what visual references the video AI needs:
- Character close-ups: face, expression, specific costume in this scene
- Key objects/props: items that must appear consistent
- Environment/setting: the location, lighting, atmosphere
- Specific moments: a particular pose or interaction that must be captured

Rules:
- Each prompt must be a COMPLETE image generation description (style, subject, details, lighting)
- Include the art style from the project's visual style
- 30-80 words per prompt
- 1-4 prompts per shot depending on complexity
- Simple shot (one character, simple action) → 1-2 prompts
- Complex shot (multiple characters, important props, specific setting) → 3-4 prompts

CRITICAL LANGUAGE RULE: Output in the SAME language as the input.

Output ONLY valid JSON (no markdown):
[
  {
    "shotSequence": 1,
    "prompts": ["prompt for ref image 1", "prompt for ref image 2"]
  },
  {
    "shotSequence": 2,
    "prompts": ["prompt for ref image 1"]
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
    .map((s) => `Shot ${s.sequence}: ${s.prompt}${s.motionScript ? `\nMotion: ${s.motionScript}` : ""}${s.cameraDirection ? `\nCamera: ${s.cameraDirection}` : ""}`)
    .join("\n\n");

  return `${visualStyle ? `Visual Style: ${visualStyle}\n\n` : ""}Characters:\n${charDescriptions}\n\nShots:\n${shotDescriptions}`;
}

export { REF_IMAGE_PROMPT_SYSTEM };
```

- [ ] **Step 2: Verify compilation**

```bash
npx tsc --noEmit
```

- [ ] **Step 3: Commit**

```bash
git add src/lib/ai/prompts/ref-image-prompts.ts
git commit -m "feat: ref image prompt generator for reference mode step 2"
```

---

### Task 2: Add `generate_ref_prompts` API action

**Files:**
- Modify: `src/app/api/projects/[id]/generate/route.ts`

- [ ] **Step 1: Add action dispatcher**

Find the if-chain where actions are dispatched. Add:

```typescript
if (action === "generate_ref_prompts") {
  return handleGenerateRefPrompts(projectId, userId, payload, modelConfig, episodeId);
}
```

- [ ] **Step 2: Add handler function**

Add at the end of the file:

```typescript
import { REF_IMAGE_PROMPT_SYSTEM, buildRefImagePromptsRequest } from "@/lib/ai/prompts/ref-image-prompts";
import { parseRefImages, serializeRefImages, type RefImage } from "@/lib/ref-image-utils";

async function handleGenerateRefPrompts(
  projectId: string,
  userId: string,
  payload?: Record<string, unknown>,
  modelConfig?: ModelConfig,
  episodeId?: string
) {
  if (!modelConfig?.text) {
    return NextResponse.json({ error: "No text model configured" }, { status: 400 });
  }

  const batchVersionId = payload?.versionId as string | undefined;
  const shotWhereConditions = [eq(shots.projectId, projectId)];
  if (batchVersionId) shotWhereConditions.push(eq(shots.versionId, batchVersionId));
  if (episodeId) shotWhereConditions.push(eq(shots.episodeId, episodeId));

  const allShots = await db
    .select()
    .from(shots)
    .where(and(...shotWhereConditions))
    .orderBy(asc(shots.sequence));

  if (allShots.length === 0) {
    return NextResponse.json({ error: "No shots found" }, { status: 400 });
  }

  const projectCharacters = await getEpisodeCharacters(projectId, episodeId);

  // Get visual style from script
  const scriptSource = episodeId
    ? await db.select({ script: episodes.script }).from(episodes).where(eq(episodes.id, episodeId))
    : await db.select({ script: projects.script }).from(projects).where(eq(projects.id, projectId));
  const script = scriptSource[0]?.script || "";
  const visualStyleMatch = script.match(/视觉风格[：:]\s*(.+?)(?:\n|$)/);
  const visualStyle = visualStyleMatch?.[1] || "";

  const textProvider = resolveAIProvider(modelConfig);
  const promptRequest = buildRefImagePromptsRequest(
    allShots.map((s) => ({
      sequence: s.sequence,
      prompt: s.prompt || "",
      motionScript: s.motionScript,
      cameraDirection: s.cameraDirection,
    })),
    projectCharacters.map((c) => ({ name: c.name, description: c.description })),
    visualStyle
  );

  const result = await textProvider.generateText(promptRequest, {
    systemPrompt: REF_IMAGE_PROMPT_SYSTEM,
    temperature: 0.7,
  });

  // Parse AI response
  const jsonMatch = result.match(/\[[\s\S]*\]/);
  if (!jsonMatch) {
    return NextResponse.json({ error: "AI did not return valid JSON" }, { status: 500 });
  }

  const parsed = JSON.parse(jsonMatch[0]) as Array<{
    shotSequence: number;
    prompts: string[];
  }>;

  // Update each shot's referenceImages with the generated prompts
  let updatedCount = 0;
  for (const entry of parsed) {
    const shot = allShots.find((s) => s.sequence === entry.shotSequence);
    if (!shot || !entry.prompts?.length) continue;

    const refImages: RefImage[] = entry.prompts.map((p) => ({
      id: genId(),
      prompt: p,
      status: "pending" as const,
    }));

    await db
      .update(shots)
      .set({ referenceImages: serializeRefImages(refImages) })
      .where(eq(shots.id, shot.id));
    updatedCount++;
  }

  return NextResponse.json({ updatedCount, totalShots: allShots.length });
}
```

- [ ] **Step 3: Add import at top of file**

Add to imports section:
```typescript
import { REF_IMAGE_PROMPT_SYSTEM, buildRefImagePromptsRequest } from "@/lib/ai/prompts/ref-image-prompts";
```

Note: `parseRefImages`, `serializeRefImages`, `RefImage` should already be imported. If not, add:
```typescript
import { parseRefImages, serializeRefImages, type RefImage } from "@/lib/ref-image-utils";
```

- [ ] **Step 4: Verify and commit**

```bash
npx tsc --noEmit
git add -A
git commit -m "feat: generate_ref_prompts API action for reference mode step 2"
```

---

### Task 3: Rewrite storyboard page reference mode toolbar

**Files:**
- Modify: `src/app/[locale]/project/[id]/episodes/[episodeId]/storyboard/page.tsx`

- [ ] **Step 1: Add state and handler for ref prompt generation**

Add new state:
```typescript
const [generatingRefPrompts, setGeneratingRefPrompts] = useState(false);
```

Add handler:
```typescript
async function handleGenerateRefPrompts() {
  if (!project) return;
  if (!textGuard()) return;
  setGeneratingRefPrompts(true);
  try {
    const resp = await apiFetch(`/api/projects/${project.id}/generate`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        action: "generate_ref_prompts",
        payload: { versionId: selectedVersionId },
        modelConfig: getModelConfig(),
        episodeId: useProjectStore.getState().currentEpisodeId,
      }),
    });
    if (!resp.ok) throw new Error("Failed");
    const data = await resp.json();
    toast.success(`Generated ref prompts for ${data.updatedCount} shots`);
    await fetchProject(project.id, currentEpisodeId);
  } catch (err) {
    toast.error("Failed to generate ref prompts");
  } finally {
    setGeneratingRefPrompts(false);
  }
}
```

- [ ] **Step 2: Replace Row 2 reference mode buttons**

Find the Row 2 section (`{/* Row 2: Frames */}`). In the reference mode branch, replace the existing buttons with a 3-step Row 2:

```tsx
{/* Reference mode: Step 2a - Generate ref prompts, Step 2b - Generate ref images, Step 2c - Generate scene frame */}
{generationMode === "reference" ? (
  <>
    <Button
      size="sm"
      variant={shotsWithRefPrompts === 0 ? "default" : "outline"}
      onClick={handleGenerateRefPrompts}
      disabled={generatingRefPrompts || anyGenerating || totalShots === 0}
    >
      {generatingRefPrompts ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <Sparkles className="h-3.5 w-3.5" />}
      {generatingRefPrompts ? t("common.generating") : t("storyboard.generateRefPrompts") || "Generate Ref Prompts"}
    </Button>
    <Button
      size="sm"
      variant={shotsWithRefImages === totalShots ? "outline" : "default"}
      onClick={() => handleBatchGenerateSceneFrames(false)}
      disabled={anyGenerating || totalShots === 0 || !hasReferenceImages || shotsWithRefPrompts === 0}
    >
      {generatingSceneFrames && !sceneFramesOverwrite ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <ImageIcon className="h-3.5 w-3.5" />}
      {generatingSceneFrames && !sceneFramesOverwrite ? t("common.generating") : t("project.batchGenerateSceneFrames")}
    </Button>
    <Button
      size="sm"
      variant="outline"
      onClick={() => handleBatchGenerateSceneFrames(true)}
      disabled={anyGenerating || totalShots === 0 || !hasReferenceImages}
    >
      <RefreshCw className="h-3.5 w-3.5" />
    </Button>
  </>
) : (
  /* existing keyframe mode buttons stay unchanged */
)}
```

- [ ] **Step 3: Add computed values for ref prompt tracking**

```typescript
const shotsWithRefPrompts = useMemo(() => {
  if (!project) return 0;
  return project.shots.filter((s) => {
    try {
      const refs = JSON.parse(s.referenceImages || "[]");
      return Array.isArray(refs) && refs.length > 0 && refs.some((r: any) => r.prompt);
    } catch { return false; }
  }).length;
}, [project?.shots]);

const shotsWithRefImages = useMemo(() => {
  if (!project) return 0;
  return project.shots.filter((s) => {
    try {
      const refs = JSON.parse(s.referenceImages || "[]");
      return Array.isArray(refs) && refs.length > 0 && refs.every((r: any) => r.status === "generated" || r.imagePath);
    } catch { return false; }
  }).length;
}, [project?.shots]);
```

- [ ] **Step 4: Update autoRun for reference mode**

Find `handleAutoRun`. Update the reference mode branch to include the new step:

```typescript
if (generationMode === "reference") {
  // Step 2a: Generate ref image prompts
  const needsRefPrompts = shots.some((s) => {
    try {
      const refs = JSON.parse(s.referenceImages || "[]");
      return !refs.length || !refs.some((r: any) => r.prompt);
    } catch { return true; }
  });
  if (needsRefPrompts) await handleGenerateRefPrompts();

  // Step 2b: Generate ref images (scene frames + ref images)
  if (needsFrame) await handleBatchGenerateSceneFrames(false);
}
```

- [ ] **Step 5: Add i18n keys**

In `messages/zh.json` under `storyboard`:
```json
"generateRefPrompts": "生成参考图提示词"
```

In `messages/en.json`:
```json
"generateRefPrompts": "Generate Ref Prompts"
```

Same for ja, ko.

- [ ] **Step 6: Verify and commit**

```bash
npx tsc --noEmit
git add -A
git commit -m "feat: reference mode toolbar with ref prompt generation step"
```

---

### Task 4: Rewrite shot-card reference mode Step 2

**Files:**
- Modify: `src/components/editor/shot-card.tsx`

This is the core UI change. The reference mode Step 2 should show:
1. Reference image cards (from `parsedRefImages`) — each with image/placeholder + editable prompt + action bar
2. A "+" button to add new ref image cards
3. No more "场景参考帧" as a separate element — it becomes just another generated artifact

- [ ] **Step 1: Update parsedRefImages to remove the fallback**

The `parsedRefImages` memo should be clean — just parse what's in the DB:

```typescript
const parsedRefImages = useMemo(() => {
  return parseRefImages(referenceImages);
}, [referenceImages]);
```

(This should already be correct from previous changes. Verify and remove any fallback logic.)

- [ ] **Step 2: Rewrite the reference mode frame section**

Replace the entire `{generationMode === "reference" ? (` block in Step 2 with:

```tsx
{generationMode === "reference" ? (
  <div className="mb-2.5 space-y-2">
    {/* Reference image cards grid */}
    {parsedRefImages.length > 0 ? (
      <div className="grid grid-cols-2 gap-2">
        {parsedRefImages.map((ref) => (
          <div key={ref.id} className="rounded-lg border border-[--border-subtle] bg-white overflow-hidden">
            {/* Image or placeholder */}
            <div className="relative aspect-video bg-[--surface]">
              {ref.imagePath ? (
                <img
                  src={uploadUrl(ref.imagePath)}
                  className="w-full h-full object-cover cursor-pointer hover:opacity-80 transition-opacity"
                  onClick={() => setPreviewSrc(uploadUrl(ref.imagePath!))}
                />
              ) : (
                <div className="flex h-full items-center justify-center">
                  {ref.prompt ? (
                    <span className="text-xs text-[--text-muted] px-2 text-center line-clamp-3">{ref.prompt.substring(0, 60)}...</span>
                  ) : (
                    <ImageIcon className="h-5 w-5 text-[--text-muted]" />
                  )}
                </div>
              )}
            </div>
            {/* Editable prompt */}
            <textarea
              key={`prompt-${ref.id}`}
              defaultValue={ref.prompt}
              onBlur={(e) => handleUpdateRefPrompt(ref.id, e.target.value)}
              placeholder={t("shot.refImagePrompt")}
              rows={2}
              className="w-full resize-none border-0 border-t border-[--border-subtle] bg-transparent px-2 py-1.5 text-[11px] leading-snug text-[--text-secondary] placeholder:text-[--text-muted] focus:outline-none"
            />
            {/* Action bar */}
            <div className="flex items-center gap-1 border-t border-[--border-subtle] px-1.5 py-1">
              <InlineModelPicker capability="image" />
              <div className="flex-1" />
              <button
                onClick={() => handleRegenerateRefImage(ref.id)}
                disabled={!ref.prompt?.trim()}
                className="flex items-center rounded px-1.5 py-0.5 text-[10px] text-[--text-muted] hover:bg-[--bg-muted] hover:text-primary disabled:opacity-30"
              >
                <RefreshCw className="h-2.5 w-2.5" />
              </button>
              <button
                onClick={() => handleRemoveRefImage(ref.id)}
                className="flex items-center rounded px-1.5 py-0.5 text-[10px] text-[--text-muted] hover:bg-red-50 hover:text-red-500"
              >
                <Trash2 className="h-2.5 w-2.5" />
              </button>
            </div>
          </div>
        ))}
      </div>
    ) : (
      <div className="flex items-center justify-center rounded-lg border border-dashed border-[--border-subtle] p-4 text-sm text-[--text-muted]">
        {t("shot.noRefImages") || "No reference image prompts yet. Click 'Generate Ref Prompts' in the toolbar above."}
      </div>
    )}

    {/* Add ref image button */}
    {parsedRefImages.length < 9 && (
      <button
        onClick={handleAddRefImage}
        className="flex w-full items-center justify-center gap-1 rounded-lg border border-dashed border-[--border-subtle] py-2 text-xs text-[--text-muted] hover:border-primary/40 hover:text-primary transition-colors"
      >
        <Plus className="h-3 w-3" />
        {t("shot.addRefImage")}
      </button>
    )}
  </div>
) : (
  /* keyframe mode stays exactly as is — DO NOT TOUCH */
```

- [ ] **Step 3: Remove the separate "场景参考帧" section in reference mode**

Delete the scene ref frame section that appears below ref images in reference mode (the `<div className="flex items-center gap-2 pt-1 border-t">` block). Scene ref frame is auto-generated during batch — no need for UI management.

- [ ] **Step 4: Update the "生成画面" button**

The generate button in reference mode should call `batch_ref_image_generate` (generate ref images for THIS shot), not `single_scene_frame`:

```typescript
// In the button onClick:
generationMode === "reference" ? handleBatchGenerateRefImagesForShot() : handleGenerateFrames
```

Add handler:
```typescript
async function handleBatchGenerateRefImagesForShot() {
  if (!imageGuard()) return;
  setGeneratingSceneFrame(true);
  try {
    const resp = await apiFetch(`/api/projects/${projectId}/generate`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        action: "single_ref_image_generate_all",
        payload: { shotId: id },
        modelConfig: getModelConfig(),
      }),
    });
    if (!resp.ok) throw new Error("Failed");
    onUpdate();
  } catch (err) {
    toast.error(t("common.generationFailed"));
  }
  setGeneratingSceneFrame(false);
}
```

- [ ] **Step 5: Add i18n key**

```json
"noRefImages": "暂无参考图提示词，请先在工具栏点击"生成参考图提示词""
```

- [ ] **Step 6: Verify and commit**

```bash
npx tsc --noEmit
git add -A
git commit -m "feat: rewrite shot-card reference mode with ref image cards"
```

---

### Task 5: Add `single_ref_image_generate_all` action

**Files:**
- Modify: `src/app/api/projects/[id]/generate/route.ts`

This action generates all pending ref images for a single shot (the "生成画面" button in a shot card).

- [ ] **Step 1: Add action dispatcher**

```typescript
if (action === "single_ref_image_generate_all") {
  return handleSingleShotRefImageGenerateAll(projectId, userId, payload, modelConfig);
}
```

- [ ] **Step 2: Add handler**

```typescript
async function handleSingleShotRefImageGenerateAll(
  projectId: string,
  userId: string,
  payload?: Record<string, unknown>,
  modelConfig?: ModelConfig
) {
  const shotId = payload?.shotId as string;
  if (!shotId) return NextResponse.json({ error: "No shotId" }, { status: 400 });
  if (!modelConfig?.image) return NextResponse.json({ error: "No image model" }, { status: 400 });

  const [shot] = await db.select().from(shots).where(eq(shots.id, shotId));
  if (!shot) return NextResponse.json({ error: "Shot not found" }, { status: 404 });

  const refImages = parseRefImages(shot.referenceImages as string);
  const pending = refImages.filter((r) => r.status === "pending" && r.prompt.trim());
  if (pending.length === 0) {
    return NextResponse.json({ message: "No pending ref images" });
  }

  const projectCharacters = await getEpisodeCharacters(projectId);
  const charRefs = projectCharacters
    .filter((c) => !!c.referenceImage)
    .map((c) => c.referenceImage as string);

  const ratio = (payload?.ratio as string) || "16:9";
  const imgOpts = ratioToImageOpts(ratio);
  const imageProvider = resolveImageProvider(modelConfig);

  let generated = 0;
  for (const entry of pending) {
    try {
      const imagePath = await imageProvider.generateImage(entry.prompt, {
        quality: "hd",
        ...imgOpts,
        referenceImages: charRefs,
      });
      entry.imagePath = imagePath;
      entry.status = "generated";
      generated++;
    } catch (err) {
      console.warn(`[RefImageGenAll] Shot ${shot.sequence} ref ${entry.id} failed:`, err);
    }
  }

  // Also generate sceneRefFrame from the first generated ref image (for video gen compatibility)
  const firstGenerated = refImages.find((r) => r.status === "generated" && r.imagePath);
  const sceneRefFrame = firstGenerated?.imagePath || shot.sceneRefFrame;

  await db
    .update(shots)
    .set({
      referenceImages: serializeRefImages(refImages),
      ...(sceneRefFrame ? { sceneRefFrame } : {}),
    })
    .where(eq(shots.id, shotId));

  return NextResponse.json({ generated, total: pending.length });
}
```

- [ ] **Step 3: Verify and commit**

```bash
npx tsc --noEmit
git add -A
git commit -m "feat: single_ref_image_generate_all action for per-shot ref image batch"
```

---

### Task 6: Update batch scene frame handler

**Files:**
- Modify: `src/app/api/projects/[id]/generate/route.ts`

The `handleBatchSceneFrame` function currently does too much (generates scene frame + auto-generates ref images). Simplify it:
- It should ONLY generate ref images from existing RefImage prompts
- Set sceneRefFrame to the first generated ref image (for video gen compatibility)
- Remove all the old auto-generation logic

- [ ] **Step 1: Rewrite handleBatchSceneFrame**

Replace the body of `handleBatchSceneFrame` with cleaner logic:

```typescript
async function handleBatchSceneFrame(
  projectId: string,
  userId: string,
  payload?: Record<string, unknown>,
  modelConfig?: ModelConfig,
  episodeId?: string
) {
  if (!modelConfig?.image) {
    return NextResponse.json({ error: "No image model configured" }, { status: 400 });
  }

  const overwrite = payload?.overwrite === true;
  const ratio = (payload?.ratio as string) || "16:9";
  const imageOpts = ratioToImageOpts(ratio);
  const batchVersionId = payload?.versionId as string | undefined;

  const shotWhereConditions = [eq(shots.projectId, projectId)];
  if (batchVersionId) shotWhereConditions.push(eq(shots.versionId, batchVersionId));
  if (episodeId) shotWhereConditions.push(eq(shots.episodeId, episodeId));
  const allShots = await db.select().from(shots).where(and(...shotWhereConditions)).orderBy(asc(shots.sequence));

  const versionedUploadDir = batchVersionId
    ? await getVersionedUploadDir(batchVersionId)
    : process.env.UPLOAD_DIR || "./uploads";

  const projectCharacters = await getEpisodeCharacters(projectId, episodeId);
  const charRefs = projectCharacters
    .filter((c) => !!c.referenceImage)
    .map((c) => c.referenceImage as string);

  if (charRefs.length === 0) {
    return NextResponse.json({ error: "No character reference images available." }, { status: 400 });
  }

  const imageProvider = resolveImageProvider(modelConfig, versionedUploadDir);

  const results: Array<{ shotId: string; sequence: number; status: "ok" | "error"; generated: number; error?: string }> = [];

  for (const shot of allShots) {
    const refImages = parseRefImages(shot.referenceImages as string);
    const pending = refImages.filter((r) => (overwrite || r.status === "pending") && r.prompt.trim());

    if (pending.length === 0) {
      results.push({ shotId: shot.id, sequence: shot.sequence, status: "ok", generated: 0 });
      continue;
    }

    await db.update(shots).set({ status: "generating" }).where(eq(shots.id, shot.id));
    let generated = 0;

    for (const entry of pending) {
      try {
        if (overwrite) {
          entry.status = "pending";
          entry.imagePath = undefined;
        }
        const imagePath = await imageProvider.generateImage(entry.prompt, {
          quality: "hd",
          ...imageOpts,
          referenceImages: charRefs,
        });
        entry.imagePath = imagePath;
        entry.status = "generated";
        generated++;
      } catch (err) {
        console.warn(`[BatchRefImage] Shot ${shot.sequence} ref ${entry.id} failed:`, err);
      }
    }

    // Set sceneRefFrame to first generated image (for video gen compatibility)
    const firstGenerated = refImages.find((r) => r.status === "generated" && r.imagePath);

    await db
      .update(shots)
      .set({
        referenceImages: serializeRefImages(refImages),
        ...(firstGenerated?.imagePath ? { sceneRefFrame: firstGenerated.imagePath } : {}),
        status: "pending",
      })
      .where(eq(shots.id, shot.id));

    results.push({ shotId: shot.id, sequence: shot.sequence, status: "ok", generated });
  }

  return NextResponse.json({ results });
}
```

- [ ] **Step 2: Verify and commit**

```bash
npx tsc --noEmit
git add -A
git commit -m "refactor: simplify batch scene frame to only generate ref images from prompts"
```

---

## Summary

After all 6 tasks, the reference mode flow is:

1. **Toolbar Row 1**: "Generate Storyboard" → creates shots with descriptions (shared with keyframe)
2. **Toolbar Row 2**: "Generate Ref Prompts" → AI generates 1-4 ref image prompts per shot → stored as RefImage[] in `referenceImages`
3. **Toolbar Row 2**: "Generate Ref Images" → generates images from prompts using character refs → updates RefImage[].imagePath
4. **Toolbar Row 3**: "Generate Video Prompts" → generates video prompts from ref images (existing, no change)
5. **Toolbar Row 4**: "Generate Videos" → generates videos from ref images + prompts (existing, no change)

Each shot card shows ref image cards with: image/placeholder + editable prompt + model picker + regenerate + delete. Users can add more ref image cards manually.
