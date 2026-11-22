import { Router, raw } from "express";
import Stripe from "stripe";
import { ObjectId } from "mongodb";
import { getCollections } from "../config/db.js";

const router = Router();
const stripe = new Stripe(process.env.STRIPE_SECRET_KEY);

const PREMIUM_DAYS = 30;

function userFilter(vendorId) {
  return ObjectId.isValid(vendorId)
    ? { $or: [{ _id: new ObjectId(vendorId) }, { id: vendorId }] }
    : { $or: [{ id: vendorId }, { _id: vendorId }] };
}

function buildTransaction(session, status) {
  return {
    vendorId: String(session.metadata?.vendorId),
    plan: session.metadata?.plan || "premium",
    amount: typeof session.amount_total === "number" ? session.amount_total / 100 : 0,
    currency: (session.currency || "usd").toLowerCase(),
    stripeSessionId: session.id,
    stripeSubscriptionId: session.subscription ? String(session.subscription) : null,
    status,
    createdAt: new Date(),
  };
}

// Records an unsuccessful payment, but never overwrites a paid one.
async function recordFailed(transactionsCollection, session) {
  if (!session.metadata?.vendorId) return;
  const existing = await transactionsCollection.findOne({ stripeSessionId: session.id });
  if (existing) return;
  await transactionsCollection.insertOne(buildTransaction(session, "failed"));
}

// POST /api/webhook: Stripe webhook endpoint (raw body required)
router.post("/", raw({ type: "application/json" }), async (req, res) => {
  const sig = req.headers["stripe-signature"];

  if (!process.env.STRIPE_WEBHOOK_SECRET) {
    console.error("Missing STRIPE_WEBHOOK_SECRET");
    return res.status(500).send("Webhook secret not configured");
  }

  let event;
  try {
    event = stripe.webhooks.constructEvent(req.body, sig, process.env.STRIPE_WEBHOOK_SECRET);
  } catch (err) {
    console.error("Webhook signature verification failed:", err.message);
    return res.status(400).send(`Webhook Error: ${err.message}`);
  }

  try {
    const { usersCollection, transactionsCollection } = await getCollections();
    const session = event.data.object;

    switch (event.type) {
      case "checkout.session.completed": {
        const vendorId = session.metadata?.vendorId;
        // Only a verified, paid session may activate Premium.
        if (!vendorId || session.payment_status !== "paid") break;

        const existing = await transactionsCollection.findOne({ stripeSessionId: session.id });
        if (existing?.status === "succeeded") break; // Stripe retry: already processed

        if (existing) {
          await transactionsCollection.updateOne(
            { _id: existing._id },
            { $set: { status: "succeeded" } }
          );
        } else {
          await transactionsCollection.insertOne(buildTransaction(session, "succeeded"));
        }

        // Extend from the current expiry if the vendor is still Premium.
        const vendor = await usersCollection.findOne(userFilter(vendorId));
        const now = new Date();
        const current = vendor?.subscriptionExpiresAt ? new Date(vendor.subscriptionExpiresAt) : null;
        const base = current && current > now ? current : now;
        const expiresAt = new Date(base);
        expiresAt.setDate(expiresAt.getDate() + PREMIUM_DAYS);

        await usersCollection.updateOne(userFilter(vendorId), {
          $set: { subscriptionPlan: "premium", subscriptionExpiresAt: expiresAt },
        });
        break;
      }

      case "checkout.session.async_payment_failed":
      case "checkout.session.expired":
        await recordFailed(transactionsCollection, session);
        break;

      default:
        // Other events are acknowledged and ignored.
        break;
    }

    return res.status(200).json({ received: true });
  } catch (err) {
    console.error("Error handling Stripe webhook:", err);
    return res.status(500).json({ message: "Webhook handler failed" });
  }
});

export default router;