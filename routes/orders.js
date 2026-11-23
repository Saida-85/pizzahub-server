import { Router } from "express";
import { ObjectId } from "mongodb";
import { getCollections } from "../config/db.js";
import { verifyJWT } from "../middleware/verifyJWT.js";
import { requireRole } from "../middleware/requireRole.js";

const router = Router();

// Helper to attach menu item, vendor, and customer info to orders
async function enrichOrders(orders, { menuItemsCollection, usersCollection }) {
  if (!orders.length) return [];

  const itemIds = [...new Set(orders.map((o) => String(o.itemId)).filter((id) => ObjectId.isValid(id)))].map(
    (id) => new ObjectId(id)
  );
  const userIds = [
    ...new Set(
      orders.flatMap((o) => [o.vendorId, o.customerId]).filter(Boolean).map(String)
    ),
  ];
  const userObjectIds = userIds.filter((id) => ObjectId.isValid(id)).map((id) => new ObjectId(id));

  const [items, users] = await Promise.all([
    itemIds.length
      ? menuItemsCollection.find({ _id: { $in: itemIds } }).toArray()
      : [],
    userIds.length
      ? usersCollection
          .find({
            $or: [
              ...(userObjectIds.length ? [{ _id: { $in: userObjectIds } }] : []),
              { id: { $in: userIds } },
            ],
          })
          .project({ name: 1, email: 1, businessName: 1, image: 1, id: 1 })
          .toArray()
      : [],
  ]);

  const itemMap = new Map(items.map((item) => [String(item._id), item]));
  const userMap = new Map();
  for (const u of users) {
    if (u._id) userMap.set(String(u._id), u);
    if (u.id) userMap.set(String(u.id), u);
  }

  return orders.map((order) => {
    const item = itemMap.get(String(order.itemId));
    const vendor = userMap.get(String(order.vendorId));
    const customer = userMap.get(String(order.customerId));

    return {
      ...order,
      item: item
        ? {
            _id: item._id,
            itemName: item.itemName,
            category: item.category,
            price: item.price,
            location: item.location,
            images: item.images || [],
            status: item.status,
          }
        : null,
      vendor: vendor
        ? {
            id: String(vendor._id || vendor.id),
            name: vendor.businessName || vendor.name || "Restaurant",
            ownerName: vendor.name || "",
            image: vendor.image || "",
          }
        : { id: order.vendorId, name: "Restaurant", ownerName: "", image: "" },
      customer: customer
        ? {
            id: String(customer._id || customer.id),
            name: customer.name || "Customer",
            email: customer.email || "",
            image: customer.image || "",
          }
        : { id: order.customerId, name: "Customer", email: "", image: "" },
    };
  });
}

// 1. CUSTOMER: Place a new order
router.post("/", verifyJWT, requireRole("customer"), async (req, res, next) => {
  try {
    const { itemId, deliveryDate, deliveryAddress, message = "" } = req.body;

    if (!itemId || !ObjectId.isValid(itemId)) {
      return res.status(400).json({ message: "Valid menu item ID is required" });
    }
    if (!deliveryDate || !String(deliveryDate).trim()) {
      return res.status(400).json({ message: "Delivery date is required" });
    }
    if (!deliveryAddress || !String(deliveryAddress).trim()) {
      return res.status(400).json({ message: "Delivery address is required" });
    }

    // Validate the delivery date on the server (YYYY-MM-DD, a real date, not in the past).
    // One day of tolerance covers the gap between UTC and the customer's local time.
    const dateText = String(deliveryDate).trim();
    const parsedDate = /^\d{4}-\d{2}-\d{2}$/.test(dateText)
      ? new Date(`${dateText}T00:00:00.000Z`)
      : null;
    if (!parsedDate || Number.isNaN(parsedDate.getTime())) {
      return res.status(400).json({ message: "Delivery date must be a valid date (YYYY-MM-DD)" });
    }
    const earliest = new Date();
    earliest.setUTCDate(earliest.getUTCDate() - 1);
    earliest.setUTCHours(0, 0, 0, 0);
    if (parsedDate < earliest) {
      return res.status(400).json({ message: "Delivery date cannot be in the past" });
    }

    const addressText = String(deliveryAddress).trim();
    if (addressText.length < 10 || addressText.length > 300) {
      return res
        .status(400)
        .json({ message: "Delivery address must be between 10 and 300 characters" });
    }
    if (String(message || "").length > 500) {
      return res.status(400).json({ message: "Message must be 500 characters or fewer" });
    }

    const { menuItemsCollection, ordersCollection } = await getCollections();
    const item = await menuItemsCollection.findOne({ _id: new ObjectId(itemId) });

    if (!item) {
      return res.status(404).json({ message: "Menu item not found" });
    }
    if (item.status !== "approved") {
      return res.status(400).json({ message: "Only approved and available items can be ordered" });
    }
    if (String(item.vendorId) === String(req.user.id)) {
      return res.status(403).json({ message: "You cannot order your own menu item" });
    }

    const normalizedDate = String(deliveryDate).trim();
    const duplicateOrder = await ordersCollection.findOne({
      customerId: req.user.id,
      itemId: String(item._id),
      deliveryDate: normalizedDate,
      status: { $in: ["pending", "accepted"] },
    });

    if (duplicateOrder) {
      return res.status(409).json({
        message: "You already have an active order for this item on that delivery date",
      });
    }

    const newOrder = {
      itemId: String(item._id),
      vendorId: String(item.vendorId),
      customerId: String(req.user.id),
      deliveryDate: normalizedDate,
      deliveryAddress: String(deliveryAddress).trim(),
      message: String(message || "").trim(),
      status: "pending",
      createdAt: new Date(),
    };

    const result = await ordersCollection.insertOne(newOrder);

    return res.status(201).json({
      message: "Order placed successfully",
      order: { _id: result.insertedId, ...newOrder },
    });
  } catch (err) {
    next(err);
  }
});

