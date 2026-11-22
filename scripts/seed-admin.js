import "dotenv/config";
import { MongoClient } from "mongodb";

const email = (process.env.ADMIN_EMAIL || process.argv[2] || "").trim().toLowerCase();

if (!email) {
  console.error("Usage: npm run seed:admin -- admin@example.com");
  console.error("Or set ADMIN_EMAIL in .env");
  process.exit(1);
}
if (!process.env.MONGODB_URI) {
  console.error("MONGODB_URI is missing from .env");
  process.exit(1);
}

const client = new MongoClient(process.env.MONGODB_URI);

try {
  await client.connect();
  const db = client.db(process.env.DB_NAME || "pizzahubdb");
  const users = db.collection("user");

  const user = await users.findOne({ email });
  if (!user) {
    console.error(`No account found for ${email}.`);
    console.error("Sign up with this email on the website first, then run this script again.");
    process.exit(1);
  }

  await users.updateOne(
    { _id: user._id },
    { $set: { role: "admin", isBlocked: false, updatedAt: new Date() } }
  );
  console.log(`Done: ${email} is now an admin. Log out and log in again to use it.`);
} catch (err) {
  console.error("Seed failed:", err.message);
  process.exitCode = 1;
} finally {
  await client.close();
}