import { Router } from "express";
import Stripe from "stripe";
import dotenv from "dotenv";
import { verifyJWT } from "../middleware/verifyJWT.js";
import { requireRole } from "../middleware/requireRole.js";

dotenv.config();

const router = Router();
const stripe = new Stripe(process.env.STRIPE_SECRET_KEY);

// POST /api/payments/create-checkout-session — Vendor upgrades own account to Premium
router.post(
  "/create-checkout-session",
  verifyJWT,
  requireRole("vendor"),
  async (req, res, next) => {
    try {
      if (!process.env.STRIPE_SECRET_KEY) {
        return res.status(500).json({ message: "Stripe secret key is not configured" });
      }

      if (req.user.subscriptionPlan === "premium") {
        return res.status(400).json({ message: "Your account is already on the Premium plan" });
      }

      const clientUrl = process.env.CLIENT_URL || "http://localhost:3000";

      // Use STRIPE_PREMIUM_PRICE_ID if set, otherwise create an inline price in BDT/USD
      const lineItems = process.env.STRIPE_PREMIUM_PRICE_ID
        ? [
            {
              price: process.env.STRIPE_PREMIUM_PRICE_ID,
              quantity: 1,
            },
          ]
        : [
            {
              price_data: {
                currency: "usd",
                product_data: {
                  name: "PizzaHub Vendor Premium Subscription",
                  description:
                    "Unlimited menu items, Premium vendor badge, and featured menu placement",
                },
                unit_amount: 1900, // $19.00
              },
              quantity: 1,
            },
          ];

      const session = await stripe.checkout.sessions.create({
        mode: "payment",
        customer_email: req.user.email,
        line_items: lineItems,
        metadata: {
          vendorId: String(req.user.id),
          plan: "premium",
        },
        success_url: `${clientUrl}/payment/success?session_id={CHECKOUT_SESSION_ID}`,
        cancel_url: `${clientUrl}/payment/cancel`,
      });

      return res.status(200).json({
        url: session.url,
        sessionId: session.id,
      });
    } catch (err) {
      next(err);
    }
  }
);

export default router;