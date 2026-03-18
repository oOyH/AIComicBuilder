"use client";

import { useProjectStore } from "@/stores/project-store";
import { useModelStore } from "@/stores/model-store";
import { ShotCard } from "@/components/editor/shot-card";
import { Button } from "@/components/ui/button";
import { useTranslations } from "next-intl";
import { useState } from "react";
import { useModelGuard } from "@/hooks/use-model-guard";
import {
  Film,
  Sparkles,
  ImageIcon,
  VideoIcon,
  Loader2,
  Check,
  ChevronRight,
  Download,
} from "lucide-react";
import { InlineModelPicker } from "@/components/editor/model-selector";
import { VideoRatioPicker } from "@/components/editor/video-ratio-picker";
import { apiFetch } from "@/lib/api-fetch";
import { toast } from "sonner";
import { GenerationModeTab } from "@/components/editor/generation-mode-tab";
import Link from "next/link";

type StepStatus = "pending" | "active" | "completed";

function WorkflowStep({
  step,
  label,
  count,
  status,
  icon: Icon,
  isLast,
}: {
  step: number;
  label: string;
  count: string;
  status: StepStatus;
  icon: React.ElementType;
  isLast: boolean;
}) {
  return (
    <div className="flex items-center gap-2">
      <div className="flex items-center gap-2.5">
        {/* Step circle */}
        <div
          className={`flex h-8 w-8 items-center justify-center rounded-full text-xs font-bold transition-colors ${
            status === "completed"
              ? "bg-emerald-500/15 text-emerald-600"
              : status === "active"
                ? "bg-primary/15 text-primary ring-2 ring-primary/30"
                : "bg-[--surface] text-[--text-muted]"
          }`}
        >
          {status === "completed" ? (
            <Check className="h-3.5 w-3.5" />
          ) : (
            <Icon className="h-3.5 w-3.5" />
          )}
        </div>
        {/* Label + count */}
        <div className="min-w-0">
          <p
            className={`text-sm font-medium leading-tight ${
              status === "active"
                ? "text-[--text-primary]"
                : status === "completed"
                  ? "text-emerald-600"
                  : "text-[--text-muted]"
            }`}
          >
            {label}
          </p>
          <p className="text-[10px] text-[--text-muted]">{count}</p>
        </div>
      </div>
      {/* Connector */}
      {!isLast && (
        <ChevronRight className="mx-1 h-4 w-4 flex-shrink-0 text-[--text-muted]/40" />
      )}
    </div>
  );
}

