import { Router } from "express";
import { ObjectId } from "mongodb";
import { getCollections } from "../config/db.js";
import { verifyJWT } from "../middleware/verifyJWT.js";
import { requireRole } from "../middleware/requireRole.js";
import { MENU_CATEGORIES } from "../constants/categories.js";

const router = Router();

const FREE_PLAN_LIMIT = 3;

// Treat user text as plain text, not as a regular expression
const escapeRegex = (s) => s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");

// A Premium plan that has expired counts as Free
function effectivePlan(vendor) {
  if (vendor?.subscriptionPlan !== "premium") return "free";
  if (vendor.subscriptionExpiresAt && new Date(vendor.subscriptionExpiresAt) < new Date()) {
    return "free";
  }
  return "premium";
}

// Helper to attach vendor details to menu items
async function attachVendors(items, usersCollection) {
  if (!items.length) return [];

  const vendorIds = [...new Set(items.map((item) => item.vendorId).filter(Boolean))];
  const objectIds = vendorIds.filter((id) => ObjectId.isValid(id)).map((id) => new ObjectId(id));

  const vendors = await usersCollection
    .find({
      $or: [
        ...(objectIds.length ? [{ _id: { $in: objectIds } }] : []),
        { id: { $in: vendorIds } },
      ],
    })
    .project({
      name: 1,
      businessName: 1,
      image: 1,
      subscriptionPlan: 1,
      subscriptionExpiresAt: 1,
      id: 1,
    })
    .toArray();

  const vendorMap = new Map();
  for (const v of vendors) {
    if (v._id) vendorMap.set(String(v._id), v);
    if (v.id) vendorMap.set(String(v.id), v);
  }

  return items.map((item) => {
    const v = vendorMap.get(String(item.vendorId));
    return {
      ...item,
      vendor: v
        ? {
            id: String(v._id || v.id),
            name: v.businessName || v.name || "Local Pizzeria",
            ownerName: v.name || "",
            image: v.image || "",
            subscriptionPlan: effectivePlan(v),
          }
        : {
            id: item.vendorId,
            name: "Local Pizzeria",
            ownerName: "",
            image: "",
            subscriptionPlan: "free",
          },
    };
  });
}

// 1. PUBLIC: Browse approved & active menu items (with search, filters & price sort)
router.get("/", async (req, res, next) => {
  try {
    const { menuItemsCollection, usersCollection } = await getCollections();

    const search = String(req.query.search ?? "").trim();
    const category = String(req.query.category ?? "").trim();
    const location = String(req.query.location ?? "").trim();
    const sort = String(req.query.sort ?? "");

    // Only approved items are ever public. Rejected, pending and inactive items never show.
    const filter = { status: "approved" };

    if (search) {
      filter.itemName = { $regex: escapeRegex(search), $options: "i" };
    }
    if (category && MENU_CATEGORIES.includes(category)) {
      filter.category = category;
    }
    if (location) {
      filter.location = { $regex: escapeRegex(location), $options: "i" };
    }

    let sortOption = { createdAt: -1 };
    if (sort === "price_asc") sortOption = { price: 1 };
    if (sort === "price_desc") sortOption = { price: -1 };

    const items = await menuItemsCollection.find(filter).sort(sortOption).toArray();
    const enriched = await attachVendors(items, usersCollection);

    // Promote premium vendors to the top when not explicitly sorting by price
    if (sort !== "price_asc" && sort !== "price_desc") {
      enriched.sort((a, b) => {
        const aPrem = a.vendor?.subscriptionPlan === "premium" ? 1 : 0;
        const bPrem = b.vendor?.subscriptionPlan === "premium" ? 1 : 0;
        return bPrem - aPrem;
      });
    }

    return res.json({ items: enriched });
  } catch (err) {
    next(err);
  }
});

// 2. VENDOR: Get logged-in vendor's own menu items (all statuses)
router.get("/vendor/my", verifyJWT, requireRole("vendor"), async (req, res, next) => {
  try {
    const { menuItemsCollection } = await getCollections();
    const items = await menuItemsCollection
      .find({ vendorId: req.user.id })
      .sort({ createdAt: -1 })
      .toArray();

    return res.json({ items });
  } catch (err) {
    next(err);
  }
});

// 3. PUBLIC: Get single approved menu item details
router.get("/:id", async (req, res, next) => {
  try {
    const { id } = req.params;
    if (!ObjectId.isValid(id)) {
      return res.status(400).json({ message: "Invalid menu item ID" });
    }

    const { menuItemsCollection, usersCollection } = await getCollections();
    const item = await menuItemsCollection.findOne({ _id: new ObjectId(id) });

    // Pending, rejected and inactive items are not visible to the public
    if (!item || item.status !== "approved") {
      return res.status(404).json({ message: "Menu item not found" });
    }

    const [enriched] = await attachVendors([item], usersCollection);
    return res.json({ item: enriched });
  } catch (err) {
    next(err);
  }
});

