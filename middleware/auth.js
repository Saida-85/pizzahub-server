import { betterAuth } from "better-auth";
import { mongodbAdapter } from "@better-auth/mongo-adapter";
import { getCollections } from "./config/db.js";
import dotenv from "dotenv";

dotenv.config();

const { db, usersCollection } = await getCollections();

export const auth = betterAuth({
  baseURL: process.env.BETTER_AUTH_URL || "http://localhost:5000",
  secret: process.env.BETTER_AUTH_SECRET,
  trustedOrigins: [process.env.CLIENT_URL || "http://localhost:3000"],
  emailAndPassword: {
    enabled: true,
  },
  socialProviders: {
    google: {
      clientId: process.env.GOOGLE_CLIENT_ID,
      clientSecret: process.env.GOOGLE_CLIENT_SECRET,
    },
  },
  user: {
    additionalFields: {
      role: {
        type: "string",
        required: false,
        defaultValue: "customer",
      },
      isBlocked: {
        type: "boolean",
        required: false,
        defaultValue: false,
      },
      businessName: {
        type: "string",
        required: false,
        defaultValue: "",
      },
      subscriptionPlan: {
        type: "string",
        required: false,
        defaultValue: "free",
      },
      subscriptionExpiresAt: {
        type: "date",
        required: false,
        defaultValue: null,
      },
    },
  },
  database: mongodbAdapter(db),
});

export { usersCollection };