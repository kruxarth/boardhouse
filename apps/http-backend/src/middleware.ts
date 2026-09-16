import type { NextFunction, Request, Response } from "express";
import jwt from "jsonwebtoken";
import { JWT_SECRET } from "@repo/backend-common/config";

declare global {
    namespace Express {
        interface Request {
            participantId?: string;
            participantName?: string;
        }
    }
}

export type SessionClaims = {
    sub: string;
    name: string;
};

export function readSessionToken(token: string): SessionClaims | null {
    try {
        const decoded = jwt.verify(token, JWT_SECRET);
        if (
            typeof decoded === "string" ||
            typeof decoded.sub !== "string" ||
            typeof decoded.name !== "string"
        ) {
            return null;
        }
        return { sub: decoded.sub, name: decoded.name };
    } catch {
        return null;
    }
}

export function middleware(req: Request, res: Response, next: NextFunction) {
    const token = req.headers.authorization?.split(" ")[1];

    if (!token) {
        return res.status(401).json({ message: "Unauthorized" });
    }

    const session = readSessionToken(token);
    if (!session) {
        return res.status(401).json({ message: "Unauthorized" });
    }

    req.participantId = session.sub;
    req.participantName = session.name;
    next();
}
