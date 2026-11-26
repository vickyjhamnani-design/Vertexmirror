import com.vicky.betmirror.WsServer;

public class EchoMain {
    static WsServer server;
    public static void main(String[] a) throws Exception {
        server = new WsServer(18765, "4321", new WsServer.Listener() {
            public void onMessage(String text) { server.broadcast("echo:" + text); }
            public void onClients(int count) { }
        });
        server.start();
        Thread.sleep(15000);
        server.stop();
    }
}
