const express = require("express");
const fs = require("fs");
const path = require("path");
const ytdl = require("@distube/ytdl");
const ffmpegPath = require("ffmpeg-static");

const app = express();
const PORT = process.env.PORT || 3000;
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
    console.error("Info error:", err.message);
    res.status(500).json({ error: "Couldn't fetch that video. Try a different one." });
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

    // Get best quality (usually combined video+audio)
    const stream = ytdl.downloadFromInfo(info, { quality: "18" });

    const outputStream = fs.createWriteStream(outputPath);

    stream.on("error", (err) => {
      console.error("Stream error:", err);
      fs.unlink(outputPath, () => {});
      if (!res.headersSent) {
        res.status(500).send("Download failed");
      }
    });

    outputStream.on("error", (err) => {
      console.error("Write error:", err);
      if (!res.headersSent) {
        res.status(500).send("File write failed");
      }
    });

    outputStream.on("finish", () => {
      res.download(outputPath, `${safeTitle}.mp4`, (err) => {
        if (err && err.code !== "ECONNABORTED") {
          console.error("Download response error:", err);
        }
        fs.unlink(outputPath, (unlinkErr) => {
          if (unlinkErr) console.error("Cleanup error:", unlinkErr);
        });
      });
    });

    stream.pipe(outputStream);
  } catch (err) {
    console.error("Download error:", err.message);
    if (!res.headersSent) {
      res.status(500).json({ error: err.message || "Download failed" });
    }
  }
});

app.listen(PORT, () => {
  console.log(`✅ Server running on http://localhost:${PORT}`);
});