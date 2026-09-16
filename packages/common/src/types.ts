import { z } from "zod";

export const AccessModeSchema = z.enum(["knock", "open"]);
export type AccessMode = z.infer<typeof AccessModeSchema>;

export const CreateSessionSchema = z.object({
    name: z.string().trim().min(2).max(24),
});

export const CreateRoomSchema = z.object({
    name: z.string().trim().min(1).max(40).optional(),
});

export const MarkerSlotSchema = z.union([z.literal(0), z.literal(1)]);
export type MarkerSlot = z.infer<typeof MarkerSlotSchema>;

export const JoinMessageSchema = z.object({
    type: z.literal("join"),
    roomId: z.string().min(1).max(100),
    hostKey: z.string().min(1).max(200).optional(),
});

export const LeaveMessageSchema = z.object({
    type: z.literal("leave"),
});

export const KnockMessageSchema = z.object({
    type: z.literal("knock"),
});

export const AdmitMessageSchema = z.object({
    type: z.literal("admit"),
    participantId: z.string().min(1).max(100),
});

export const DenyMessageSchema = z.object({
    type: z.literal("deny"),
    participantId: z.string().min(1).max(100),
});

export const SetModeMessageSchema = z.object({
    type: z.literal("set_mode"),
    accessMode: AccessModeSchema,
});

export const RotateSlugMessageSchema = z.object({
    type: z.literal("rotate_slug"),
});

export const EndRoomMessageSchema = z.object({
    type: z.literal("end_room"),
});

export const TakeMarkerMessageSchema = z.object({
    type: z.literal("take_marker"),
    slot: MarkerSlotSchema,
});

export const AskMarkerMessageSchema = z.object({
    type: z.literal("ask_marker"),
    fromParticipantId: z.string().min(1).max(100),
});

export const AnswerMarkerMessageSchema = z.object({
    type: z.literal("answer_marker"),
    requestId: z.string().min(1).max(100),
    give: z.boolean(),
});

export const DropMarkerMessageSchema = z.object({
    type: z.literal("drop_marker"),
    slot: MarkerSlotSchema,
});

export const GiveMarkerMessageSchema = z.object({
    type: z.literal("give_marker"),
    slot: MarkerSlotSchema,
    toParticipantId: z.string().min(1).max(100),
});

export const HostTakeMarkerMessageSchema = z.object({
    type: z.literal("host_take_marker"),
    slot: MarkerSlotSchema,
});

export const HostGiveMarkerMessageSchema = z.object({
    type: z.literal("host_give_marker"),
    slot: MarkerSlotSchema,
    toParticipantId: z.string().min(1).max(100),
});

export const CanvasMessageSchema = z.object({
    type: z.literal("canvas"),
    payload: z.unknown(),
});

export const CursorMessageSchema = z.object({
    type: z.literal("cursor"),
    x: z.number().finite(),
    y: z.number().finite(),
});

export const MuteParticipantMessageSchema = z.object({
    type: z.literal("mute_participant"),
    participantId: z.string().min(1).max(100),
});

export const SetMutedMessageSchema = z.object({
    type: z.literal("set_muted"),
    muted: z.boolean(),
});

export const GetReplayMessageSchema = z.object({
    type: z.literal("get_replay"),
});

export const ClientMessageSchema = z.discriminatedUnion("type", [
    JoinMessageSchema,
    LeaveMessageSchema,
    KnockMessageSchema,
    AdmitMessageSchema,
    DenyMessageSchema,
    SetModeMessageSchema,
    RotateSlugMessageSchema,
    EndRoomMessageSchema,
    TakeMarkerMessageSchema,
    AskMarkerMessageSchema,
    AnswerMarkerMessageSchema,
    DropMarkerMessageSchema,
    GiveMarkerMessageSchema,
    HostTakeMarkerMessageSchema,
    HostGiveMarkerMessageSchema,
    CanvasMessageSchema,
    CursorMessageSchema,
    MuteParticipantMessageSchema,
    SetMutedMessageSchema,
    GetReplayMessageSchema,
]);

export type ClientMessage = z.infer<typeof ClientMessageSchema>;

export type PresencePerson = {
    id: string;
    name: string;
    muted: boolean;
};

export type RoomStatePayload = {
    type: "room_state";
    slug: string;
    name: string | null;
    accessMode: AccessMode;
    expiresAt: string;
    hostParticipantId: string;
    seats: PresencePerson[];
    waiters: PresencePerson[];
    markers: [string | null, string | null];
    usedSeats: number;
    maxSeats: number;
    viaFormerSlug: boolean;
};

export type ReplayEvent = {
    t: number;
    type: string;
    payload: unknown;
};
