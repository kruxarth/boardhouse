import { z } from "zod";
import { asReaction } from "./constants";

export const AccessModeSchema = z.enum(["knock", "open"]);
export type AccessMode = z.infer<typeof AccessModeSchema>;

export const CreateSessionSchema = z.object({
    name: z.string().trim().min(2).max(24),
});

export const CreateRoomSchema = z.object({
    name: z.string().trim().min(1).max(40),
});

export const ClaimRoomSchema = CreateRoomSchema;

export const MarkerSlotSchema = z.union([z.literal(0), z.literal(1)]);
export type MarkerSlot = z.infer<typeof MarkerSlotSchema>;

export const JoinMessageSchema = z.object({
    type: z.literal("join"),
    roomId: z.string().min(1).max(100),
    hostKey: z.string().min(1).max(200).optional(),
    token: z.string().min(1).max(2000).optional(),
    fromHouse: z.boolean().optional(),
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
    slot: MarkerSlotSchema,
});

export const CancelAskMessageSchema = z.object({
    type: z.literal("cancel_ask"),
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
    tool: z.enum(["pointer", "laser"]).optional(),
    button: z.enum(["up", "down"]).optional(),
});

export const MuteParticipantMessageSchema = z.object({
    type: z.literal("mute_participant"),
    participantId: z.string().min(1).max(100),
});

export const SetMutedMessageSchema = z.object({
    type: z.literal("set_muted"),
    muted: z.boolean(),
});

export const ReactMessageSchema = z.object({
    type: z.literal("react"),
    emoji: z
        .string()
        .max(16)
        .transform((value, ctx) => {
            const emoji = asReaction(value);
            if (!emoji) {
                ctx.addIssue({ code: "custom", message: "Unknown reaction" });
                return z.NEVER;
            }
            return emoji;
        }),
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
    CancelAskMessageSchema,
    AnswerMarkerMessageSchema,
    DropMarkerMessageSchema,
    GiveMarkerMessageSchema,
    HostTakeMarkerMessageSchema,
    HostGiveMarkerMessageSchema,
    CanvasMessageSchema,
    CursorMessageSchema,
    MuteParticipantMessageSchema,
    SetMutedMessageSchema,
    ReactMessageSchema,
    GetReplayMessageSchema,
]);

export type ClientMessage = z.infer<typeof ClientMessageSchema>;

export const PresencePersonSchema = z.object({
    id: z.string(),
    name: z.string(),
    muted: z.boolean(),
    avatar: z.number(),
});
export type PresencePerson = z.infer<typeof PresencePersonSchema>;

/** What the asker sees while their own request is in flight. */
export const PendingAskSchema = z.object({
    requestId: z.string(),
    slot: MarkerSlotSchema,
    holderId: z.string(),
    holderName: z.string(),
    expiresAt: z.string(),
});
export type PendingAsk = z.infer<typeof PendingAskSchema>;

export const AskOutcomeSchema = z.enum(["given", "kept", "lapsed"]);
export type AskOutcome = z.infer<typeof AskOutcomeSchema>;

const MarkerSlotsSchema = z.tuple([z.string().nullable(), z.string().nullable()]);

export const MarkerAskWireSchema = z.object({
    requestId: z.string(),
    fromParticipantId: z.string(),
    fromName: z.string(),
    fromAvatar: z.number(),
    slot: MarkerSlotSchema,
    expiresAt: z.string(),
});

export const ReplayEventSchema = z.object({
    t: z.number(),
    type: z.string(),
    payload: z.unknown(),
});
export type ReplayEvent = z.infer<typeof ReplayEventSchema>;

export const RoomStateSchema = z.object({
    type: z.literal("room_state"),
    slug: z.string(),
    name: z.string().nullable(),
    accessMode: AccessModeSchema,
    expiresAt: z.string(),
    hostParticipantId: z.string(),
    seats: z.array(PresencePersonSchema),
    waiters: z.array(PresencePersonSchema),
    markers: MarkerSlotsSchema,
    usedSeats: z.number(),
    maxSeats: z.number(),
    viaFormerSlug: z.boolean(),
});
export type RoomStatePayload = z.infer<typeof RoomStateSchema>;

export const ServerMessageSchema = z.discriminatedUnion("type", [
    z.object({ type: z.literal("hello"), authed: z.boolean() }),
    z.object({ type: z.literal("auth_error"), message: z.string() }),
    z.object({ type: z.literal("error"), message: z.string() }),
    z.object({ type: z.literal("joined"), slug: z.string() }),
    z.object({ type: z.literal("waiting") }),
    z.object({ type: z.literal("denied"), message: z.string() }),
    z.object({ type: z.literal("full"), message: z.string() }),
    z.object({ type: z.literal("expired"), message: z.string() }),
    z.object({ type: z.literal("missing"), message: z.string() }),
    z.object({ type: z.literal("left") }),
    z.object({
        type: z.literal("participant_left"),
        participantId: z.string(),
    }),
    z.object({
        type: z.literal("participant_joined"),
        participant: PresencePersonSchema,
    }),
    RoomStateSchema,
    z.object({ type: z.literal("marker_state"), slots: MarkerSlotsSchema }),
    z.object({ type: z.literal("marker_ack"), slots: MarkerSlotsSchema }),
    z.object({
        type: z.literal("marker_asks"),
        asks: z.array(MarkerAskWireSchema),
    }),
    z.object({
        type: z.literal("marker_ask_state"),
        ask: PendingAskSchema.nullable(),
    }),
    z.object({
        type: z.literal("marker_ask_done"),
        slot: MarkerSlotSchema,
        outcome: AskOutcomeSchema,
    }),
    z.object({
        type: z.literal("slug_rotated"),
        slug: z.string(),
        formerSlug: z.string(),
    }),
    z.object({
        type: z.literal("knock"),
        participant: PresencePersonSchema,
    }),
    z.object({ type: z.literal("canvas_snapshot"), payload: z.unknown() }),
    z.object({ type: z.literal("canvas"), payload: z.unknown() }),
    z.object({ type: z.literal("canvas_ack") }),
    z.object({
        type: z.literal("cursor"),
        participantId: z.string(),
        name: z.string(),
        x: z.number(),
        y: z.number(),
        tool: z.enum(["pointer", "laser"]),
        button: z.enum(["up", "down"]),
    }),
    z.object({ type: z.literal("force_mute") }),
    z.object({
        type: z.literal("reaction"),
        id: z.string(),
        participantId: z.string(),
        emoji: z.string(),
    }),
    z.object({
        type: z.literal("replay"),
        version: z.number(),
        startedAt: z.string(),
        slug: z.string(),
        events: z.array(ReplayEventSchema),
    }),
]);

export type ServerMessage = z.infer<typeof ServerMessageSchema>;
