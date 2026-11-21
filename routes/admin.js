import { Router } from "express";
import { ObjectId } from "mongodb";
import { getCollections } from "../config/db.js";
import { verifyJWT } from "../middleware/verifyJWT.js";
import { requireRole } from "../middleware/requireRole.js";

const router = Router();

// All admin routes require verified JWT + admin role
router.use(verifyJWT, requireRole("admin"));

// 1. ADMIN OVERVIEW STATS
router.get("/overview", async (req, res, next) => {
  try {
    const {
      usersCollection,
      menuItemsCollection,
      transactionsCollection,
    } = await getCollections();

    const [
      totalUsers,
      totalVendors,
      totalCustomers,
      totalMenuItems,
      pendingMenuItems,
      totalTransactions,
    ] = await Promise.all([
      usersCollection.countDocuments({}),
      usersCollection.countDocuments({ role: "vendor" }),
      usersCollection.countDocuments({ role: "customer" }),
      menuItemsCollection.countDocuments({}),
      menuItemsCollection.countDocuments({ status: "pending" }),
      transactionsCollection.countDocuments({}),
    ]);

    return res.json({
      stats: {
        totalUsers,
        totalVendors,
        totalCustomers,
        totalMenuItems,
        pendingMenuItems,
        totalTransactions,
      },
    });
  } catch (err) {
    next(err);
  }
});

// 2. LIST & SEARCH/FILTER USERS
router.get("/users", async (req, res, next) => {
  try {
    const { usersCollection } = await getCollections();
    const { search = "", role = "" } = req.query;

    const filter = {};
    if (role && ["customer", "vendor", "admin"].includes(String(role))) {
      filter.role = String(role);
    }
    if (String(search).trim()) {
      const q = String(search).trim();
      filter.$or = [
        { name: { $regex: q, $options: "i" } },
        { email: { $regex: q, $options: "i" } },
        { businessName: { $regex: q, $options: "i" } },
      ];
    }

    const users = await usersCollection
      .find(filter, { projection: { password: 0 } })
      .sort({ createdAt: -1 })
      .toArray();

    return res.json({ users });
  } catch (err) {
    next(err);
  }
});

// 3. BLOCK / UNBLOCK USER
router.patch("/users/:id/block", async (req, res, next) => {
  try {
    const { id } = req.params;
    const { isBlocked } = req.body;

    if (typeof isBlocked !== "boolean") {
      return res.status(400).json({ message: "isBlocked must be a boolean" });
    }

    const { usersCollection } = await getCollections();
    const filter = ObjectId.isValid(id)
      ? { $or: [{ _id: new ObjectId(id) }, { id }] }
      : { $or: [{ id }, { _id: id }] };

    const targetUser = await usersCollection.findOne(filter);
    if (!targetUser) {
      return res.status(404).json({ message: "User not found" });
    }
    if (targetUser.role === "admin") {
      return res.status(403).json({ message: "Cannot block an admin account" });
    }

    await usersCollection.updateOne(filter, { $set: { isBlocked } });

    return res.json({
      message: isBlocked ? "User blocked successfully" : "User unblocked successfully",
      isBlocked,
    });
  } catch (err) {
    next(err);
  }
});

