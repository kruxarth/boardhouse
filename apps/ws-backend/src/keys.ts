import { timingSafeEqual } from "crypto";

export function keysMatch(provided: string, expected: string) {
    const left = Buffer.from(provided);
    const right = Buffer.from(expected);
    if (left.length !== right.length) {
        return false;
    }
    return timingSafeEqual(left, right);
}
