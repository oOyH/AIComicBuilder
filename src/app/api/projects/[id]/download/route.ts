import { db } from "@/lib/db";
import { projects, shots, characters } from "@/lib/db/schema";
import { eq, asc } from "drizzle-orm";
import archiver from "archiver";
import path from "node:path";
import fs from "node:fs";
import { parseRefImages } from "@/lib/ref-image-utils";

export async function GET(
  _request: Request,
  { params }: { params: Promise<{ id: string }> }
) {
  const { id: projectId } = await params;

  const [project] = await db
    .select()
    .from(projects)
    .where(eq(projects.id, projectId));

  if (!project) {
    return new Response("Project not found", { status: 404 });
  }

  const allShots = await db
    .select()
    .from(shots)
    .where(eq(shots.projectId, projectId))
    .orderBy(asc(shots.sequence));

  if (allShots.length === 0) {
    return new Response("No shots to download", { status: 400 });
  }

  const projectChars = await db
    .select()
    .from(characters)
    .where(eq(characters.projectId, projectId));

  const archive = archiver("zip", { zlib: { level: 5 } });
  const chunks: Uint8Array[] = [];
  archive.on("data", (chunk: Buffer) => chunks.push(chunk));

  // Helper: add file to archive if it exists
  function addFile(srcPath: string, archiveName: string) {
    const abs = path.resolve(srcPath);
    if (fs.existsSync(abs)) {
      archive.file(abs, { name: archiveName });
      return true;
    }
    return false;
  }

  // 1. Character reference images
  for (const char of projectChars) {
    if (char.referenceImage) {
      const ext = path.extname(char.referenceImage) || ".png";
      const safeName = char.name.replace(/[^a-zA-Z0-9\u4e00-\u9fff_-]/g, "_");
      addFile(char.referenceImage, `characters/${safeName}${ext}`);
    }
  }

  // 2. Shot assets (all types)
  for (const shot of allShots) {
    const prefix = `shot-${String(shot.sequence).padStart(2, "0")}`;

    // Keyframe mode assets
    if (shot.firstFrame) {
      const ext = path.extname(shot.firstFrame) || ".png";
      addFile(shot.firstFrame, `${prefix}/first-frame${ext}`);
    }
    if (shot.lastFrame) {
      const ext = path.extname(shot.lastFrame) || ".png";
      addFile(shot.lastFrame, `${prefix}/last-frame${ext}`);
    }
    if (shot.videoUrl) {
      const ext = path.extname(shot.videoUrl) || ".mp4";
      addFile(shot.videoUrl, `${prefix}/video${ext}`);
    }

    // Reference mode assets
    if (shot.sceneRefFrame) {
      const ext = path.extname(shot.sceneRefFrame) || ".png";
      addFile(shot.sceneRefFrame, `${prefix}/scene-frame${ext}`);
    }
    if (shot.referenceVideoUrl) {
      const ext = path.extname(shot.referenceVideoUrl) || ".mp4";
      addFile(shot.referenceVideoUrl, `${prefix}/ref-video${ext}`);
    }

    // Reference images (multi-image mode)
    const refItems = parseRefImages(shot.referenceImages as string);
    let refIdx = 1;
    for (const ref of refItems) {
      if (ref.type === "reference" && ref.imagePath) {
        const ext = path.extname(ref.imagePath) || ".png";
        addFile(ref.imagePath, `${prefix}/ref-${String(refIdx).padStart(2, "0")}${ext}`);
        refIdx++;
      }
    }
  }

  // 3. Final assembled video
  if (project.finalVideoUrl) {
    const ext = path.extname(project.finalVideoUrl) || ".mp4";
    addFile(project.finalVideoUrl, `final-video${ext}`);
  }

  await archive.finalize();

  const buffer = Buffer.concat(chunks);
  const safeName = (project.title || "project").replace(/[^a-zA-Z0-9\u4e00-\u9fff_-]/g, "_");

  return new Response(buffer, {
    headers: {
      "Content-Type": "application/zip",
      "Content-Disposition": `attachment; filename="${encodeURIComponent(safeName)}-storyboard.zip"`,
    },
  });
}
