
const express = require("express");
const fs = require("fs");
const path = require("path");
const { execFile } = require("child_process");
const { promisify } = require("util");
const ffmpegPath = require("ffmpeg-static");
const { YtDlp, helpers } = require("ytdlp-nodejs");

const execFileAsync = promisify(execFile);
const app = express();
const PORT = process.env.PORT || 3000;
const ytdlp = new YtDlp();
const DOWNLOAD_DIR = path.join(__dirname, "downloads");

if (!fs.existsSync(DOWNLOAD_DIR)) {
  fs.mkdirSync(DOWNLOAD_DIR, { recursive: true });
}

// Serve everything inside the "public" folder (our webpage)
app.use(express.static(path.join(__dirname, "public")));

function isYoutubeUrl(url) {
  return typeof url === "string" && /youtube\.com|youtu\.be/.test(url);
}

function getYoutubeDownloadOptions() {
  return [
    "--no-playlist",
    "-f",
    "bestvideo*[height<=720]+bestaudio/best[height<=720]",
    "-S",
    "res:720",
    "--merge-output-format",
    "mp4",
    "--ffmpeg-location",
    path.dirname(ffmpegPath),
    "--retries",
    "10",
    "--fragment-retries",
    "10",
    "--socket-timeout",
    "15",
  ];
}

function sanitizeTitle(title) {
  return String(title || "video")
    .replace(/[<>:"/\\|?*]+/g, "")
    .replace(/\s+/g, " ")
    .trim() || "video";
}

async function downloadVideoFile(videoUrl, outputPath) {
  const binaryPath = helpers.findYtdlpBinary() || "yt-dlp";
  const args = [videoUrl, ...getYoutubeDownloadOptions(), "--output", outputPath];
  const result = await execFileAsync(binaryPath, args, { windowsHide: true });
  if (result.stdout) console.log("[yt-dlp LOG]:\n" + result.stdout);
  if (result.stderr) console.error("[yt-dlp ERR]:\n" + result.stderr);
}

// ---- STEP 1: Look up info about the video (title, thumbnail, etc.) ----
app.get("/api/info", async (req, res) => {
  try {
    const videoUrl = req.query.url;

    if (!isYoutubeUrl(videoUrl)) {
      return res.status(400).json({ error: "That doesn't look like a valid YouTube link." });
    }

    const info = await ytdlp.getInfoAsync(videoUrl);

    res.json({
      title: info.title,
      thumbnail: info.thumbnail,
      lengthSeconds: info.duration,
      author: info.channel || info.uploader,
    });
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: "Couldn't fetch that video. It might be private, age-restricted, or removed." });
  }
});

// ---- STEP 2: Actually download the video and hand it to the browser ----
app.get("/api/download", async (req, res) => {
  try {
    const videoUrl = req.query.url;

    if (!isYoutubeUrl(videoUrl)) {
      return res.status(400).send("Invalid YouTube URL");
    }

    const info = await ytdlp.getInfoAsync(videoUrl);
    const safeTitle = sanitizeTitle(info.title);
    const downloadId = `${Date.now()}-${info.id}`;
    const outputTemplate = path.join(DOWNLOAD_DIR, `${downloadId}.%(ext)s`);

    await downloadVideoFile(videoUrl, outputTemplate);

    const outputFile = fs.readdirSync(DOWNLOAD_DIR)
      .filter((name) => name.startsWith(`${downloadId}.`))
      .map((name) => path.join(DOWNLOAD_DIR, name))
      .find((filePath) => fs.statSync(filePath).isFile());

    if (!outputFile) {
      throw new Error("Downloaded file not found.");
    }

    res.download(outputFile, `${safeTitle}.mp4`, (err) => {
      if (err && err.code !== "ECONNABORTED") {
        console.error("Res download error:", err);
      }

      fs.unlink(outputFile, (unlinkErr) => {
        if (unlinkErr) {
          console.error("Could not delete temp file:", unlinkErr);
        }
      });
    });
  } catch (err) {
    console.error(err);
    if (!res.headersSent) res.status(500).send("Download failed: " + err.message);
  }
});

async function start() {
  console.log("Checking setup...");

  const installed = await ytdlp.checkInstallationAsync();
  if (!installed) {
    console.log("First run: downloading the yt-dlp engine (about 10-15 seconds, one time only)...");
    await helpers.downloadYtDlp();
    console.log("Done.");
  } else {
    console.log("yt-dlp is ready!");
  }

  app.listen(PORT, () => {
    console.log(`✅ Server is running! Open http://localhost:${PORT} in your browser.`);
  });
}

start();
