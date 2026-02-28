import crypto from "node:crypto";
import { TextEncoder } from "node:util";
import bs58 from "bs58";
import jwt from "jsonwebtoken";
import nacl from "tweetnacl";
import type { Request, Response, NextFunction } from "express";
import { createOrTouchUser, getUsage, getUserById } from "./db.js";

const JWT_SECRET = process.env.ENIGMA_JWT_SECRET || "dev-secret-change-in-production";
if (process.env.NODE_ENV === "production" && JWT_SECRET === "dev-secret-change-in-production") {
  throw new Error("ENIGMA_JWT_SECRET must be set in production.");
}

export interface AuthUser {
  id: number;
  wallet: string;
  plan: "free" | "pro";
}

export interface AuthedRequest extends Request {
  user?: AuthUser;
}

export function generateNonce(): string {
  return crypto.randomBytes(24).toString("hex");
}

export function verifyWalletSignature(wallet: string, nonce: string, signature: string): boolean {
  try {
    const publicKey = bs58.decode(wallet);
    let sig: Uint8Array;
    try {
      sig = bs58.decode(signature);
    } catch {
      sig = Buffer.from(signature, "base64");
    }
    const message = new TextEncoder().encode(`KOBECOIN login nonce: ${nonce}`);
    return nacl.sign.detached.verify(message, sig, publicKey);
  } catch {
    return false;
  }
}

export function issueToken(user: AuthUser): string {
  return jwt.sign({ sub: user.id, wallet: user.wallet, plan: user.plan }, JWT_SECRET, {
    expiresIn: "7d"
  });
}

export function authRequired(req: AuthedRequest, res: Response, next: NextFunction): void {
  try {
    const authHeader = req.headers.authorization || "";
    const token = authHeader.startsWith("Bearer ") ? authHeader.slice(7) : "";
    if (!token) {
      res.status(401).json({ error: "missing auth token" });
      return;
    }

    const payload = jwt.verify(token, JWT_SECRET) as unknown as {
      sub: number | string;
      wallet: string;
      plan: "free" | "pro";
    };
    if (!payload || !payload.sub || !payload.wallet || !payload.plan) {
      res.status(401).json({ error: "invalid token payload" });
      return;
    }

    req.user = {
      id: Number(payload.sub),
      wallet: payload.wallet,
      plan: payload.plan
    };

    const current = getUserById(req.user.id);
    if (current) {
      req.user.plan = current.plan;
      req.user.wallet = current.wallet;
    }

    next();
  } catch {
    res.status(401).json({ error: "invalid token" });
  }
}

function planLimits(plan: "free" | "pro") {
  if (plan === "pro") {
    return { signal_calls: 2500, chat_calls: 5000 };
  }

  return { signal_calls: 120, chat_calls: 300 };
}

export function enforceQuota(kind: "signal_calls" | "chat_calls") {
  return (req: AuthedRequest, res: Response, next: NextFunction): void => {
    const user = req.user;
    if (!user) {
      res.status(401).json({ error: "unauthorized" });
      return;
    }

    const limits = planLimits(user.plan);
    const usage = getUsage(user.id);

    if (usage[kind] >= limits[kind]) {
      res.status(429).json({
        error: `quota exceeded for ${kind}`,
        usage,
        limit: limits[kind],
        hint: "upgrade plan or wait for daily reset"
      });
      return;
    }

    next();
  };
}

export function hydrateUser(wallet: string): AuthUser {
  const user = createOrTouchUser(wallet);
  return {
    id: user.id,
    wallet: user.wallet,
    plan: user.plan
  };
}
