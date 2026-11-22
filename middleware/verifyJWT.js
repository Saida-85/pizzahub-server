import { createRemoteJWKSet, jwtVerify } from "jose";
import { ObjectId } from "mongodb";
import { getCollections } from "../config/db.js";

let jwks;
function getJWKS() {
  if (!jwks) {
    const base = process.env.CLIENT_URL || "http://localhost:3000";
    jwks = createRemoteJWKSet(new URL("/api/auth/jwks", base));
  }
  return jwks;
}

function effectivePlan(u) {
  if (u.subscriptionPlan !== "premium") return "free";
  if (u.subscriptionExpiresAt && new Date(u.subscriptionExpiresAt) < new Date()) return "free";
  return "premium";
}

export async function verifyJWT(req, res, next) {
  try {
    const h = req.headers.authorization;
    if (!h || !h.startsWith("Bearer ")) {
      return res.status(401).json({ message: "Unauthorized: missing token" });
    }
    const { payload } = await jwtVerify(h.split(" ")[1], getJWKS());
    const userId = payload.sub || payload.id;
    if (!userId) return res.status(401).json({ message: "Unauthorized: invalid token payload" });

    const { usersCollection } = await getCollections();
    const query = ObjectId.isValid(userId)
      ? { $or: [{ _id: new ObjectId(userId) }, { id: userId }] }
      : { $or: [{ id: userId }, { _id: userId }] };

    const dbUser = await usersCollection.findOne(query);
    if (!dbUser) return res.status(401).json({ message: "Unauthorized: user not found" });
    if (dbUser.isBlocked) return res.status(403).json({ message: "Forbidden: account is blocked" });

    req.user = {
      id: String(dbUser._id || dbUser.id),
      email: dbUser.email,
      name: dbUser.name,
      role: dbUser.role || "customer",
      subscriptionPlan: effectivePlan(dbUser),
      subscriptionExpiresAt: dbUser.subscriptionExpiresAt || null,
      isBlocked: Boolean(dbUser.isBlocked),
    };
    next();
  } catch {
    return res.status(401).json({ message: "Unauthorized: invalid or expired token" });
  }
}