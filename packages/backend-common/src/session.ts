import jwt from "jsonwebtoken";
import { JWT_SECRET } from "./secrets";

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
