import { MongoClient } from "mongodb";
import dotenv from "dotenv";

dotenv.config();

const uri = process.env.MONGODB_URI;

if (!uri) {
  throw new Error("Please define MONGODB_URI in your .env file");
}

const client = new MongoClient(uri);
let dbInstance = null;

export async function connectDB() {
  if (dbInstance) return dbInstance;

  await client.connect();
  dbInstance = client.db(process.env.DB_NAME || "pizzahubdb");
  console.log("MongoDB connected successfully");
  return dbInstance;
}

export async function getCollections() {
  const db = await connectDB();

  return {
    db,
    usersCollection: db.collection("user"),
    menuItemsCollection: db.collection("menuItems"),
    ordersCollection: db.collection("orders"),
    transactionsCollection: db.collection("transactions"),
  };
}