export default function StoryboardPage() {
  const t = useTranslations();
  const { project, fetchProject } = useProjectStore();
  const getModelConfig = useModelStore((s) => s.getModelConfig);
  const [generating, setGenerating] = useState(false);
  const [generatingFrames, setGeneratingFrames] = useState(false);
  const [generatingVideos, setGeneratingVideos] = useState(false);
  const [generatingSceneFrames, setGeneratingSceneFrames] = useState(false);
  const [sceneFramesOverwrite, setSceneFramesOverwrite] = useState(false);
  const [videoRatio, setVideoRatio] = useState("16:9");
  const textGuard = useModelGuard("text");
  const imageGuard = useModelGuard("image");
  const videoGuard = useModelGuard("video");

  if (!project) return null;

  const characterDescriptions = project.characters
    .map((c) => `${c.name}: ${c.description}`)
    .join("\n");

  const totalShots = project.shots.length;
  const shotsWithFrames = project.shots.filter(
    (s) => s.firstFrame && s.lastFrame
  ).length;
  const generationMode = (project.generationMode || "keyframe") as "keyframe" | "reference";

  const shotsWithVideo = project.shots.filter((s) =>
    generationMode === "reference" ? s.referenceVideoUrl : s.videoUrl
  ).length;
  const charactersWithRefs = project.characters.filter((c) => c.referenceImage);
  const hasReferenceImages = charactersWithRefs.length > 0;

  // Determine step statuses
  const step1Status: StepStatus =
    totalShots > 0 ? "completed" : "active";
  const step2Status: StepStatus =
    generationMode === "reference"
      ? "completed"
      : totalShots === 0
        ? "pending"
        : shotsWithFrames === totalShots
          ? "completed"
          : "active";
  const step3Status: StepStatus =
    totalShots === 0
      ? "pending"
      : generationMode === "reference"
        ? shotsWithVideo === totalShots
          ? "completed"
          : totalShots > 0
            ? "active"
            : "pending"
        : shotsWithFrames === 0
          ? "pending"
          : shotsWithVideo === totalShots
            ? "completed"
            : shotsWithFrames > 0
              ? "active"
              : "pending";

  const anyGenerating = generating || generatingFrames || generatingVideos || generatingSceneFrames;

  async function handleGenerateShots() {
    if (!project) return;
    if (!textGuard()) return;
    setGenerating(true);

    try {
      const response = await apiFetch(`/api/projects/${project.id}/generate`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          action: "shot_split",
          modelConfig: getModelConfig(),
        }),
      });

      if (response.body) {
        const reader = response.body.getReader();
        while (true) {
          const { done } = await reader.read();
          if (done) break;
        }
      }
    } catch (err) {
      console.error("Shot split error:", err);
      toast.error(err instanceof Error ? err.message : t("common.generationFailed"));
    }

    setGenerating(false);
    await fetchProject(project.id);
  }

  async function handleBatchGenerateFrames() {
    if (!project) return;
    if (!imageGuard()) return;
    setGeneratingFrames(true);

    try {
      const response = await apiFetch(`/api/projects/${project.id}/generate`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          action: "batch_frame_generate",
          modelConfig: getModelConfig(),
        }),
      });
      const data = await response.json() as { results: Array<{ status: string }> };
      if (data.results?.some((r) => r.status === "error")) {
        toast.warning(t("common.batchPartialFailed"));
      }
    } catch (err) {
      console.error("Batch frame generate error:", err);
      toast.error(err instanceof Error ? err.message : t("common.generationFailed"));
    }

    setGeneratingFrames(false);
    fetchProject(project.id);
  }

  async function handleBatchGenerateVideos() {
    if (!project) return;
    if (!videoGuard()) return;
    setGeneratingVideos(true);

    try {
      const response = await apiFetch(`/api/projects/${project.id}/generate`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          action: "batch_video_generate",
          payload: { ratio: videoRatio },
          modelConfig: getModelConfig(),
        }),
      });
      const data = await response.json() as { results: Array<{ status: string }> };
      if (data.results?.some((r) => r.status === "error")) {
        toast.warning(t("common.batchPartialFailed"));
      }
    } catch (err) {
      console.error("Batch video generate error:", err);
      toast.error(err instanceof Error ? err.message : t("common.generationFailed"));
    }

    setGeneratingVideos(false);
    fetchProject(project.id);
  }

  async function handleBatchGenerateSceneFrames(overwrite = false) {
    if (!project) return;
    if (!imageGuard()) return;
    setSceneFramesOverwrite(overwrite);
    setGeneratingSceneFrames(true);

    try {
      const response = await apiFetch(`/api/projects/${project.id}/generate`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          action: "batch_scene_frame",
          payload: { overwrite },
          modelConfig: getModelConfig(),
        }),
      });
      const data = await response.json() as { results: Array<{ status: string }> };
      if (data.results?.some((r) => r.status === "error")) {
        toast.warning(t("common.batchPartialFailed"));
      }
    } catch (err) {
      console.error("Batch scene frame error:", err);
      toast.error(err instanceof Error ? err.message : t("common.generationFailed"));
    }

    setGeneratingSceneFrames(false);
    setSceneFramesOverwrite(false);
    fetchProject(project.id);
  }

  async function handleBatchGenerateReferenceVideos() {
    if (!project) return;
    if (!videoGuard()) return;
    setGeneratingVideos(true);

    try {
      const response = await apiFetch(`/api/projects/${project.id}/generate`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          action: "batch_reference_video",
          payload: { ratio: videoRatio },
          modelConfig: getModelConfig(),
        }),
      });
      const data = await response.json() as { results: Array<{ status: string }> };
      if (data.results?.some((r) => r.status === "error")) {
        toast.warning(t("common.batchPartialFailed"));
      }
    } catch (err) {
      console.error("Batch reference video error:", err);
      toast.error(err instanceof Error ? err.message : t("common.generationFailed"));
    }

    setGeneratingVideos(false);
    fetchProject(project.id);
  }

  return (
    <div className="animate-page-in space-y-6">
      {/* Page header */}
      <div className="flex items-center justify-between">
        <div className="flex items-center gap-3">
          <div className="flex h-9 w-9 items-center justify-center rounded-xl bg-primary/10">
            <Film className="h-4 w-4 text-primary" />
          </div>
          <div>
            <h2 className="font-display text-xl font-bold tracking-tight text-[--text-primary]">
              {t("project.storyboard")}
            </h2>
            <p className="text-xs text-[--text-muted]">
              {totalShots} shots
            </p>
          </div>
        </div>
        {totalShots > 0 && (
          <Button
            variant="outline"
            size="sm"
            onClick={() => {
              const a = document.createElement("a");
              a.href = `/api/projects/${project!.id}/download`;
              a.download = "";
              a.click();
            }}
          >
            <Download className="h-3.5 w-3.5" />
            {t("project.downloadAll")}
          </Button>
        )}
      </div>

      {/* ── 3-Step Workflow Pipeline ── */}
      <div className="rounded-2xl border border-[--border-subtle] bg-white p-4">
        {/* Generation mode tab */}
        <GenerationModeTab />

        {/* Reference image mode: character indicator */}
        {generationMode === "reference" && (
          <div className={`mt-3 rounded-lg px-3 py-2 text-sm ${
            hasReferenceImages
              ? "bg-violet-50 text-violet-700 border border-violet-200"
              : "bg-amber-50 text-amber-700 border border-amber-200"
          }`}>
            {hasReferenceImages ? (
              <>
                🖼️ {t("project.referenceCharactersLabel", {
                  names: charactersWithRefs.map((c) => c.name).join("、"),
                  count: charactersWithRefs.length,
                })}
              </>
            ) : (
              <>
                ⚠️ {t("project.noReferenceImages")}
                {" — "}
                <Link href="../characters" className="underline">
                  {t("project.characters")}
                </Link>
              </>
            )}
          </div>
        )}

        {/* Step indicators */}
        <div className="mt-4 flex items-center gap-1">
          <WorkflowStep
            step={1}
            label={t("project.workflowStepShots")}
            count={
              totalShots > 0
                ? t("project.workflowShotsCount", {
                    completed: totalShots,
                    total: totalShots,
                  })
                : "—"
            }
            status={step1Status}
            icon={Sparkles}
            isLast={false}
          />
          {generationMode === "keyframe" && (
            <WorkflowStep
              step={2}
              label={t("project.workflowStepFrames")}
              count={
                totalShots > 0
                  ? t("project.workflowFramesCount", {
                      completed: shotsWithFrames,
                      total: totalShots,
                    })
                  : "—"
              }
              status={step2Status}
              icon={ImageIcon}
              isLast={false}
            />
          )}
          <WorkflowStep
            step={generationMode === "reference" ? 2 : 3}
            label={t("project.workflowStepVideos")}
            count={
              totalShots > 0
                ? t("project.workflowVideosCount", {
                    completed: shotsWithVideo,
                    total: totalShots,
                  })
                : "—"
            }
            status={step3Status}
            icon={VideoIcon}
            isLast
          />
        </div>

        {/* Action buttons row */}
        <div className="mt-4 flex flex-wrap items-center gap-2 border-t border-[--border-subtle] pt-4">
          {/* Step 1: Generate shots */}
          <InlineModelPicker capability="text" />
          <Button
            onClick={handleGenerateShots}
            disabled={anyGenerating}
            variant={step1Status === "completed" ? "outline" : "default"}
            size="sm"
          >
            {generating ? (
              <Loader2 className="h-3.5 w-3.5 animate-spin" />
            ) : (
              <Sparkles className="h-3.5 w-3.5" />
            )}
            {generating
              ? t("common.generating")
              : t("project.generateShots")}
          </Button>

          {/* Step 2: Batch generate frames — keyframe mode only */}
          {generationMode === "keyframe" && totalShots > 0 && (
            <>
              <InlineModelPicker capability="image" />
              <Button
                onClick={handleBatchGenerateFrames}
                disabled={anyGenerating}
                variant={step2Status === "completed" ? "outline" : "default"}
                size="sm"
              >
                {generatingFrames ? (
                  <Loader2 className="h-3.5 w-3.5 animate-spin" />
                ) : (
                  <ImageIcon className="h-3.5 w-3.5" />
                )}
                {generatingFrames
                  ? t("common.generating")
                  : t("project.batchGenerateFrames")}
              </Button>
            </>
          )}

          {/* Step 2b: Batch generate scene frames — reference mode only */}
          {generationMode === "reference" && totalShots > 0 && hasReferenceImages && (
            <>
              <InlineModelPicker capability="image" />
              <Button
                onClick={() => handleBatchGenerateSceneFrames(false)}
                disabled={anyGenerating}
                variant="outline"
                size="sm"
              >
                {generatingSceneFrames ? (
                  <Loader2 className="h-3.5 w-3.5 animate-spin" />
                ) : (
                  <ImageIcon className="h-3.5 w-3.5" />
                )}
                {generatingSceneFrames
                  ? t("common.generating")
                  : t("project.batchGenerateSceneFrames")}
              </Button>
              <Button
                onClick={() => handleBatchGenerateSceneFrames(true)}
                disabled={anyGenerating}
                variant="outline"
                size="sm"
              >
                {generatingSceneFrames ? (
                  <Loader2 className="h-3.5 w-3.5 animate-spin" />
                ) : (
                  <ImageIcon className="h-3.5 w-3.5" />
                )}
                {generatingSceneFrames
                  ? t("common.generating")
                  : t("project.batchGenerateSceneFramesOverwrite")}
              </Button>
            </>
          )}

          {/* Step 3: Batch generate videos */}
          {totalShots > 0 &&
            (generationMode === "reference" ? hasReferenceImages : shotsWithFrames > 0) && (
            <>
              <InlineModelPicker capability="video" />
              <VideoRatioPicker value={videoRatio} onChange={setVideoRatio} />
              <Button
                onClick={
                  generationMode === "reference"
                    ? handleBatchGenerateReferenceVideos
                    : handleBatchGenerateVideos
                }
                disabled={anyGenerating || (generationMode === "reference" && !hasReferenceImages)}
                variant={step3Status === "completed" ? "outline" : "default"}
                size="sm"
              >
                {generatingVideos ? (
                  <Loader2 className="h-3.5 w-3.5 animate-spin" />
                ) : (
                  <Sparkles className="h-3.5 w-3.5" />
                )}
                {generatingVideos
                  ? t("common.generating")
                  : generationMode === "reference"
                    ? t("project.batchGenerateReferenceVideos")
                    : t("project.batchGenerateVideos")}
              </Button>
            </>
          )}
        </div>
      </div>

      {/* Shot cards */}
      {totalShots === 0 ? (
        <div className="flex flex-col items-center justify-center rounded-3xl border border-dashed border-[--border-subtle] bg-[--surface]/50 py-24">
          <div className="mb-5 flex h-16 w-16 items-center justify-center rounded-2xl bg-gradient-to-br from-primary/15 to-accent/10">
            <Film className="h-7 w-7 text-primary" />
          </div>
          <h3 className="font-display text-lg font-semibold text-[--text-primary]">
            {t("project.storyboard")}
          </h3>
          <p className="mt-2 max-w-sm text-center text-sm text-[--text-secondary]">
            {t("shot.noShots")}
          </p>
        </div>
      ) : (
        <div className="space-y-3">
          {project.shots.map((shot) => (
            <ShotCard
              key={shot.id}
              id={shot.id}
              projectId={project.id}
              sequence={shot.sequence}
              prompt={shot.prompt}
              startFrameDesc={shot.startFrameDesc}
              endFrameDesc={shot.endFrameDesc}
              videoScript={shot.videoScript}
              motionScript={shot.motionScript}
              cameraDirection={shot.cameraDirection}
              duration={shot.duration}
              firstFrame={shot.firstFrame}
              lastFrame={shot.lastFrame}
              sceneRefFrame={shot.sceneRefFrame}
              videoUrl={generationMode === "reference" ? shot.referenceVideoUrl : shot.videoUrl}
              status={
                generationMode === "reference"
                  ? shot.status === "generating"
                    ? "generating"
                    : shot.referenceVideoUrl
                      ? "completed"
                      : "pending"
                  : shot.status
              }
              dialogues={shot.dialogues || []}
              onUpdate={() => fetchProject(project.id)}
              batchGeneratingFrames={generatingFrames}
              batchGeneratingVideo={generatingVideos}
              characterDescriptions={characterDescriptions}
              generationMode={generationMode}
              batchGeneratingReferenceVideo={generationMode === "reference" ? generatingVideos : undefined}
              batchGeneratingSceneFrames={generationMode === "reference" ? generatingSceneFrames : undefined}
              batchSceneFramesOverwrite={sceneFramesOverwrite}
            />
          ))}
        </div>
      )}
    </div>
  );
}
