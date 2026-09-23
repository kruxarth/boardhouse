import type { NextFunction, Request, Response } from "express";
import { readSessionToken } from "@repo/backend-common/config";

declare global {
    namespace Express {
        interface Request {
            participantId?: string;
            participantName?: string;
        }
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
