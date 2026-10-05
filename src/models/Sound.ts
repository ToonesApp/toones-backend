import mongoose, { type HydratedDocument, type Model, type Types } from "mongoose";

const { Schema, model, models } = mongoose;

export const soundCategories = ["nature", "language", "culture", "music", "city"] as const;

export type SoundCategory = (typeof soundCategories)[number];

export interface GeoPoint {
  type: "Point";
  coordinates: [number, number];
}

export interface Sound {
  userId: Types.ObjectId;
  title: string;
  description?: string;
  audioUrl: string;
  durationSec: number;
  category: SoundCategory;
  tags: string[];
  location: GeoPoint;
  placeName?: string;
  playCount: number;
  createdAt: Date;
  updatedAt: Date;
}

export type SoundDocument = HydratedDocument<Sound>;

const pointSchema = new Schema<GeoPoint>(
  {
    type: {
      type: String,
      enum: ["Point"],
      required: true,
      default: "Point"
    },
    // GeoJSON order is [longitude, latitude].
    coordinates: {
      type: [Number],
      required: true,
      validate: {
        validator: (value: number[]) =>
          value.length === 2 &&
          value[0] >= -180 &&
          value[0] <= 180 &&
          value[1] >= -90 &&
          value[1] <= 90,
        message: "coordinates must be [lng, lat] within valid ranges."
      }
    }
  },
  { _id: false }
);

const soundSchema = new Schema<Sound>(
  {
    userId: {
      type: Schema.Types.ObjectId,
      ref: "User",
      required: true
    },
    title: {
      type: String,
      required: true,
      trim: true,
      maxlength: 80
    },
    description: {
      type: String,
      trim: true,
      maxlength: 280
    },
    audioUrl: {
      type: String,
      required: true,
      trim: true
    },
    durationSec: {
      type: Number,
      required: true,
      min: 1,
      max: 60
    },
    category: {
      type: String,
      enum: soundCategories,
      required: true
    },
    tags: {
      type: [String],
      default: [],
      set: (values: string[]) => values.map((tag) => tag.trim().toLowerCase()).filter(Boolean)
    },
    location: {
      type: pointSchema,
      required: true
    },
    placeName: {
      type: String,
      trim: true,
      maxlength: 120
    },
    playCount: {
      type: Number,
      default: 0,
      min: 0
    }
  },
  { timestamps: true }
);

soundSchema.index({ location: "2dsphere" });
soundSchema.index({ category: 1, createdAt: -1 });
soundSchema.index({ tags: 1 });
soundSchema.index({ userId: 1, createdAt: -1 });
soundSchema.index({ createdAt: -1 });

export const SoundModel =
  (models.Sound as Model<Sound> | undefined) ?? model<Sound>("Sound", soundSchema);
