import ffmpeg from "fluent-ffmpeg";
import fs from "node:fs";
import path from "node:path";
import { ulid } from "ulid";

const uploadDir = process.env.UPLOAD_DIR || "./uploads";

type TransitionType = "cut" | "dissolve" | "fade_in" | "fade_out" | "wipeleft" | "slideright" | "circleopen";

const DEFAULT_XFADE_DURATION = 0.5;

interface SubtitleEntry {
  text: string;
  shotSequence: number;
  dialogueSequence: number;  // 0-based index within the shot
  dialogueCount: number;     // total dialogues in this shot
  startRatio?: number;       // 0-1, when dialogue starts relative to shot duration
  endRatio?: number;         // 0-1, when dialogue ends relative to shot duration
}

interface AssembleParams {
  videoPaths: string[];
  subtitles: SubtitleEntry[];
  projectId: string;
  shotDurations: number[];
  transitions?: TransitionType[]; // transition between shot[i] and shot[i+1], length = videoPaths.length - 1
}

function generateSrtFile(
  subtitles: SubtitleEntry[],
  shotDurations: number[],
  outputPath: string
): string {
  const srtPath = outputPath.replace(/\.mp4$/, ".srt");

  const shotStartTimes: number[] = [];
  let cumulative = 0;
  for (const duration of shotDurations) {
    shotStartTimes.push(cumulative);
    cumulative += duration;
  }

  const srtEntries: string[] = [];
  let index = 1;

  for (const sub of subtitles) {
    const shotIdx = sub.shotSequence - 1;
    if (shotIdx < 0 || shotIdx >= shotDurations.length) continue;

    const shotStart = shotStartTimes[shotIdx];
    const shotDur = shotDurations[shotIdx];

    let startTime: number;
    let endTime: number;

    if (sub.startRatio !== undefined && sub.endRatio !== undefined) {
      // Use explicit timing ratios from DB
      startTime = shotStart + shotDur * sub.startRatio;
      endTime = shotStart + shotDur * sub.endRatio;
    } else {
      // Auto-distribute: divide shot duration equally among dialogues
      const segmentDur = shotDur / sub.dialogueCount;
      startTime = shotStart + segmentDur * sub.dialogueSequence;
      endTime = startTime + segmentDur;
    }

    srtEntries.push(
      `${index}\n${formatSrtTime(startTime)} --> ${formatSrtTime(endTime)}\n${sub.text}\n`
    );
    index++;
  }

  fs.writeFileSync(srtPath, srtEntries.join("\n"));
  return srtPath;
}

function formatSrtTime(seconds: number): string {
  const h = Math.floor(seconds / 3600);
  const m = Math.floor((seconds % 3600) / 60);
  const s = Math.floor(seconds % 60);
  const ms = Math.floor((seconds % 1) * 1000);
  return `${String(h).padStart(2, "0")}:${String(m).padStart(2, "0")}:${String(s).padStart(2, "0")},${String(ms).padStart(3, "0")}`;
}

