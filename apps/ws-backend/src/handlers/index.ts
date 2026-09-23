import type { ClientMessage } from "@repo/common/types";
import type { Connection } from "../connection";
import {
    handleAdmit,
    handleDeny,
    handleEndRoom,
    handleJoin,
    handleKnock,
    handleLeave,
    handleRotateSlug,
    handleSetMode,
} from "./door";
import {
    handleAnswerMarker,
    handleAskMarker,
    handleCancelAsk,
    handleDropMarker,
    handleGiveMarker,
    handleHostGiveMarker,
    handleHostTakeMarker,
    handleTakeMarker,
} from "./markers";
import { handleCanvas, handleCursor, handleGetReplay } from "./canvas";
import { handleMuteParticipant, handleReact, handleSetMuted } from "./voice";

export type Handler = (connection: Connection, message: ClientMessage) => Promise<void>;

export const handlers: Record<ClientMessage["type"], Handler> = {
    join: handleJoin,
    leave: handleLeave,
    knock: handleKnock,
    admit: handleAdmit,
    deny: handleDeny,
    set_mode: handleSetMode,
    rotate_slug: handleRotateSlug,
    end_room: handleEndRoom,
    take_marker: handleTakeMarker,
    ask_marker: handleAskMarker,
    cancel_ask: handleCancelAsk,
    answer_marker: handleAnswerMarker,
    drop_marker: handleDropMarker,
    give_marker: handleGiveMarker,
    host_take_marker: handleHostTakeMarker,
    host_give_marker: handleHostGiveMarker,
    canvas: handleCanvas,
    cursor: handleCursor,
    mute_participant: handleMuteParticipant,
    set_muted: handleSetMuted,
    react: handleReact,
    get_replay: handleGetReplay,
};
