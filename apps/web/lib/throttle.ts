export function throttle<T extends (...args: never[]) => void>(fn: T, ms: number): T {
    let last = 0;
    let timer: ReturnType<typeof setTimeout> | null = null;
    let lastArgs: Parameters<T>;

    return ((...args: Parameters<T>) => {
        lastArgs = args;
        const now = Date.now();
        const remaining = ms - (now - last);
        if (remaining <= 0) {
            last = now;
            if (timer) {
                clearTimeout(timer);
                timer = null;
            }
            fn(...lastArgs);
            return;
        }
        if (!timer) {
            timer = setTimeout(() => {
                last = Date.now();
                timer = null;
                fn(...lastArgs);
            }, remaining);
        }
    }) as T;
}
