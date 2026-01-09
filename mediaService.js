import path from "path";
import { promises as fs } from "fs";
import { spawn } from "child_process";

const OUTPUT_DIR = path.join(process.cwd(), "data", "outputs");
const DEFAULT_A1111_URL = "http://127.0.0.1:7860";

async function ensureOutputDir() {
  await fs.mkdir(OUTPUT_DIR, { recursive: true });
}

function buildOutputPath(prefix, ext) {
  const stamp = new Date().toISOString().replace(/[:.]/g, "-");
  return path.join(OUTPUT_DIR, `${prefix}-${stamp}.${ext}`);
}

async function writeBase64Image(data, outputPath) {
  const buffer = Buffer.from(data, "base64");
  await fs.writeFile(outputPath, buffer);
}

function getMediaConfig(config) {
  const media = config?.media || {};
  return {
    image: {
      provider: media?.image?.provider || "a1111",
      url: media?.image?.url || process.env.A1111_URL || DEFAULT_A1111_URL,
      width: media?.image?.width || 1024,
      height: media?.image?.height || 1024,
      steps: media?.image?.steps || 20,
      cfgScale: media?.image?.cfgScale || 7,
      sampler: media?.image?.sampler || "Euler a"
    },
    video: {
      ffmpegPath: media?.video?.ffmpegPath || process.env.FFMPEG_PATH || "ffmpeg",
      width: media?.video?.width || 1280,
      height: media?.video?.height || 720,
      seconds: media?.video?.seconds || 10,
      fps: media?.video?.fps || 24
    }
  };
}

async function generateWithA1111({ prompt, width, height, config }) {
  const media = getMediaConfig(config);
  const payload = {
    prompt,
    width: width || media.image.width,
    height: height || media.image.height,
    steps: media.image.steps,
    cfg_scale: media.image.cfgScale,
    sampler_name: media.image.sampler
  };

  const response = await fetch(`${media.image.url}/sdapi/v1/txt2img`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(payload)
  });

  if (!response.ok) {
    const errorBody = await response.text();
    throw new Error(`A1111 error (${response.status}): ${errorBody}`);
  }

  const data = await response.json();
  if (!data.images || data.images.length === 0) {
    throw new Error("No images returned from A1111.");
  }

  await ensureOutputDir();
  const outputPath = buildOutputPath("image", "png");
  await writeBase64Image(data.images[0], outputPath);

  return {
    url: `/data/outputs/${path.basename(outputPath)}`,
    engine: "a1111",
    width: payload.width,
    height: payload.height
  };
}

function runFfmpeg({ ffmpegPath, inputPath, outputPath, width, height, seconds, fps }) {
  return new Promise((resolve, reject) => {
    const frameCount = Math.max(1, Math.round(seconds * fps));
    const zoompan = `zoompan=z='min(zoom+0.0008,1.15)':d=${frameCount}:s=${width}x${height}`;
    const args = [
      "-y",
      "-loop",
      "1",
      "-i",
      inputPath,
      "-vf",
      `scale=${width}:${height},${zoompan}`,
      "-t",
      String(seconds),
      "-r",
      String(fps),
      "-pix_fmt",
      "yuv420p",
      outputPath
    ];

    const child = spawn(ffmpegPath, args, { stdio: "ignore" });
    child.on("error", (err) => reject(err));
    child.on("close", (code) => {
      if (code === 0) resolve();
      else reject(new Error(`ffmpeg exited with code ${code}`));
    });
  });
}

export async function generateImage({ prompt, width, height, config }) {
  const media = getMediaConfig(config);
  if (media.image.provider === "a1111") {
    return generateWithA1111({ prompt, width, height, config });
  }
  throw new Error("No image provider configured. Set config.media.image.provider to 'a1111'.");
}

export async function generateVideo({ prompt, width, height, seconds, fps, config }) {
  const media = getMediaConfig(config);
  const baseImage = await generateImage({
    prompt,
    width: width || media.video.width,
    height: height || media.video.height,
    config
  });

  await ensureOutputDir();
  const outputPath = buildOutputPath("video", "mp4");
  const resolvedWidth = width || media.video.width;
  const resolvedHeight = height || media.video.height;
  const resolvedSeconds = seconds || media.video.seconds;
  const resolvedFps = fps || media.video.fps;

  const localInputPath = path.join(OUTPUT_DIR, path.basename(baseImage.url));
  await runFfmpeg({
    ffmpegPath: media.video.ffmpegPath,
    inputPath: localInputPath,
    outputPath,
    width: resolvedWidth,
    height: resolvedHeight,
    seconds: resolvedSeconds,
    fps: resolvedFps
  });

  return {
    url: `/data/outputs/${path.basename(outputPath)}`,
    engine: `${baseImage.engine}+ffmpeg`,
    width: resolvedWidth,
    height: resolvedHeight,
    seconds: resolvedSeconds,
    fps: resolvedFps
  };
}
