import { db } from "@/lib/db";
import { shots, characters, projects, episodes, characterCostumes } from "@/lib/db/schema";
import { resolveImageProvider } from "@/lib/ai/provider-factory";
import type { ModelConfigPayload } from "@/lib/ai/provider-factory";
import {
  buildFirstFramePrompt,
  buildLastFramePrompt,
} from "@/lib/ai/prompts/frame-generate";
import { resolveSlotContents } from "@/lib/ai/prompts/resolver";
import { eq, and, lt, desc } from "drizzle-orm";
import type { Task } from "@/lib/task-queue";

export async function handleFrameGenerate(task: Task) {
  const payload = task.payload as {
    shotId: string;
    projectId: string;
    userId?: string;
    modelConfig?: ModelConfigPayload;
  };

  const [shot] = await db
    .select()
    .from(shots)
    .where(eq(shots.id, payload.shotId));

  if (!shot) throw new Error("Shot not found");

  const projectCharacters = await db
    .select()
    .from(characters)
    .where(eq(characters.projectId, payload.projectId));

  // Parse costume overrides from shot
  const rawCostumeOverrides = shot.costumeOverrides as string | null | undefined;
  const costumeOverrides: Record<string, string> = rawCostumeOverrides && rawCostumeOverrides.trim()
    ? JSON.parse(rawCostumeOverrides)
    : {};

  // Build character descriptions, applying costume overrides when present
  const characterDescParts: string[] = [];
  for (const c of projectCharacters) {
    let description = c.description;
    const costumeId = costumeOverrides[c.id];
    if (costumeId) {
      const [costume] = await db
        .select()
        .from(characterCostumes)
        .where(eq(characterCostumes.id, costumeId));
      if (costume?.description) {
        description = `${c.description}. Current outfit: ${costume.description}`;
      }
    }
    let desc = `${c.name}: ${description}`;
    if (c.performanceStyle) {
      desc += ` [Performance: ${c.performanceStyle}]`;
    }
    characterDescParts.push(desc);
  }
  const characterDescriptions = characterDescParts.join("\n");

  const [previousShot] = await db
    .select()
    .from(shots)
    .where(
      and(
        eq(shots.projectId, payload.projectId),
        lt(shots.sequence, shot.sequence)
      )
    )
    .orderBy(desc(shots.sequence))
    .limit(1);

  const ai = resolveImageProvider(payload.modelConfig);

  const userId = payload.userId ?? "";
  const projectId = payload.projectId;
  const frameFirstSlots = await resolveSlotContents("frame_generate_first", { userId, projectId });
  const frameLastSlots = await resolveSlotContents("frame_generate_last", { userId, projectId });

  // Fetch color palette from project (or episode)
  let colorPalette = "";
  if (shot.episodeId) {
    const [episode] = await db.select().from(episodes).where(eq(episodes.id, shot.episodeId));
    if (episode?.colorPalette) colorPalette = episode.colorPalette;
  }
  if (!colorPalette) {
    const [project] = await db.select().from(projects).where(eq(projects.id, payload.projectId));
    if (project?.colorPalette) colorPalette = project.colorPalette;
  }

  // Build composition suffix
  let compositionSuffix = "";
  if (shot.compositionGuide) {
    compositionSuffix += `, ${shot.compositionGuide.replace(/_/g, " ")} composition`;
  }
  if (shot.focalPoint) {
    compositionSuffix += `, focus on ${shot.focalPoint}`;
  }
  if (shot.depthOfField === "shallow") {
    compositionSuffix += `, shallow depth of field, bokeh background`;
  } else if (shot.depthOfField === "deep") {
    compositionSuffix += `, deep focus, everything sharp`;
  }
  if (colorPalette) {
    compositionSuffix += `\n\nGLOBAL COLOR PALETTE (mandatory): ${colorPalette}. All frames must adhere to this color scheme.`;
  }

  // Build character height context for multi-character shots
  const shotPrompt = shot.prompt || "";
  const charsInPrompt = projectCharacters.filter(c => shotPrompt.includes(c.name));
  if (charsInPrompt.length > 1) {
    const heightInfo = charsInPrompt
      .filter(c => c.heightCm && c.heightCm > 0)
      .sort((a, b) => (b.heightCm || 170) - (a.heightCm || 170))
      .map(c => `${c.name}: ${c.heightCm}cm (${c.bodyType || "average"})`)
      .join(", ");
    if (heightInfo) {
      compositionSuffix += `. Character heights: ${heightInfo}. Maintain correct relative proportions`;
    }
  }

  await db
    .update(shots)
    .set({ status: "generating" })
    .where(eq(shots.id, payload.shotId));

  // Read pre-stored character names from first_frame item in referenceImages
  const charsWithRefs = projectCharacters.filter((c) => !!c.referenceImage);
  let storedCharNames: string[] = [];
  try {
    const refImgs = JSON.parse((shot.referenceImages as string) || "[]");
    const firstFrameItem = Array.isArray(refImgs) ? refImgs.find((r: { type?: string }) => r.type === "first_frame") : null;
    if (firstFrameItem?.characters) {
      storedCharNames = firstFrameItem.characters;
    }
  } catch {}

  const relevantChars = storedCharNames.length > 0
    ? charsWithRefs.filter((c) => storedCharNames.includes(c.name))
    : charsWithRefs.slice(0, 3);
  const charRefImages = relevantChars.map((c) => c.referenceImage as string);

  console.log(`[FrameGenerate] Shot ${shot.sequence}: using ${relevantChars.length} chars: ${relevantChars.map(c => c.name).join(", ") || "fallback"}`);

  // Generate first frame using startFrameDesc
  let firstFramePrompt = buildFirstFramePrompt({
    sceneDescription: shot.prompt || "",
    startFrameDesc: shot.startFrameDesc || shot.prompt || "",
    characterDescriptions,
    previousLastFrame: previousShot?.lastFrame || undefined,
    slotContents: frameFirstSlots,
  });
  if (compositionSuffix) firstFramePrompt += compositionSuffix;
  const firstFramePath = await ai.generateImage(firstFramePrompt, {
    quality: "hd",
    referenceImages: charRefImages,
  });

  // Generate last frame using endFrameDesc
  let lastFramePrompt = buildLastFramePrompt({
    sceneDescription: shot.prompt || "",
    endFrameDesc: shot.endFrameDesc || shot.prompt || "",
    characterDescriptions,
    firstFramePath,
    slotContents: frameLastSlots,
  });
  if (compositionSuffix) lastFramePrompt += compositionSuffix;
  const lastFramePath = await ai.generateImage(lastFramePrompt, {
    quality: "hd",
    referenceImages: [firstFramePath, ...charRefImages],
  });

  await db
    .update(shots)
    .set({
      firstFrame: firstFramePath,
      lastFrame: lastFramePath,
      status: "completed",
    })
    .where(eq(shots.id, payload.shotId));

  return { firstFrame: firstFramePath, lastFrame: lastFramePath };
}
