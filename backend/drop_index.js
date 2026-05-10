import mongoose from "mongoose";

async function run() {
  await mongoose.connect(process.env.MONGO_URI || "mongodb://localhost:27017/stylemd");
  try {
    await mongoose.connection.collection("stylemd_runs").dropIndex("url_1");
    console.log("Dropped url_1 index");
  } catch (err) {
    console.log("Error dropping url_1 index:", err.message);
  }
  
  try {
    await mongoose.connection.collection("stylemd_runs").dropIndex("slug_1");
    console.log("Dropped slug_1 index");
  } catch (err) {
    console.log("Error dropping slug_1 index:", err.message);
  }
  process.exit(0);
}

run();
