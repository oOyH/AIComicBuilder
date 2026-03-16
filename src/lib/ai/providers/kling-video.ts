import type { VideoProvider, VideoGenerateParams } from "../types";
import fs from "node:fs";
import path from "node:path";
import crypto from "node:crypto";
import { ulid } from "ulid";

function generateKlingToken(accessKey: string, secretKey: string): string {
  const now = Math.floor(Date.now() / 1000);
  const header = Buffer.from(JSON.stringify({ alg: "HS256", typ: "JWT" })).toString("base64url");
  const payload = Buffer.from(
    JSON.stringify({ iss: accessKey, exp: now + 1800, nbf: now - 5 })
  ).toString("base64url");
  const signature = crypto
    .createHmac("sha256", secretKey)
    .update(`${header}.${payload}`)
    .digest("base64url");
  return `${header}.${payload}.${signature}`;
}

interface KlingResponse<T> {
  code: number;
  message: string;
  data: T;
}


interface KlingTaskData {
  task_id: string;
  task_status: "submitted" | "processing" | "succeed" | "failed";
  task_status_msg: string;
  task_result: {
    videos?: { url: string }[];
  };
}


function toBase64(filePath: string): string {
  let data: Buffer;
  try {
    data = fs.readFileSync(filePath);
  } catch {
    throw new Error(`Kling: frame file not found: ${filePath}`);
  }
  return data.toString("base64");
}

export class KlingVideoProvider implements VideoProvider {
  private apiKey: string;
  private secretKey: string;
  private baseUrl: string;
  private model: string;
  private uploadDir: string;

  constructor(params?: {
    apiKey?: string;
    secretKey?: string;
    baseUrl?: string;
    model?: string;
    uploadDir?: string;
  }) {
    this.apiKey = (params?.apiKey || process.env.KLING_ACCESS_KEY || "").trim();
    this.secretKey = (params?.secretKey || process.env.KLING_SECRET_KEY || "").trim();
    this.baseUrl = (params?.baseUrl || "https://api.klingai.com").replace(/\/+$/, "");
    this.model = params?.model || "kling-v1";
    this.uploadDir = params?.uploadDir || process.env.UPLOAD_DIR || "./uploads";
  }

  private getAuthHeader(): string {
    if (this.secretKey) {
      return `Bearer ${generateKlingToken(this.apiKey, this.secretKey)}`;
    }
    return `Bearer ${this.apiKey}`;
  }

  async generateVideo(params: VideoGenerateParams): Promise<string> {
    const duration = params.duration <= 5 ? 5 : 10;
    const aspectRatio = params.ratio;

    let taskId: string;

    if ("firstFrame" in params) {
      // ── Keyframe mode: image2video ──
      const kp = params as { firstFrame: string; lastFrame: string };
      const imageData = toBase64(kp.firstFrame);
      const tailImageData = toBase64(kp.lastFrame);

      console.log(
        `[Kling Video] image2video: model=${this.model}, duration=${duration}s, ratio=${aspectRatio}`
      );

      const submitRes = await fetch(`${this.baseUrl}/v1/videos/image2video`, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          Authorization: this.getAuthHeader(),
        },
        body: JSON.stringify({
          model: this.model,
          prompt: params.prompt,
          image: imageData,
          tail_image: tailImageData,
          duration,
          aspect_ratio: aspectRatio,
          sound: "on",
        }),
      });

      if (!submitRes.ok) {
        const errBody = await submitRes.text().catch(() => "");
        throw new Error(`Kling image2video submit failed: ${submitRes.status} ${errBody}`);
      }

      const submitJson = (await submitRes.json()) as KlingResponse<{ task_id: string }>;
      if (submitJson.code !== 0) {
        throw new Error(`Kling image2video error: ${submitJson.message}`);
      }
      taskId = submitJson.data.task_id;
      console.log(`[Kling Video] image2video task submitted: ${taskId}`);

    } else {
      // ── Reference image mode: text2video ──
      const refImages = params.charRefImages.map((p) => toBase64(p));

      console.log(
        `[Kling Video] text2video: model=${this.model}, duration=${duration}s, ratio=${aspectRatio}, refs=${refImages.length}`
      );

      let submitRes = await fetch(`${this.baseUrl}/v1/videos/text2video`, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          Authorization: this.getAuthHeader(),
        },
        body: JSON.stringify({
          model: this.model,
          prompt: params.prompt,
          reference_image: refImages,
          duration,
          aspect_ratio: aspectRatio,
        }),
      });

      // Fallback: if reference_image is unsupported (400/422), retry without it
      if (submitRes.status === 400 || submitRes.status === 422) {
        console.warn(`[Kling Video] text2video reference_image rejected (${submitRes.status}), retrying without ref images`);
        submitRes = await fetch(`${this.baseUrl}/v1/videos/text2video`, {
          method: "POST",
          headers: {
            "Content-Type": "application/json",
            Authorization: this.getAuthHeader(),
          },
          body: JSON.stringify({
            model: this.model,
            prompt: params.prompt,
            duration,
            aspect_ratio: aspectRatio,
          }),
        });
      }

      if (!submitRes.ok) {
        const errBody = await submitRes.text().catch(() => "");
        throw new Error(`Kling text2video submit failed: ${submitRes.status} ${errBody}`);
      }

      const submitJson = (await submitRes.json()) as KlingResponse<{ task_id: string }>;
      if (submitJson.code !== 0) {
        throw new Error(`Kling text2video error: ${submitJson.message}`);
      }
      taskId = submitJson.data.task_id;
      console.log(`[Kling Video] text2video task submitted: ${taskId}`);
    }

    const taskType = "firstFrame" in params ? "image2video" : "text2video";
    const videoUrl = await this.pollForResult(taskId, taskType);

    // Download video
    const videoRes = await fetch(videoUrl);
    const buffer = Buffer.from(await videoRes.arrayBuffer());
    const filename = `${ulid()}.mp4`;
    const dir = path.join(this.uploadDir, "videos");
    fs.mkdirSync(dir, { recursive: true });
    const filepath = path.join(dir, filename);
    fs.writeFileSync(filepath, buffer);

    console.log(`[Kling Video] Saved to ${filepath}`);
    return filepath;
  }

  private async pollForResult(
    taskId: string,
    taskType: "image2video" | "text2video"
  ): Promise<string> {
    const maxAttempts = 120;

    for (let i = 0; i < maxAttempts; i++) {
      await new Promise((resolve) => setTimeout(resolve, 5_000));

      const res = await fetch(
        `${this.baseUrl}/v1/videos/${taskType}/${taskId}`,
        { headers: { Authorization: this.getAuthHeader() } }
      );

      if (!res.ok) {
        throw new Error(`Kling video poll failed: ${res.status}`);
      }

      const json = (await res.json()) as KlingResponse<KlingTaskData>;

      if (json.code !== 0) {
        throw new Error(`Kling video poll error: ${json.message}`);
      }

      const { task_status, task_status_msg, task_result } = json.data;
      console.log(`[Kling Video] Poll ${i + 1}: status=${task_status}`);

      if (task_status === "succeed") {
        const url = task_result.videos?.[0]?.url;
        if (!url) throw new Error("Kling video: no URL in result");
        return url;
      }

      if (task_status === "failed") {
        throw new Error(`Kling video generation failed: ${task_status_msg}`);
      }
    }

    throw new Error("Kling video generation timed out after 10 minutes");
  }
}