// 4. VENDOR: Create a new menu item (default status: pending)
router.post("/", verifyJWT, requireRole("vendor"), async (req, res, next) => {
  try {
    const { itemName, category, description, price, location, images } = req.body;

    if (!itemName?.trim() || !category || !description?.trim() || !location?.trim()) {
      return res.status(400).json({ message: "All required fields must be filled" });
    }

    if (!MENU_CATEGORIES.includes(category)) {
      return res.status(400).json({ message: "Invalid menu category" });
    }

    const numericPrice = Number(price);
    if (Number.isNaN(numericPrice) || numericPrice <= 0) {
      return res.status(400).json({ message: "Price must be a valid positive number" });
    }

    const imageList = Array.isArray(images)
      ? images.filter(Boolean)
      : typeof images === "string" && images.trim()
        ? [images.trim()]
        : [];

    if (imageList.length === 0) {
      return res.status(400).json({ message: "At least one item image is required" });
    }

    const { menuItemsCollection } = await getCollections();

    // Free plan check: max 3 non-rejected items
    if (req.user.subscriptionPlan !== "premium") {
      const activeCount = await menuItemsCollection.countDocuments({
        vendorId: req.user.id,
        status: { $in: ["pending", "approved"] },
      });

      if (activeCount >= FREE_PLAN_LIMIT) {
        return res.status(403).json({
          message:
            "Free plan allows a maximum of 3 active menu items. Upgrade to Premium for unlimited items.",
        });
      }
    }

    const newItem = {
      vendorId: req.user.id,
      itemName: itemName.trim(),
      category,
      description: description.trim(),
      price: numericPrice,
      location: location.trim(),
      images: imageList,
      status: "pending",
      createdAt: new Date(),
    };

    const result = await menuItemsCollection.insertOne(newItem);
    return res.status(201).json({
      message: "Menu item submitted for admin approval",
      item: { _id: result.insertedId, ...newItem },
    });
  } catch (err) {
    next(err);
  }
});

// 5. VENDOR: Update own menu item or toggle availability (approved <-> inactive)
router.patch("/:id", verifyJWT, requireRole("vendor"), async (req, res, next) => {
  try {
    const { id } = req.params;
    if (!ObjectId.isValid(id)) {
      return res.status(400).json({ message: "Invalid menu item ID" });
    }

    const { menuItemsCollection } = await getCollections();
    const existing = await menuItemsCollection.findOne({ _id: new ObjectId(id) });

    if (!existing) {
      return res.status(404).json({ message: "Menu item not found" });
    }
    // Ownership check: never trust the client, compare with the verified token user
    if (existing.vendorId !== req.user.id) {
      return res.status(403).json({ message: "Forbidden: you can only update your own items" });
    }

    const { itemName, category, description, price, location, images, status } = req.body;
    const updates = {};

    if (itemName !== undefined) {
      if (!String(itemName).trim()) {
        return res.status(400).json({ message: "Item name cannot be empty" });
      }
      updates.itemName = String(itemName).trim();
    }
    if (category !== undefined) {
      if (!MENU_CATEGORIES.includes(category)) {
        return res.status(400).json({ message: "Invalid category" });
      }
      updates.category = category;
    }
    if (description !== undefined) {
      if (!String(description).trim()) {
        return res.status(400).json({ message: "Description cannot be empty" });
      }
      updates.description = String(description).trim();
    }
    if (location !== undefined) {
      if (!String(location).trim()) {
        return res.status(400).json({ message: "Location cannot be empty" });
      }
      updates.location = String(location).trim();
    }
    if (price !== undefined) {
      const num = Number(price);
      if (Number.isNaN(num) || num <= 0) {
        return res.status(400).json({ message: "Invalid price" });
      }
      updates.price = num;
    }
    if (images !== undefined) {
      const list = Array.isArray(images) ? images.filter(Boolean) : [images].filter(Boolean);
      if (!list.length) {
        return res.status(400).json({ message: "At least one image is required" });
      }
      updates.images = list;
    }

    // Vendors may toggle approved <-> inactive, but cannot self-approve pending/rejected items
    if (status !== undefined) {
      const canToggle =
        (existing.status === "approved" && status === "inactive") ||
        (existing.status === "inactive" && status === "approved");

      if (!canToggle) {
        return res.status(403).json({
          message: "You can only toggle availability on admin-approved items",
        });
      }

      // Re-activating also counts against the Free plan limit
      if (status === "approved" && req.user.subscriptionPlan !== "premium") {
        const active = await menuItemsCollection.countDocuments({
          vendorId: req.user.id,
          status: { $in: ["pending", "approved"] },
        });
        if (active >= FREE_PLAN_LIMIT) {
          return res.status(403).json({
            message: "Free plan allows a maximum of 3 active menu items. Upgrade to Premium.",
          });
        }
      }

      updates.status = status;
    }

    if (Object.keys(updates).length === 0) {
      return res.status(400).json({ message: "Nothing to update" });
    }

    await menuItemsCollection.updateOne({ _id: new ObjectId(id) }, { $set: updates });
    const updated = await menuItemsCollection.findOne({ _id: new ObjectId(id) });

    return res.json({ message: "Menu item updated", item: updated });
  } catch (err) {
    next(err);
  }
});

// 6. VENDOR: Delete own menu item
router.delete("/:id", verifyJWT, requireRole("vendor"), async (req, res, next) => {
  try {
    const { id } = req.params;
    if (!ObjectId.isValid(id)) {
      return res.status(400).json({ message: "Invalid menu item ID" });
    }

    const { menuItemsCollection } = await getCollections();
    const existing = await menuItemsCollection.findOne({ _id: new ObjectId(id) });

    if (!existing) {
      return res.status(404).json({ message: "Menu item not found" });
    }
    if (existing.vendorId !== req.user.id) {
      return res.status(403).json({ message: "Forbidden: you can only delete your own items" });
    }

    await menuItemsCollection.deleteOne({ _id: new ObjectId(id) });
    return res.json({ message: "Menu item deleted" });
  } catch (err) {
    next(err);
  }
});

export default router;