/**
 * Auth & roles (DESIGN.md §2.7).
 *
 * Email/password → JWT (stateless). Roles: admin > editor > viewer.
 * Configuration API is role-checked; mock listeners are public (Mockoon parity).
 */
import { NextFunction, Request, Response } from 'express';
import jwt from 'jsonwebtoken';
import bcrypt from 'bcryptjs';
import { User, UserRole } from './lib/types';

export interface AuthConfig {
  enabled: boolean;
  secret: string;
}

export interface JwtPayload {
  email: string;
  role: UserRole;
}

export function signToken(payload: JwtPayload, secret: string, ttlSeconds = 8 * 3600): string {
  return jwt.sign(payload, secret, { expiresIn: ttlSeconds });
}

export function verifyToken(token: string, secret: string): JwtPayload | null {
  try {
    const decoded = jwt.verify(token, secret) as jwt.JwtPayload;
    if (typeof decoded.email !== 'string' || typeof decoded.role !== 'string') return null;
    return { email: decoded.email, role: decoded.role as UserRole };
  } catch {
    return null;
  }
}

export async function hashPassword(password: string): Promise<string> {
  return bcrypt.hash(password, 10);
}

export async function verifyPassword(password: string, hash: string): Promise<boolean> {
  return bcrypt.compare(password, hash);
}

const ROLE_RANK: Record<UserRole, number> = { viewer: 0, editor: 1, admin: 2 };

export function hasRole(userRole: UserRole | undefined, required: UserRole): boolean {
  return userRole !== undefined && ROLE_RANK[userRole] >= ROLE_RANK[required];
}

/**
 * Attach the authenticated user to req.user when auth is enabled.
 * When disabled (dev shortcut), a synthetic admin is attached.
 */
export function authMiddleware(cfg: AuthConfig, secret: string) {
  return (req: Request, res: Response, next: NextFunction) => {
    if (!cfg.enabled) {
      req.user = { email: 'dev@local', role: 'admin' as UserRole };
      return next();
    }
    const header = req.headers.authorization;
    if (!header || !header.startsWith('Bearer ')) {
      res.status(401).json({ error: 'Authentication required' });
      return;
    }
    const payload = verifyToken(header.slice(7), secret);
    if (!payload) {
      res.status(401).json({ error: 'Invalid or expired token' });
      return;
    }
    req.user = payload;
    next();
  };
}

/** Require a minimum role; 403 below it. */
export function requireRole(required: UserRole) {
  return (req: Request, res: Response, next: NextFunction) => {
    if (!hasRole(req.user?.role, required)) {
      res.status(403).json({ error: `Requires ${required} role` });
      return;
    }
    next();
  };
}

/**
 * Strict CORS for /api (§2.15): only allowlisted origins, credentials true,
 * never *. Same-origin requests (no Origin header) pass through.
 */
export function apiCors(allowedOrigins: string[]) {
  return (req: Request, res: Response, next: NextFunction) => {
    const origin = req.headers.origin;
    if (origin && allowedOrigins.includes(origin)) {
      res.setHeader('Access-Control-Allow-Origin', origin);
      res.setHeader('Access-Control-Allow-Credentials', 'true');
      res.setHeader('Access-Control-Allow-Methods', 'GET, POST, PUT, DELETE, OPTIONS');
      res.setHeader('Access-Control-Allow-Headers', 'Content-Type, Authorization');
    }
    if (req.method === 'OPTIONS') {
      res.status(204).end();
      return;
    }
    next();
  };
}

declare module 'express-serve-static-core' {
  interface Request {
    user?: { email: string; role: UserRole };
  }
}

export type { User };
