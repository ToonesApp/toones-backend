import { Router, type Response } from "express";
import mongoose from "mongoose";

import { isMongoConnected } from "../db/connect.js";
import { plainLook } from "../lib/look.js";
import { commentLimiter, commentsReadLimiter } from "../middleware/rateLimit.js";
import { optionalAuth, requireAuth } from "../middleware/requireAuth.js";
import { CommentModel, MAX_COMMENT_LENGTH } from "../models/Comment.js";
import { SoundModel } from "../models/Sound.js";
import { UserModel } from "../models/User.js";

const router = Router();

const defaultCommentsLimit = 50;
const maxCommentsLimit = 100;

type CommentLean = {
  _id: mongoose.Types.ObjectId;
  soundId: mongoose.Types.ObjectId;
  userId: mongoose.Types.ObjectId;
  text: string;
  createdAt: Date;
};

function ensureMongo(res: Response): boolean {
  if (isMongoConnected()) {
    return true;
  }

  res.status(503).json({ error: "Database is not connected." });
  return false;
}

/** Parses `:id` (and `:commentId` when present); answers 404 and returns null when either isn't a valid id. */
function ids(params: Record<string, string>, res: Response) {
  const { id, commentId } = params;

  if (!mongoose.isValidObjectId(id) || (commentId !== undefined && !mongoose.isValidObjectId(commentId))) {
    res.status(404).json({ error: commentId === undefined ? "Sound not found." : "Comment not found." });
    return null;
  }

  return {
    soundId: new mongoose.Types.ObjectId(id),
    commentId: commentId === undefined ? null : new mongoose.Types.ObjectId(commentId)
  };
}

/** The comment as the client sees it. `canDelete` is true for the comment's author and for the sound's owner. */
async function publicComments(comments: CommentLean[], me: string | undefined, soundOwner: string) {
  const users = await UserModel.find({ _id: { $in: comments.map((c) => c.userId) } }, "username displayName look").lean();
  const byId = new Map(users.map((user) => [user._id.toString(), user]));

  return comments.map((comment) => {
    const authorId = comment.userId.toString();
    const author = byId.get(authorId);

    return {
      id: comment._id.toString(),
      text: comment.text,
      createdAt: comment.createdAt.toISOString(),
      // Deleted accounts take their comments with them, so a missing author is only a brief race.
      author: author
        ? { id: authorId, username: author.username, displayName: author.displayName, look: author.look ? plainLook(author.look) : null }
        : null,
      mine: me === authorId,
      canDelete: !!me && (me === authorId || me === soundOwner)
    };
  });
}

/**
 * A sound's comments, newest first. Public; a bearer token adds `mine` / `canDelete` flags.
 * Optional query: `limit` (max 100) and `before` (ISO date cursor from `nextBefore`).
 */
router.get("/:id/comments", commentsReadLimiter, optionalAuth, async (req, res) => {
  if (!ensureMongo(res)) {
    return;
  }

  const parsed = ids(req.params, res);

  if (!parsed) {
    return;
  }

  const filter: Record<string, unknown> = { soundId: parsed.soundId };
  const before = new Date(typeof req.query.before === "string" ? req.query.before : "");

  if (!Number.isNaN(before.getTime())) {
    filter.createdAt = { $lt: before };
  }

  const requested = Number(req.query.limit);
  const limit = Number.isFinite(requested) ? Math.min(Math.max(Math.floor(requested), 1), maxCommentsLimit) : defaultCommentsLimit;

  try {
    const sound = await SoundModel.findById(parsed.soundId, "userId commentCount").lean();

    if (!sound) {
      res.status(404).json({ error: "Sound not found." });
      return;
    }

    const comments = (await CommentModel.find(filter).sort({ createdAt: -1 }).limit(limit).lean()) as unknown as CommentLean[];
    const last = comments[comments.length - 1];

    res.status(200).json({
      comments: await publicComments(comments, req.auth?.userId, sound.userId.toString()),
      commentCount: sound.commentCount ?? 0,
      nextBefore: comments.length === limit && last ? last.createdAt.toISOString() : null
    });
  } catch {
    res.status(500).json({ error: "Could not load comments." });
  }
});

/** Add a comment (1-280 characters after trimming). Returns the new comment and the updated count. */
router.post("/:id/comments", commentLimiter, requireAuth, async (req, res) => {
  if (!ensureMongo(res)) {
    return;
  }

  const parsed = ids(req.params, res);

  if (!parsed) {
    return;
  }

  const raw = (req.body as { text?: unknown } | undefined)?.text;
  const text = typeof raw === "string" ? raw.trim() : "";

  if (!text) {
    res.status(400).json({ error: "Write something first." });
    return;
  }

  if (text.length > MAX_COMMENT_LENGTH) {
    res.status(400).json({ error: `Comments can be at most ${MAX_COMMENT_LENGTH} characters.` });
    return;
  }

  try {
    const sound = await SoundModel.findById(parsed.soundId, "userId commentCount").lean();

    if (!sound) {
      res.status(404).json({ error: "Sound not found." });
      return;
    }

    const me = req.auth?.userId as string;
    const created = await CommentModel.create({ soundId: parsed.soundId, userId: new mongoose.Types.ObjectId(me), text });
    const updated = await SoundModel.findByIdAndUpdate(parsed.soundId, { $inc: { commentCount: 1 } }, { new: true, projection: "commentCount" }).lean();
    const [comment] = await publicComments([created.toObject() as unknown as CommentLean], me, sound.userId.toString());

    res.status(201).json({ comment, commentCount: updated?.commentCount ?? (sound.commentCount ?? 0) + 1 });
  } catch {
    res.status(500).json({ error: "Could not post your comment." });
  }
});

/** Delete a comment. Allowed for its author and for the owner of the sound it's on. */
router.delete("/:id/comments/:commentId", commentLimiter, requireAuth, async (req, res) => {
  if (!ensureMongo(res)) {
    return;
  }

  const parsed = ids(req.params, res);

  if (!parsed?.commentId) {
    return;
  }

  try {
    const [sound, comment] = await Promise.all([
      SoundModel.findById(parsed.soundId, "userId").lean(),
      CommentModel.findOne({ _id: parsed.commentId, soundId: parsed.soundId }, "userId").lean()
    ]);

    if (!sound || !comment) {
      res.status(404).json({ error: "Comment not found." });
      return;
    }

    const me = req.auth?.userId;

    if (me !== comment.userId.toString() && me !== sound.userId.toString()) {
      res.status(403).json({ error: "You can only delete your own comments." });
      return;
    }

    const { deletedCount } = await CommentModel.deleteOne({ _id: parsed.commentId });
    let commentCount: number | undefined;

    if (deletedCount > 0) {
      const updated = await SoundModel.findOneAndUpdate(
        { _id: parsed.soundId, commentCount: { $gt: 0 } },
        { $inc: { commentCount: -1 } },
        { new: true, projection: "commentCount" }
      ).lean();
      commentCount = updated?.commentCount ?? 0;
    } else {
      commentCount = (await SoundModel.findById(parsed.soundId, "commentCount").lean())?.commentCount ?? 0;
    }

    res.status(200).json({ deleted: true, commentCount });
  } catch {
    res.status(500).json({ error: "Could not delete the comment." });
  }
});

export default router;
