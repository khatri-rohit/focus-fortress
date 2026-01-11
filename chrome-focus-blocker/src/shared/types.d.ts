declare interface WsStatusMessage {
  type: "status" | "heartbeat";
  active?: boolean;
}
