import { Router } from "express";
import { ObjectId } from "mongodb";
import { getCollections } from "../config/db.js";
import { verifyJWT } from "../middleware/verifyJWT.js";
import { requireRole } from "../middleware/requireRole.js";

const router = Router();

// GET /api/vendor/overview — Vendor dashboard summary stats
router.get("/overview", verifyJWT, requireRole("vendor"), async (req, res, next) => {
  try {
    const { menuItemsCollection, ordersCollection } = await getCollections();
    const vendorId = String(req.user.id);

    const [totalMenuItems, activeMenuItems, pendingOrders, acceptedOrders] =
      await Promise.all([
        menuItemsCollection.countDocuments({ vendorId }),
        menuItemsCollection.countDocuments({ vendorId, status: "approved" }),
        ordersCollection.countDocuments({ vendorId, status: "pending" }),
        ordersCollection.countDocuments({ vendorId, status: "accepted" }),
      ]);

    return res.json({
      stats: {
        totalMenuItems,
        activeMenuItems,
        pendingOrders,
        acceptedOrders,
        subscriptionPlan: req.user.subscriptionPlan || "free",
        subscriptionExpiresAt: req.user.subscriptionExpiresAt || null,
      },
    });
  } catch (err) {
    next(err);
  }
});

// PATCH /api/vendor/profile — Update editable vendor profile fields only
router.patch("/profile", verifyJWT, requireRole("vendor"), async (req, res, next) => {
  try {
    const { name, image, businessName } = req.body;
    const updates = {};

    if (name !== undefined) {
      if (!String(name).trim()) {
        return res.status(400).json({ message: "Name cannot be empty" });
      }
      updates.name = String(name).trim();
    }
    if (image !== undefined) {
      updates.image = String(image).trim();
    }
    if (businessName !== undefined) {
      updates.businessName = String(businessName).trim();
    }

    if (Object.keys(updates).length === 0) {
      return res.status(400).json({ message: "No valid profile fields provided" });
    }

    const { usersCollection } = await getCollections();
    const filter = ObjectId.isValid(req.user.id)
      ? { $or: [{ _id: new ObjectId(req.user.id) }, { id: req.user.id }] }
      : { $or: [{ id: req.user.id }, { _id: req.user.id }] };

    await usersCollection.updateOne(filter, { $set: updates });
    const updatedUser = await usersCollection.findOne(filter, {
      projection: { password: 0 },
    });

    return res.json({
      message: "Vendor profile updated",
      user: updatedUser,
    });
  } catch (err) {
    next(err);
  }
});

export default router;