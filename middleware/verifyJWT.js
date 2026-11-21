import jwt from "jsonwebtoken";
import { ObjectId } from "mongodb";
import { getCollections } from "../config/db.js";

export async function verifyJWT(req, res, next) {
  try {
    const authHeader = req.headers.authorization;
    if (!authHeader || !authHeader.startsWith("Bearer ")) {
      return res.status(401).json({ message: "Unauthorized: missing token" });
    }

    const token = authHeader.split(" ")[1];
    const decoded = jwt.verify(token, process.env.JWT_SECRET);
    const userId = decoded.sub || decoded.id || decoded.userId;

    if (!userId) {
      return res.status(401).json({ message: "Unauthorized: invalid token payload" });
    }

    const { usersCollection } = await getCollections();
    const query = ObjectId.isValid(userId)
      ? { $or: [{ _id: new ObjectId(userId) }, { id: userId }] }
      : { $or: [{ id: userId }, { _id: userId }] };

    const dbUser = await usersCollection.findOne(query);
    if (!dbUser) {
      return res.status(401).json({ message: "Unauthorized: user not found" });
    }

    if (dbUser.isBlocked) {
      return res.status(403).json({ message: "Forbidden: account is blocked" });
    }

    req.user = {
      id: String(dbUser._id || dbUser.id),
      email: dbUser.email,
      name: dbUser.name,
      role: dbUser.role || "customer",
      subscriptionPlan: dbUser.subscriptionPlan || "free",
      subscriptionExpiresAt: dbUser.subscriptionExpiresAt || null,
      isBlocked: Boolean(dbUser.isBlocked),
    };

    next();
  } catch (err) {
    return res.status(401).json({ message: "Unauthorized: invalid or expired token" });
  }
}