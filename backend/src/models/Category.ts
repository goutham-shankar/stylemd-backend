import mongoose, { Schema, Document } from "mongoose";

export interface ICategory extends Document {
  name: string;
  createdAt: Date;
}

const CategorySchema = new Schema<ICategory>(
  {
    name: { type: String, required: true, unique: true, trim: true },
  },
  { timestamps: true },
);

export const Category = mongoose.model<ICategory>("Category", CategorySchema);
