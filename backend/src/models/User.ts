import mongoose, { Schema, Document } from "mongoose";

export interface IUser extends Document {
  uid: string;
  email: string;
  name: string;
  photoURL?: string;
  role: "admin" | "user";
  createdAt: Date;
  lastLoginAt: Date;
}

const UserSchema = new Schema<IUser>(
  {
    uid: { type: String, required: true, unique: true },
    email: { type: String, required: true },
    name: { type: String, required: true },
    photoURL: { type: String },
    role: { type: String, enum: ["admin", "user"], default: "user" },
    lastLoginAt: { type: Date, default: Date.now },
  },
  { timestamps: true },
);

UserSchema.index({ email: 1 });

export const User = mongoose.model<IUser>("User", UserSchema);
