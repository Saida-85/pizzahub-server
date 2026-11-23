import "dotenv/config";
import express from "express";
import cors from "cors";
import dotenv from "dotenv";
import { connectDB } from "./config/db.js";
import webhookRouter from "./routes/webhook.js";
import menuItemsRouter from "./routes/menuItems.js";
import ordersRouter from "./routes/orders.js";
import vendorRouter from "./routes/vendor.js";
import adminRouter from "./routes/admin.js";
import paymentsRouter from "./routes/payments.js";
import uploadRouter from "./routes/upload.js";
import favoritesRouter from "./routes/favorites.js";

dotenv.config();

const app = express();
const PORT = process.env.PORT || 5000;

await connectDB();

app.use(
  cors({
    origin: process.env.CLIENT_URL || "http://localhost:3000",
    credentials: true,
  })
);

// MUST come before express.json() so Stripe can verify raw body signatures
app.use("/api/webhook", webhookRouter);

app.use(express.json());

app.get("/", (req, res) => {
  res.send("PizzaHub Server is Running 🚀");
});

app.use("/api/menu-items", menuItemsRouter);
app.use("/api/orders", ordersRouter);
app.use("/api/vendor", vendorRouter);
app.use("/api/admin", adminRouter);
app.use("/api/payments", paymentsRouter);
app.use("/api/upload", uploadRouter);
app.use("/api/favorites", favoritesRouter);

// Unknown routes return JSON instead of the default HTML 404 page
app.use((req, res) => {
  res.status(404).json({ message: "Route not found" });
});

// Central error handler
app.use((err, req, res, next) => {
  console.error(err);
  res.status(err.status || 500).json({
    message: err.message || "Internal Server Error",
  });
});

app.listen(PORT, () => {
  console.log(`Server running on http://localhost:${PORT}`);
});