const express = require("express");
const fs = require("fs");
const path = require("path");
const ytdl = require("ytdl-core");
const ffmpegPath = require("ffmpeg-static");
const { spawn } = require("child_process");

const app = express();
const PORT = 3000;
const DOWNLOAD_DIR = path.join(__dirname, "downloads");

if (!fs.existsSync(DOWNLOAD_DIR)) {
  fs.mkdirSync(DOWNLOAD_DIR, { recursive: true });
}

app.use(express.static(path.join(__dirname, "public")));

function isYoutubeUrl(url) {
  return typeof url === "string" && /youtube\.com|youtu\.be/.test(url);
}

function sanitizeTitle(title) {
  return String(title || "video")
    .replace(/[<>:"/\\|?*]+/g, "")
    .replace(/\s+/g, " ")
    .trim() || "video";
}

// Get video info
app.get("/api/info", async (req, res) => {
  try {
    const videoUrl = req.query.url;

    if (!isYoutubeUrl(videoUrl)) {
      return res.status(400).json({ error: "Invalid YouTube URL" });
    }

    const info = await ytdl.getInfo(videoUrl);
    const videoDetails = info.videoDetails;

    res.json({
      title: videoDetails.title,
      thumbnail: videoDetails.thumbnail.thumbnails[videoDetails.thumbnail.thumbnails.length - 1].url,
      lengthSeconds: videoDetails.lengthSeconds,
      author: videoDetails.author.name,
    });
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: "Couldn't fetch that video. Check if the URL is valid." });
  }
});

// Download video
app.get("/api/download", async (req, res) => {
  try {
    const videoUrl = req.query.url;

    if (!isYoutubeUrl(videoUrl)) {
      return res.status(400).send("Invalid YouTube URL");
    }

    const info = await ytdl.getInfo(videoUrl);
    const videoDetails = info.videoDetails;
    const safeTitle = sanitizeTitle(videoDetails.title);
    const downloadId = `${Date.now()}-${videoDetails.videoId}`;
    const outputPath = path.join(DOWNLOAD_DIR, `${downloadId}.mp4`);

    // Get best video and audio streams
    const formats = ytdl.filterFormats(info.formats, { quality: "highest" });
    
    const videoStream = formats.find(f => f.hasVideo && !f.hasAudio);
    const audioStream = formats.find(f => f.hasAudio && !f.hasVideo);

    if (!videoStream || !audioStream) {
      return res.status(500).json({ error: "No suitable streams found" });
    }

    // Merge video and audio with ffmpeg
    const video = ytdl.downloadFromInfo(info, { format: videoStream });
    const audio = ytdl.downloadFromInfo(info, { format: audioStream });

    const ffmpeg = spawn(ffmpegPath, [
      "-i", "pipe:3",
      "-i", "pipe:4",
      "-c:v", "copy",
      "-c:a", "aac",
      "-map", "0:v:0",
      "-map", "1:a:0",
      outputPath,
    ], {
      stdio: ["pipe", "pipe", "pipe", "pipe", "pipe"],
    });

    video.pipe(ffmpeg.stdio[3]);
    audio.pipe(ffmpeg.stdio[4]);

    ffmpeg.on("close", () => {
      res.download(outputPath, `${safeTitle}.mp4`, (err) => {
        if (err && err.code !== "ECONNABORTED") {
          console.error("Download error:", err);
        }
        fs.unlink(outputPath, () => {});
      });
    });

    ffmpeg.on("error", (err) => {
      console.error("FFmpeg error:", err);
      res.status(500).send("Encoding failed");
    });
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: err.message });
  }
});

app.listen(PORT, () => {
  console.log(`✅ Server running on http://localhost:${PORT}`);
});