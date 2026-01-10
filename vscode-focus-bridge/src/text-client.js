import WebSocket from "ws";

const ws = new WebSocket("ws://127.0.0.1:9876");

ws.on("open", () => {
  console.log("Connected");
  ws.send(JSON.stringify({ type: "request_status" }));
});

ws.on("message", (msg) => {
  console.log("Got:", msg.toString());
});