// Escape path for ffmpeg subtitles filter (colon, backslash, single quote)
function escapeSubtitlePath(p: string): string {
  return p.replace(/\\/g, "/").replace(/:/g, "\\:").replace(/'/g, "'\\''");
}

/** Map our transition type to ffmpeg xfade transition name */
function mapTransitionName(t: TransitionType): string {
  if (t === "fade_in" || t === "fade_out") return "fade";
  return t;
}

/**
 * Concatenate videos with optional xfade transitions.
 * Returns the path to the concatenated output file.
 */
async function concatWithTransitions(
  videoPaths: string[],
  transitions: TransitionType[],
  shotDurations: number[],
  outputPath: string,
  projectId: string,
  outputDir: string,
): Promise<void> {
  // Single video: just copy
  if (videoPaths.length === 1) {
    fs.copyFileSync(path.resolve(videoPaths[0]), outputPath);
    return;
  }

  // All cuts: use fast concat demuxer
  const allCuts = transitions.every((t) => t === "cut");
  if (allCuts) {
    const concatListPath = path.resolve(outputDir, `${projectId}-concat.txt`);
    const concatContent = videoPaths
      .map((p) => `file '${path.resolve(p)}'`)
      .join("\n");
    fs.writeFileSync(concatListPath, concatContent);

    await new Promise<void>((resolve, reject) => {
      ffmpeg()
        .input(concatListPath)
        .inputOptions(["-f", "concat", "-safe", "0"])
        .outputOptions(["-c", "copy"])
        .output(outputPath)
        .on("end", () => {
          fs.unlinkSync(concatListPath);
          resolve();
        })
        .on("error", (err) => {
          reject(new Error(`FFmpeg concat failed: ${err.message}`));
        })
        .run();
    });
    return;
  }

  // Mixed transitions: use xfade filter chain
  const cmd = ffmpeg();
  for (const vp of videoPaths) {
    cmd.input(path.resolve(vp));
  }

  // Build xfade filter chain
  const filterParts: string[] = [];
  let prevLabel = "0:v";
  let cumulativeOffset = 0;

  for (let i = 0; i < transitions.length; i++) {
    const t = transitions[i];
    const duration = shotDurations[i];
    const outLabel = i < transitions.length - 1 ? `v${i}` : "vout";

    if (t === "cut") {
      // For cut: use xfade with duration=0 to simulate hard cut
      const offset = cumulativeOffset + duration;
      filterParts.push(
        `[${prevLabel}][${i + 1}:v]xfade=transition=fade:duration=0:offset=${offset.toFixed(3)}[${outLabel}]`
      );
      cumulativeOffset = offset;
    } else {
      const xfadeDur = DEFAULT_XFADE_DURATION;
      const offset = cumulativeOffset + duration - xfadeDur;
      const xfadeName = mapTransitionName(t);
      filterParts.push(
        `[${prevLabel}][${i + 1}:v]xfade=transition=${xfadeName}:duration=${xfadeDur}:offset=${offset.toFixed(3)}[${outLabel}]`
      );
      cumulativeOffset = offset;
    }

    prevLabel = outLabel;
  }

  const complexFilter = filterParts.join(";");

  await new Promise<void>((resolve, reject) => {
    cmd
      .complexFilter(complexFilter, "vout")
      .outputOptions([
        "-c:v", "libx264",
        "-preset", "fast",
        "-crf", "23",
        "-an",
      ])
      .output(outputPath)
      .on("end", () => resolve())
      .on("error", (err) => {
        reject(new Error(`FFmpeg xfade concat failed: ${err.message}`));
      })
      .run();
  });
}

export async function assembleVideo(params: AssembleParams): Promise<string> {
  const { videoPaths, subtitles, projectId, shotDurations } = params;
  const transitions: TransitionType[] = params.transitions
    ?? new Array(Math.max(videoPaths.length - 1, 0)).fill("cut");

  const outputDir = path.resolve(uploadDir, "videos");
  fs.mkdirSync(outputDir, { recursive: true });
  const concatOutputPath = path.resolve(outputDir, `${projectId}-concat-${ulid()}.mp4`);
  const outputPath = path.resolve(outputDir, `${projectId}-final-${ulid()}.mp4`);

  // Step 1: Concatenate video clips (with transitions)
  await concatWithTransitions(videoPaths, transitions, shotDurations, concatOutputPath, projectId, outputDir);

  // Step 2: Burn in subtitles if any
  if (subtitles.length > 0) {
    const srtPath = generateSrtFile(subtitles, shotDurations, outputPath);
    const escapedSrtPath = escapeSubtitlePath(path.resolve(srtPath));

    try {
      await new Promise<void>((resolve, reject) => {
        ffmpeg()
          .input(concatOutputPath)
          .outputOptions([
            "-y",
            "-vf", `subtitles='${escapedSrtPath}'`,
            "-c:v", "libx264",
            "-preset", "fast",
            "-crf", "23",
            "-c:a", "aac",
          ])
          .output(outputPath)
          .on("end", () => {
            fs.unlinkSync(concatOutputPath);
            fs.unlinkSync(srtPath);
            resolve();
          })
          .on("error", (err) => {
            reject(err);
          })
          .run();
      });
    } catch (err) {
      // Fallback: skip subtitle burn, use concat output directly
      console.warn(`[FFmpeg] Subtitle burn failed, using concat output: ${err}`);
      try { fs.unlinkSync(srtPath); } catch {}
      fs.renameSync(concatOutputPath, outputPath);
    }
  } else {
    // No subtitles, just rename
    fs.renameSync(concatOutputPath, outputPath);
  }

  // Return relative path for uploadUrl compatibility
  return path.relative(process.cwd(), outputPath);
}