// 4. LIST ALL MENU ITEMS FOR REVIEW & MODERATION
router.get("/menu-items", async (req, res, next) => {
  try {
    const { menuItemsCollection, usersCollection } = await getCollections();
    const { search = "", status = "", category = "" } = req.query;

    const filter = {};
    if (status && ["pending", "approved", "rejected", "inactive"].includes(String(status))) {
      filter.status = String(status);
    }
    if (category && String(category).trim()) {
      filter.category = String(category).trim();
    }
    if (String(search).trim()) {
      const q = String(search).trim();
      filter.$or = [
        { itemName: { $regex: q, $options: "i" } },
        { location: { $regex: q, $options: "i" } },
      ];
    }

    const items = await menuItemsCollection
      .find(filter)
      .sort({ createdAt: -1 })
      .toArray();

    const vendorIds = [...new Set(items.map((i) => String(i.vendorId)).filter(Boolean))];
    const vendorObjIds = vendorIds.filter((v) => ObjectId.isValid(v)).map((v) => new ObjectId(v));

    const vendors = vendorIds.length
      ? await usersCollection
          .find({
            $or: [
              ...(vendorObjIds.length ? [{ _id: { $in: vendorObjIds } }] : []),
              { id: { $in: vendorIds } },
            ],
          })
          .project({ name: 1, email: 1, businessName: 1, subscriptionPlan: 1, id: 1 })
          .toArray()
      : [];

    const vendorMap = new Map();
    for (const v of vendors) {
      if (v._id) vendorMap.set(String(v._id), v);
      if (v.id) vendorMap.set(String(v.id), v);
    }

    const enrichedItems = items.map((item) => {
      const v = vendorMap.get(String(item.vendorId));
      return {
        ...item,
        vendor: v
          ? {
              id: String(v._id || v.id),
              name: v.businessName || v.name || "Vendor",
              email: v.email || "",
              subscriptionPlan: v.subscriptionPlan || "free",
            }
          : { id: item.vendorId, name: "Vendor", email: "", subscriptionPlan: "free" },
      };
    });

    return res.json({ items: enrichedItems });
  } catch (err) {
    next(err);
  }
});

// 5. APPROVE / REJECT / UPDATE MENU ITEM STATUS
router.patch("/menu-items/:id/status", async (req, res, next) => {
  try {
    const { id } = req.params;
    const { status } = req.body;

    if (!ObjectId.isValid(id)) {
      return res.status(400).json({ message: "Invalid menu item ID" });
    }
    if (!["pending", "approved", "rejected", "inactive"].includes(status)) {
      return res.status(400).json({ message: "Invalid status value" });
    }

    const { menuItemsCollection } = await getCollections();
    const item = await menuItemsCollection.findOne({ _id: new ObjectId(id) });

    if (!item) {
      return res.status(404).json({ message: "Menu item not found" });
    }

    await menuItemsCollection.updateOne(
      { _id: new ObjectId(id) },
      { $set: { status } }
    );

    return res.json({ message: `Menu item status updated to ${status}`, status });
  } catch (err) {
    next(err);
  }
});

// 6. DELETE INAPPROPRIATE MENU ITEM
router.delete("/menu-items/:id", async (req, res, next) => {
  try {
    const { id } = req.params;
    if (!ObjectId.isValid(id)) {
      return res.status(400).json({ message: "Invalid menu item ID" });
    }

    const { menuItemsCollection } = await getCollections();
    const result = await menuItemsCollection.deleteOne({ _id: new ObjectId(id) });

    if (result.deletedCount === 0) {
      return res.status(404).json({ message: "Menu item not found" });
    }

    return res.json({ message: "Menu item deleted by admin" });
  } catch (err) {
    next(err);
  }
});

// 7. VIEW TRANSACTIONS (READ-ONLY)
router.get("/transactions", async (req, res, next) => {
  try {
    const { transactionsCollection, usersCollection } = await getCollections();
    const transactions = await transactionsCollection
      .find({})
      .sort({ createdAt: -1 })
      .toArray();

    const vendorIds = [
      ...new Set(transactions.map((t) => String(t.vendorId)).filter(Boolean)),
    ];
    const vendorObjIds = vendorIds
      .filter((v) => ObjectId.isValid(v))
      .map((v) => new ObjectId(v));

    const vendors = vendorIds.length
      ? await usersCollection
          .find({
            $or: [
              ...(vendorObjIds.length ? [{ _id: { $in: vendorObjIds } }] : []),
              { id: { $in: vendorIds } },
            ],
          })
          .project({ name: 1, email: 1, businessName: 1, id: 1 })
          .toArray()
      : [];

    const vendorMap = new Map();
    for (const v of vendors) {
      if (v._id) vendorMap.set(String(v._id), v);
      if (v.id) vendorMap.set(String(v.id), v);
    }

    const enriched = transactions.map((tx) => {
      const v = vendorMap.get(String(tx.vendorId));
      return {
        ...tx,
        vendor: v
          ? {
              id: String(v._id || v.id),
              name: v.businessName || v.name || "Vendor",
              email: v.email || "",
            }
          : { id: tx.vendorId, name: "Vendor", email: "" },
      };
    });

    return res.json({ transactions: enriched });
  } catch (err) {
    next(err);
  }
});

export default router;