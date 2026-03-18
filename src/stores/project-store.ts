import { create } from "zustand";
import { apiFetch } from "@/lib/api-fetch";

interface Character {
  id: string;
  name: string;
  description: string;
  referenceImage: string | null;
}

interface Dialogue {
  id: string;
  text: string;
  characterId: string;
  characterName: string;
  sequence: number;
}

interface Shot {
  id: string;
  sequence: number;
  prompt: string;
  startFrameDesc: string | null;
  endFrameDesc: string | null;
  videoScript: string | null;
  motionScript: string | null;
  cameraDirection: string;
  duration: number;
  firstFrame: string | null;
  lastFrame: string | null;
  videoUrl: string | null;
  referenceVideoUrl: string | null;
  lastFrameUrl: string | null;
  sceneRefFrame: string | null;
  status: string;
  dialogues: Dialogue[];
}

interface Project {
  id: string;
  title: string;
  idea: string;
  script: string;
  status: string;
  finalVideoUrl: string | null;
  generationMode: "keyframe" | "reference";
  characters: Character[];
  shots: Shot[];
}

interface ProjectStore {
  project: Project | null;
  loading: boolean;
  fetchProject: (id: string) => Promise<void>;
  updateIdea: (idea: string) => void;
  updateScript: (script: string) => void;
  setProject: (project: Project) => void;
}

export const useProjectStore = create<ProjectStore>((set) => ({
  project: null,
  loading: false,

  fetchProject: async (id: string) => {
    set({ loading: true });
    const res = await apiFetch(`/api/projects/${id}`);
    const data = await res.json();
    set({ project: data, loading: false });
  },

  updateIdea: (idea: string) => {
    set((state) => ({
      project: state.project ? { ...state.project, idea } : null,
    }));
  },

  updateScript: (script: string) => {
    set((state) => ({
      project: state.project ? { ...state.project, script } : null,
    }));
  },

  setProject: (project: Project) => {
    set({ project });
  },
}));
