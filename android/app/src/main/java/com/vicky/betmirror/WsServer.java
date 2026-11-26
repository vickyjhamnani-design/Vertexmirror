package com.vicky.betmirror;

import java.io.ByteArrayOutputStream;
import java.io.DataInputStream;
import java.io.IOException;
import java.io.OutputStream;
import java.net.InetSocketAddress;
import java.net.ServerSocket;
import java.net.Socket;
import java.nio.charset.StandardCharsets;
import java.security.MessageDigest;
import java.util.Base64;
import java.util.HashMap;
import java.util.List;
import java.util.Locale;
import java.util.Map;
import java.util.concurrent.CopyOnWriteArrayList;

/**
 * Minimal WebSocket listener for the local network. No libraries, no internet.
 * The PC connects to ws://PHONE_IP:port/?code=XXXX and sends small JSON text messages.
 */
public class WsServer {

    public interface Listener {
        void onMessage(String text);
        void onClients(int count);
    }

    private static final String GUID = "258EAFA5-E914-47DA-95CA-C5AB0DC85B11";
    private static final int MAX_FRAME = 1 << 20;

    private final int port;
    private final String code;
    private final Listener listener;
    private final List<Client> clients = new CopyOnWriteArrayList<>();
    private ServerSocket server;
    private volatile boolean running;

    public WsServer(int port, String code, Listener listener) {
        this.port = port;
        this.code = code;
        this.listener = listener;
    }

    public void start() throws IOException {
        server = new ServerSocket();
        server.setReuseAddress(true);
        server.bind(new InetSocketAddress(port));
        running = true;
        Thread t = new Thread(this::acceptLoop, "betmirror-accept");
        t.setDaemon(true);
        t.start();
    }

    public void stop() {
        running = false;
        try { if (server != null) server.close(); } catch (IOException ignored) { }
        for (Client c : clients) c.close();
    }

    public void broadcast(String text) {
        for (Client c : clients) c.send(text);
    }

    private void acceptLoop() {
        while (running) {
            try {
                Socket s = server.accept();
                s.setTcpNoDelay(true);
                Thread t = new Thread(new Client(s), "betmirror-client");
                t.setDaemon(true);
                t.start();
            } catch (IOException e) {
                if (!running) return;
            }
        }
    }

    private final class Client implements Runnable {
        private final Socket socket;
        private OutputStream out;

        Client(Socket socket) { this.socket = socket; }

        @Override
        public void run() {
            boolean joined = false;
            try {
                DataInputStream in = new DataInputStream(socket.getInputStream());
                out = socket.getOutputStream();
                if (!handshake(in)) return;
                clients.add(this);
                joined = true;
                listener.onClients(clients.size());
                readLoop(in);
            } catch (Exception ignored) {
            } finally {
                close();
                if (joined) {
                    clients.remove(this);
                    listener.onClients(clients.size());
                }
            }
        }

        private boolean handshake(DataInputStream in) throws Exception {
            ByteArrayOutputStream buf = new ByteArrayOutputStream();
            int state = 0;
            while (state < 4) {
                int b = in.read();
                if (b < 0 || buf.size() > 8192) return false;
                buf.write(b);
                state = (b == '\r' && (state == 0 || state == 2)) ? state + 1
                        : (b == '\n' && (state == 1 || state == 3)) ? state + 1 : 0;
            }
            String[] lines = new String(buf.toByteArray(), StandardCharsets.ISO_8859_1).split("\r\n");
            String[] req = lines[0].split(" ");
            String path = req.length > 1 ? req[1] : "/";
            Map<String, String> headers = new HashMap<>();
            for (int i = 1; i < lines.length; i++) {
                int c = lines[i].indexOf(':');
                if (c > 0) headers.put(lines[i].substring(0, c).trim().toLowerCase(Locale.ROOT), lines[i].substring(c + 1).trim());
            }
            String key = headers.get("sec-websocket-key");
            if (key == null) {
                // plain browser visit: lets you check from the PC that the phone is reachable
                http("200 OK", "BetMirror is reachable. Enter this IP and the code in the Chrome extension.");
                return false;
            }
            if (!path.contains("code=" + code)) {
                http("403 Forbidden", "Wrong code");
                return false;
            }
            MessageDigest sha1 = MessageDigest.getInstance("SHA-1");
            String accept = Base64.getEncoder().encodeToString(sha1.digest((key + GUID).getBytes(StandardCharsets.ISO_8859_1)));
            String res = "HTTP/1.1 101 Switching Protocols\r\nUpgrade: websocket\r\nConnection: Upgrade\r\n"
                    + "Sec-WebSocket-Accept: " + accept + "\r\n\r\n";
            out.write(res.getBytes(StandardCharsets.ISO_8859_1));
            out.flush();
            return true;
        }

        private void http(String status, String body) throws IOException {
            byte[] b = body.getBytes(StandardCharsets.UTF_8);
            String head = "HTTP/1.1 " + status + "\r\nContent-Type: text/plain; charset=utf-8\r\nContent-Length: "
                    + b.length + "\r\nConnection: close\r\n\r\n";
            out.write(head.getBytes(StandardCharsets.ISO_8859_1));
            out.write(b);
            out.flush();
        }

        private void readLoop(DataInputStream in) throws IOException {
            ByteArrayOutputStream message = new ByteArrayOutputStream();
            while (running) {
                int b0 = in.readUnsignedByte();
                int b1 = in.readUnsignedByte();
                boolean fin = (b0 & 0x80) != 0;
                int op = b0 & 0x0F;
                boolean masked = (b1 & 0x80) != 0;
                long len = b1 & 0x7F;
                if (len == 126) len = in.readUnsignedShort();
                else if (len == 127) len = in.readLong();
                if (len < 0 || len > MAX_FRAME) return;
                byte[] mask = new byte[4];
                if (masked) in.readFully(mask);
                byte[] data = new byte[(int) len];
                in.readFully(data);
                if (masked) for (int i = 0; i < data.length; i++) data[i] ^= mask[i & 3];

                if (op == 0x8) return;                       // close
                if (op == 0x9) { frame(0xA, data); continue; } // ping -> pong
                if (op == 0xA) continue;                     // pong
                if (op == 0x1) message.reset();
                if (op == 0x1 || op == 0x0) {
                    if (message.size() + data.length > MAX_FRAME) return;
                    message.write(data);
                    if (fin) {
                        listener.onMessage(new String(message.toByteArray(), StandardCharsets.UTF_8));
                        message.reset();
                    }
                }
            }
        }

        void send(String text) {
            try { frame(0x1, text.getBytes(StandardCharsets.UTF_8)); } catch (IOException e) { close(); }
        }

        private synchronized void frame(int op, byte[] data) throws IOException {
            ByteArrayOutputStream f = new ByteArrayOutputStream(data.length + 10);
            f.write(0x80 | op);
            if (data.length < 126) {
                f.write(data.length);
            } else if (data.length < 65536) {
                f.write(126);
                f.write(data.length >> 8);
                f.write(data.length & 0xFF);
            } else {
                f.write(127);
                for (int i = 7; i >= 0; i--) f.write((int) (((long) data.length >> (8 * i)) & 0xFF));
            }
            f.write(data);
            out.write(f.toByteArray());
            out.flush();
        }

        void close() {
            try { socket.close(); } catch (IOException ignored) { }
        }
    }
}
