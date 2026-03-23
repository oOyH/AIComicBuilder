"use client";

import { useEffect, useState, use } from "react";
import { useTranslations } from "next-intl";
import { Layers, Plus, Loader2 } from "lucide-react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { EpisodeCard } from "@/components/editor/episode-card";
import { EpisodeDialog } from "@/components/editor/episode-dialog";
import { useEpisodeStore, type Episode } from "@/stores/episode-store";

export default function EpisodesPage({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  const { id: projectId } = use(params);
  const t = useTranslations("episode");
  const tc = useTranslations("common");
  const {
    episodes,
    loading,
    fetchEpisodes,
    createEpisode,
    deleteEpisode,
    updateEpisode,
  } = useEpisodeStore();

  const [createOpen, setCreateOpen] = useState(false);
  const [editingEpisode, setEditingEpisode] = useState<Episode | null>(null);

  useEffect(() => {
    fetchEpisodes(projectId);
  }, [projectId, fetchEpisodes]);

  async function handleCreate(title: string) {
    await createEpisode(projectId, title);
    toast.success(t("created"));
  }

  async function handleEdit(episode: Episode) {
    const newTitle = prompt(t("editTitle"), episode.title);
    if (newTitle && newTitle.trim() && newTitle.trim() !== episode.title) {
      await updateEpisode(projectId, episode.id, {
        title: newTitle.trim(),
      });
    }
  }

  async function handleDelete(episode: Episode) {
    if (episodes.length <= 1) {
      toast.error(t("cannotDeleteLast"));
      return;
    }
    if (!confirm(t("deleteConfirm"))) return;
    await deleteEpisode(projectId, episode.id);
  }

  if (loading) {
    return (
      <div className="flex min-h-[400px] items-center justify-center">
        <div className="flex flex-col items-center gap-3">
          <Loader2 className="h-6 w-6 animate-spin text-primary" />
          <p className="text-sm text-[--text-muted]">{tc("loading")}</p>
        </div>
      </div>
    );
  }

  return (
    <div className="mx-auto max-w-3xl flex-1 overflow-y-auto bg-[--surface] p-6 pb-24 lg:pb-6">
      {/* Header */}
      <div className="mb-6 flex items-center justify-between">
        <div className="flex items-center gap-3">
          <div className="flex h-9 w-9 items-center justify-center rounded-xl bg-primary/10 text-primary">
            <Layers className="h-4 w-4" />
          </div>
          <div>
            <h2 className="font-display text-lg font-semibold text-[--text-primary]">
              {t("title")}
            </h2>
            <p className="text-xs text-[--text-muted]">
              {episodes.length} {t("count")}
            </p>
          </div>
        </div>
        <Button onClick={() => setCreateOpen(true)} size="sm">
          <Plus className="mr-1.5 h-4 w-4" />
          {t("create")}
        </Button>
      </div>

      {/* Episode list */}
      {episodes.length === 0 ? (
        <div className="flex min-h-[300px] flex-col items-center justify-center rounded-2xl border border-dashed border-[--border-subtle] bg-white/50 p-8 text-center">
          <Layers className="mb-3 h-10 w-10 text-[--text-muted]/40" />
          <p className="text-sm text-[--text-muted]">{t("noEpisodes")}</p>
        </div>
      ) : (
        <div className="flex flex-col gap-3">
          {episodes.map((episode) => (
            <EpisodeCard
              key={episode.id}
              episode={episode}
              projectId={projectId}
              onEdit={handleEdit}
              onDelete={handleDelete}
            />
          ))}
        </div>
      )}

      {/* Create dialog */}
      <EpisodeDialog
        open={createOpen}
        onOpenChange={setCreateOpen}
        onSubmit={handleCreate}
        mode="create"
      />
    </div>
  );
}
