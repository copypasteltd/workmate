// Trusted HTTP/1.1 transport. Customer modules run only inside the native boundary.
const http = require("node:http");
const { Duplex } = require("node:stream");
const { pathToFileURL } = require("node:url");
const path = require("node:path");
const fs = require("node:fs");
const configuration = JSON.parse(
  fs.readFileSync(path.join(__dirname, "check-input.json"), "utf8"),
);
// Normal application logs must not corrupt the response channel.
for (const name of ["log", "info", "debug", "warn"])
  console[name] = console.error.bind(console);
async function main() {
  const module = await import(
    pathToFileURL(path.resolve(process.argv[2])).href
  );
  const application = module[configuration.export_name];
  const server =
    typeof application === "function"
      ? http.createServer(application)
      : application;
  if (!(server instanceof http.Server) || server.listening)
    throw new Error(
      "Export an HTTP request handler or an unstarted http.Server",
    );
  const sockets = new Map(),
    closed = new Set();
  const send = (value, callback) =>
    process.stdout.write(JSON.stringify(value) + "\n", callback);
  const open = (id) => {
    if (
      !/^c\d{1,3}$/.test(id) ||
      sockets.has(id) ||
      closed.has(id) ||
      sockets.size >= 20
    )
      throw new Error("HTTP_CHANNEL_ID");
    const socket = new Duplex({
      read() {},
      write(chunk, encoding, callback) {
        const bytes = Buffer.from(chunk);
        if (!bytes.length) return callback();
        for (let offset = 0; offset < bytes.length; offset += 8192)
          send(
            {
              id,
              data: bytes.subarray(offset, offset + 8192).toString("base64"),
            },
            offset + 8192 >= bytes.length ? callback : undefined,
          );
      },
      final(callback) {
        send({ id, end: true }, callback);
      },
      destroy(error, callback) {
        sockets.delete(id);
        closed.add(id);
        send({ id, end: true });
        callback(error);
      },
    });
    socket.setTimeout = () => socket;
    socket.setNoDelay = () => socket;
    socket.setKeepAlive = () => socket;
    socket.ref = socket.unref = () => socket;
    socket.on("error", (error) => {
      console.error(error.message);
      process.exitCode = 1;
    });
    sockets.set(id, socket);
    server.emit("connection", socket);
  };
  server.on("clientError", (error, socket) => {
    console.error(error.message);
    process.exitCode = 1;
    socket.destroy();
  });
  let pending = "";
  process.stdin.setEncoding("utf8");
  process.stdin.on("data", (bytes) => {
    try {
      pending += bytes;
      let end;
      while ((end = pending.indexOf("\n")) >= 0) {
        const text = pending.slice(0, end);
        pending = pending.slice(end + 1);
        if (text.length > 32768) throw new Error("HTTP_CHANNEL_LIMIT");
        const frame = JSON.parse(text);
        if (frame.open) open(frame.open);
        else if (frame.close) {
          const socket = sockets.get(frame.close);
          if (socket) {
            socket.push(null);
            socket.destroy();
          }
        } else {
          const socket = sockets.get(frame.id);
          if (!socket && closed.has(frame.id)) continue;
          if (
            !socket ||
            typeof frame.data !== "string" ||
            frame.data.length > 32768
          )
            throw new Error("HTTP_CHANNEL_FRAME");
          const data = Buffer.from(frame.data, "base64");
          if (data.toString("base64") !== frame.data)
            throw new Error("HTTP_CHANNEL_ENCODING");
          socket.push(data);
        }
      }
      if (pending.length > 32768) throw new Error("HTTP_CHANNEL_LIMIT");
    } catch (error) {
      console.error(error.message);
      process.exitCode = 1;
      process.stdin.destroy();
      for (const socket of sockets.values()) socket.destroy();
    }
  });
  process.stdin.on("end", () => {
    for (const socket of sockets.values()) {
      socket.push(null);
      socket.destroy();
    }
    server.closeAllConnections();
    server.close();
  });
  // Readiness is emitted only after the customer module and transport listeners
  // exist. Startup remains bounded by the native host's process deadline.
  send({ ready: true });
}
main().catch((error) => {
  console.error(error.stack);
  process.exitCode = 1;
});
