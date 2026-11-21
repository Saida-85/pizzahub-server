import { Router } from "express";
import multer from "multer";
import { verifyJWT } from "../middleware/verifyJWT.js";

const router = Router();

const upload = multer({
  storage: multer.memoryStorage(),
  limits: {
    fileSize: 5 * 1024 * 1024, // 5MB max
  },
});

// POST /api/upload — Upload an image file (multipart 'image') or base64 string to ImgBB
router.post("/", verifyJWT, upload.single("image"), async (req, res, next) => {
  try {
    const apiKey = process.env.IMGBB_API_KEY;
    if (!apiKey) {
      return res.status(500).json({ message: "ImgBB API key is not configured on the server" });
    }

    let base64Image = "";

    if (req.file) {
      if (!req.file.mimetype.startsWith("image/")) {
        return res.status(400).json({ message: "Only image files are allowed" });
      }
      base64Image = req.file.buffer.toString("base64");
    } else if (typeof req.body?.image === "string" && req.body.image.trim()) {
      base64Image = req.body.image.trim().replace(/^data:image\/\w+;base64,/, "");
    } else {
      return res.status(400).json({ message: "Please provide an image file to upload" });
    }

    const formData = new URLSearchParams();
    formData.append("key", apiKey);
    formData.append("image", base64Image);

    const imgbbRes = await fetch("https://api.imgbb.com/1/upload", {
      method: "POST",
      body: formData,
    });

    const data = await imgbbRes.json().catch(() => ({}));

    if (!imgbbRes.ok || !data?.success || !data?.data?.url) {
      return res.status(502).json({
        message: data?.error?.message || "Failed to upload image to ImgBB",
      });
    }

    return res.status(201).json({
      message: "Image uploaded successfully",
      url: data.data.url,
      displayUrl: data.data.display_url || data.data.url,
      deleteUrl: data.data.delete_url || "",
    });
  } catch (err) {
    next(err);
  }
});

export default router;