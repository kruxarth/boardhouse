type QueueTask = () => Promise<void>;

const roomQueues = new Map<string, Promise<void>>();

export function enqueueRoomEvent(roomId: string, task: QueueTask): Promise<void> {
    const previous = roomQueues.get(roomId) ?? Promise.resolve();
    let next: Promise<void>;

    next = previous.then(task, task).finally(() => {
        if (roomQueues.get(roomId) === next) {
            roomQueues.delete(roomId);
        }
    });

    roomQueues.set(roomId, next);
    return next;
}