// 2. CUSTOMER: Get logged-in customer's orders
router.get("/my", verifyJWT, requireRole("customer"), async (req, res, next) => {
  try {
    const collections = await getCollections();
    const orders = await collections.ordersCollection
      .find({ customerId: req.user.id })
      .sort({ createdAt: -1 })
      .toArray();

    const enriched = await enrichOrders(orders, collections);
    return res.json({ orders: enriched });
  } catch (err) {
    next(err);
  }
});

// 3. CUSTOMER: Cancel own pending order only
router.patch("/:id/cancel", verifyJWT, requireRole("customer"), async (req, res, next) => {
  try {
    const { id } = req.params;
    if (!ObjectId.isValid(id)) {
      return res.status(400).json({ message: "Invalid order ID" });
    }

    const { ordersCollection } = await getCollections();
    const order = await ordersCollection.findOne({ _id: new ObjectId(id) });

    if (!order) {
      return res.status(404).json({ message: "Order not found" });
    }
    if (String(order.customerId) !== String(req.user.id)) {
      return res.status(403).json({ message: "Forbidden: you cannot modify another customer's order" });
    }
    if (order.status !== "pending") {
      return res.status(400).json({
        message: `Cannot cancel an order that is already ${order.status}`,
      });
    }

    await ordersCollection.updateOne(
      { _id: new ObjectId(id) },
      { $set: { status: "cancelled", statusUpdatedAt: new Date() } }
    );

    return res.json({ message: "Order cancelled successfully" });
  } catch (err) {
    next(err);
  }
});

// 4. VENDOR: Get orders for the logged-in vendor's items
router.get("/vendor", verifyJWT, requireRole("vendor"), async (req, res, next) => {
  try {
    const collections = await getCollections();
    const orders = await collections.ordersCollection
      .find({ vendorId: req.user.id })
      .sort({ createdAt: -1 })
      .toArray();

    const enriched = await enrichOrders(orders, collections);
    return res.json({ orders: enriched });
  } catch (err) {
    next(err);
  }
});

// 5. VENDOR: Accept or reject a pending order (once)
router.patch("/:id/status", verifyJWT, requireRole("vendor"), async (req, res, next) => {
  try {
    const { id } = req.params;
    const { status } = req.body;

    if (!ObjectId.isValid(id)) {
      return res.status(400).json({ message: "Invalid order ID" });
    }
    if (!["accepted", "rejected"].includes(status)) {
      return res.status(400).json({ message: "Status must be either 'accepted' or 'rejected'" });
    }

    const { ordersCollection } = await getCollections();
    const order = await ordersCollection.findOne({ _id: new ObjectId(id) });

    if (!order) {
      return res.status(404).json({ message: "Order not found" });
    }
    if (String(order.vendorId) !== String(req.user.id)) {
      return res.status(403).json({ message: "Forbidden: you cannot modify another vendor's order" });
    }
    if (order.status !== "pending") {
      return res.status(400).json({
        message: `Order has already been ${order.status} and cannot be changed again`,
      });
    }

    await ordersCollection.updateOne(
      { _id: new ObjectId(id) },
      { $set: { status, statusUpdatedAt: new Date() } }
    );

    return res.json({ message: `Order ${status}`, status });
  } catch (err) {
    next(err);
  }
});

export default router;