import { Router } from "express";
import { ObjectId } from "mongodb";
import { getCollections } from "../config/db.js";
import { verifyJWT } from "../middleware/verifyJWT.js";
import { requireRole } from "../middleware/requireRole.js";

const router = Router();

// Favorites belong to customers only. Role is checked on the server for every route.
router.use(verifyJWT, requireRole("customer"));

// Favorites are stored as an array of menu item ids on the customer's user document,
// so no extra collection is needed.
const userFilter = (id) =>
  ObjectId.isValid(id)
    ? { $or: [{ _id: new ObjectId(id) }, { id }] }
    : { $or: [{ id }, { _id: id }] };

function effectivePlan(v) {
  if (v?.subscriptionPlan !== "premium") return "free";
  if (v.subscriptionExpiresAt && new Date(v.subscriptionExpiresAt) < new Date()) return "free";
  return "premium";
}

async function getFavoriteIds(usersCollection, userId) {
  const user = await usersCollection.findOne(userFilter(userId), {
    projection: { favorites: 1 },
  });
  return (user?.favorites ?? []).map(String);
}

async function withVendors(items, usersCollection) {
  if (!items.length) return [];
  const vendorIds = [...new Set(items.map((i) => String(i.vendorId)))];
  const objectIds = vendorIds.filter((id) => ObjectId.isValid(id)).map((id) => new ObjectId(id));

  const vendors = await usersCollection
    .find({
      $or: [
        ...(objectIds.length ? [{ _id: { $in: objectIds } }] : []),
        { id: { $in: vendorIds } },
      ],
    })
    .project({ name: 1, businessName: 1, subscriptionPlan: 1, subscriptionExpiresAt: 1, id: 1 })
    .toArray();

  const map = new Map();
  for (const v of vendors) {
    if (v._id) map.set(String(v._id), v);
    if (v.id) map.set(String(v.id), v);
  }

  return items.map((item) => {
    const v = map.get(String(item.vendorId));
    return {
      ...item,
      vendor: {
        id: String(item.vendorId),
        name: v?.businessName || v?.name || "Local Pizzeria",
        subscriptionPlan: effectivePlan(v),
      },
    };
  });
}

// GET /api/favorites/ids: only the ids (used to fill the heart buttons)
router.get("/ids", async (req, res, next) => {
  try {
    const { usersCollection } = await getCollections();
    const ids = await getFavoriteIds(usersCollection, req.user.id);
    return res.json({ ids });
  } catch (err) {
    next(err);
  }
});

// GET /api/favorites: full items (approved only) for the Favorites page
router.get("/", async (req, res, next) => {
  try {
    const { usersCollection, menuItemsCollection } = await getCollections();
    const ids = (await getFavoriteIds(usersCollection, req.user.id)).filter((id) =>
      ObjectId.isValid(id)
    );

    if (!ids.length) return res.json({ items: [] });

    const items = await menuItemsCollection
      .find({ _id: { $in: ids.map((id) => new ObjectId(id)) }, status: "approved" })
      .sort({ createdAt: -1 })
      .toArray();

    return res.json({ items: await withVendors(items, usersCollection) });
  } catch (err) {
    next(err);
  }
});

// POST /api/favorites/:itemId: add a favorite
router.post("/:itemId", async (req, res, next) => {
  try {
    const { itemId } = req.params;
    if (!ObjectId.isValid(itemId)) {
      return res.status(400).json({ message: "Invalid menu item ID" });
    }

    const { usersCollection, menuItemsCollection } = await getCollections();
    const item = await menuItemsCollection.findOne({ _id: new ObjectId(itemId) });
    if (!item || item.status !== "approved") {
      return res.status(404).json({ message: "Menu item not found" });
    }

    await usersCollection.updateOne(userFilter(req.user.id), {
      $addToSet: { favorites: String(item._id) },
    });

    return res.status(201).json({ message: "Added to favorites", favorited: true });
  } catch (err) {
    next(err);
  }
});

// DELETE /api/favorites/:itemId: remove a favorite
router.delete("/:itemId", async (req, res, next) => {
  try {
    const { itemId } = req.params;
    if (!ObjectId.isValid(itemId)) {
      return res.status(400).json({ message: "Invalid menu item ID" });
    }

    const { usersCollection } = await getCollections();
    await usersCollection.updateOne(userFilter(req.user.id), {
      $pull: { favorites: String(itemId) },
    });

    return res.json({ message: "Removed from favorites", favorited: false });
  } catch (err) {
    next(err);
  }
});

export default router;