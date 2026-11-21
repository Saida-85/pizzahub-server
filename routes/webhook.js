import { Router, raw } from "express";
import Stripe from "stripe";
import { ObjectId } from "mongodb";
import dotenv from "dotenv";
import { getCollections } from "../config/db.js";

dotenv.config();

const router = Router();
const stripe = new Stripe(process.env.STRIPE_SECRET_KEY);

// POST /api/webhook — Stripe webhook endpoint (raw body required)
router.post("/", raw({ type: "application/json" }), async (req, res) => {
  const sig = req.headers["stripe-signature"];

  if (!process.env.STRIPE_WEBHOOK_SECRET) {
    console.error("Missing STRIPE_WEBHOOK_SECRET");
    return res.status(500).send("Webhook secret not configured");
  }

  let event;
  try {
    event = stripe.webhooks.constructEvent(
      req.body,
      sig,
      process.env.STRIPE_WEBHOOK_SECRET
    );
  } catch (err) {
    console.error("Webhook signature verification failed:", err.message);
    return res.status(400).send(`Webhook Error: ${err.message}`);
  }

  try {
    const { usersCollection, transactionsCollection } = await getCollections();

    if (event.type === "checkout.session.completed") {
      const session = event.data.object;
      const vendorId = session.metadata?.vendorId;
      const plan = session.metadata?.plan || "premium";

      if (vendorId && session.payment_status === "paid") {
        // Prevent duplicate transaction records if Stripe retries the event
        const existingTx = await transactionsCollection.findOne({
          stripeSessionId: session.id,
        });

        if (!existingTx) {
          const amount =
            typeof session.amount_total === "number" ? session.amount_total / 100 : 0;

          await transactionsCollection.insertOne({
            vendorId: String(vendorId),
            plan,
            amount,
            currency: (session.currency || "usd").toLowerCase(),
            stripeSessionId: session.id,
            stripeSubscriptionId: session.subscription ? String(session.subscription) : null,
            status: "succeeded",
            createdAt: new Date(),
          });
        }

        const expiresAt = new Date();
        expiresAt.setDate(expiresAt.getDate() + 30);

        const userFilter = ObjectId.isValid(vendorId)
          ? { $or: [{ _id: new ObjectId(vendorId) }, { id: vendorId }] }
          : { $or: [{ id: vendorId }, { _id: vendorId }] };

        await usersCollection.updateOne(userFilter, {
          $set: {
            subscriptionPlan: "premium",
            subscriptionExpiresAt: expiresAt,
          },
        });
      }
    }

    return res.status(200).json({ received: true });
  } catch (err) {
    console.error("Error handling Stripe webhook:", err);
    return res.status(500).json({ message: "Webhook handler failed" });
  }
});

export default router;