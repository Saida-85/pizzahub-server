import express from "express";
import cors from "cors";
import dotenv from "dotenv";
import { toNodeHandler, fromNodeHeaders } from "better-auth/node";
import { auth } from "./auth.js";

dotenv.config();

const app = express();
const PORT = process.env.PORT || 5000;

app.use(
  cors({
    origin: "http://localhost:3000",
    credentials: true,
  })
);

// Mount Better Auth handler for all /api/auth/* routes
app.all("/api/auth/*splat", toNodeHandler(auth));

app.use(express.json());

// Example protected Express route reading the Better Auth session
app.get("/api/me", async (req, res) => {
  const session = await auth.api.getSession({
    headers: fromNodeHeaders(req.headers),
  });

  if (!session) {
    return res.status(401).json({ error: "Unauthorized" });
  }

  return res.json({ user: session.user });
});

app.get("/", (req, res) => {
  res.send("PizzaHub Server is Running 🚀");
});

app.listen(PORT, () => {
  console.log(`Server running on http://localhost:${PORT}`);
});