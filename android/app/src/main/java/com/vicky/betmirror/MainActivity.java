package com.vicky.betmirror;

import android.app.Activity;
import android.content.SharedPreferences;
import android.graphics.Color;
import android.graphics.Typeface;
import android.os.Bundle;
import android.text.InputType;
import android.view.Gravity;
import android.view.KeyEvent;
import android.view.WindowManager;
import android.view.inputmethod.EditorInfo;
import android.webkit.CookieManager;
import android.webkit.JavascriptInterface;
import android.webkit.WebChromeClient;
import android.webkit.WebSettings;
import android.webkit.WebView;
import android.webkit.WebViewClient;
import android.widget.Button;
import android.widget.CheckBox;
import android.widget.EditText;
import android.widget.LinearLayout;
import android.widget.TextView;
import android.widget.Toast;

import org.json.JSONObject;

import java.io.ByteArrayOutputStream;
import java.io.InputStream;
import java.net.Inet4Address;
import java.net.InetAddress;
import java.net.NetworkInterface;
import java.nio.charset.StandardCharsets;
import java.util.Collections;
import java.util.Random;

/**
 * One screen: address bar, status line, and a WebView showing the site.
 * Clicks sent by the PC arrive on the Wi-Fi listener and are replayed in the page by core.js.
 */
public class MainActivity extends Activity implements WsServer.Listener {

    static final int PORT = 8765;

    private WebView web;
    private EditText urlBox;
    private TextView status;
    private CheckBox autoBox;
    private SharedPreferences prefs;
    private WsServer server;
    private String coreJs = "";
    private String code;
    private int pcCount = 0;
    private String lastAction = "waiting for PC";

    @Override
    protected void onCreate(Bundle saved) {
        super.onCreate(saved);
        getWindow().addFlags(WindowManager.LayoutParams.FLAG_KEEP_SCREEN_ON);
        prefs = getSharedPreferences("betmirror", MODE_PRIVATE);
        code = prefs.getString("code", null);
        if (code == null) {
            code = String.valueOf(1000 + new Random().nextInt(9000));
            prefs.edit().putString("code", code).apply();
        }
        coreJs = readAsset("core.js");
        buildUi();
        setupWeb();

        server = new WsServer(PORT, code, this);
        try {
            server.start();
        } catch (Exception e) {
            lastAction = "could not open port " + PORT + ": " + e.getMessage();
        }
        showStatus();

        String url = prefs.getString("url", "");
        if (url.isEmpty()) {
            web.loadDataWithBaseURL(null, helpPage(), "text/html", "utf-8", null);
        } else {
            urlBox.setText(url);
            web.loadUrl(url);
        }
    }

    private void buildUi() {
        LinearLayout root = new LinearLayout(this);
        root.setOrientation(LinearLayout.VERTICAL);
        root.setFitsSystemWindows(true);

        LinearLayout bar = new LinearLayout(this);
        bar.setOrientation(LinearLayout.HORIZONTAL);
        bar.setGravity(Gravity.CENTER_VERTICAL);

        urlBox = new EditText(this);
        urlBox.setHint("site address");
        urlBox.setSingleLine(true);
        urlBox.setTextSize(14);
        urlBox.setInputType(InputType.TYPE_CLASS_TEXT | InputType.TYPE_TEXT_VARIATION_URI);
        urlBox.setImeOptions(EditorInfo.IME_ACTION_GO);
        urlBox.setOnEditorActionListener((v, action, ev) -> { go(); return true; });
        bar.addView(urlBox, new LinearLayout.LayoutParams(0, LinearLayout.LayoutParams.WRAP_CONTENT, 1));

        Button goBtn = new Button(this);
        goBtn.setText("Go");
        goBtn.setOnClickListener(v -> go());
        bar.addView(goBtn, new LinearLayout.LayoutParams(LinearLayout.LayoutParams.WRAP_CONTENT, LinearLayout.LayoutParams.WRAP_CONTENT));

        autoBox = new CheckBox(this);
        autoBox.setText("Auto place");
        autoBox.setTextSize(12);
        autoBox.setChecked(prefs.getBoolean("auto", true));
        autoBox.setOnCheckedChangeListener((b, on) -> prefs.edit().putBoolean("auto", on).apply());
        bar.addView(autoBox, new LinearLayout.LayoutParams(LinearLayout.LayoutParams.WRAP_CONTENT, LinearLayout.LayoutParams.WRAP_CONTENT));

        status = new TextView(this);
        status.setTextSize(12);
        status.setTypeface(Typeface.MONOSPACE);
        status.setPadding(16, 6, 16, 6);
        status.setTextColor(Color.WHITE);

        web = new WebView(this);

        root.addView(bar, new LinearLayout.LayoutParams(LinearLayout.LayoutParams.MATCH_PARENT, LinearLayout.LayoutParams.WRAP_CONTENT));
        root.addView(status, new LinearLayout.LayoutParams(LinearLayout.LayoutParams.MATCH_PARENT, LinearLayout.LayoutParams.WRAP_CONTENT));
        root.addView(web, new LinearLayout.LayoutParams(LinearLayout.LayoutParams.MATCH_PARENT, 0, 1));
        setContentView(root);
    }

    private void setupWeb() {
        WebSettings s = web.getSettings();
        s.setJavaScriptEnabled(true);
        s.setDomStorageEnabled(true);
        s.setDatabaseEnabled(true);
        s.setLoadWithOverviewMode(true);
        s.setUseWideViewPort(true);
        s.setMediaPlaybackRequiresUserGesture(false);
        // behave like the normal phone browser so the site serves its usual mobile page
        s.setUserAgentString(s.getUserAgentString().replace("; wv", ""));
        CookieManager.getInstance().setAcceptCookie(true);
        CookieManager.getInstance().setAcceptThirdPartyCookies(web, true);
        web.addJavascriptInterface(new Bridge(), "BetMirrorApp");
        web.setWebChromeClient(new WebChromeClient());
        web.setWebViewClient(new WebViewClient() {
            @Override
            public void onPageFinished(WebView view, String url) {
                if (url != null && url.startsWith("http")) {
                    urlBox.setText(url);
                    prefs.edit().putString("url", url).apply();
                }
            }
        });
    }

    private void go() {
        String u = urlBox.getText().toString().trim();
        if (u.isEmpty()) return;
        if (!u.startsWith("http://") && !u.startsWith("https://")) u = "https://" + u;
        web.loadUrl(u);
        web.requestFocus();
    }

    /* ---- messages from the PC ---- */

    @Override
    public void onMessage(String text) {
        runOnUiThread(() -> {
            try {
                String type = new JSONObject(text).optString("t");
                if ("ping".equals(type)) return;
                if ("test".equals(type)) {
                    Toast.makeText(this, "Test received from PC", Toast.LENGTH_SHORT).show();
                    reply(true, "test received");
                    return;
                }
                // (re)install core.js if this page doesn't have it yet, then replay the click
                String js = "(function(){try{if(!window.__betMirror){" + coreJs + "}"
                        + "window.__betMirror.auto=" + autoBox.isChecked() + ";"
                        + "window.__betMirror.handle(" + JSONObject.quote(text) + ");"
                        + "}catch(e){BetMirrorApp.report(JSON.stringify({t:'res',ok:false,msg:String(e)}));}})()";
                web.evaluateJavascript(js, null);
            } catch (Exception e) {
                reply(false, "bad message: " + e.getMessage());
            }
        });
    }

    @Override
    public void onClients(int count) {
        runOnUiThread(() -> { pcCount = count; showStatus(); });
    }

    private void reply(boolean ok, String msg) {
        try {
            JSONObject o = new JSONObject();
            o.put("t", "res"); o.put("ok", ok); o.put("msg", msg);
            if (server != null) server.broadcast(o.toString());
        } catch (Exception ignored) { }
        lastAction = (ok ? "✓ " : "✗ ") + msg;
        showStatus();
    }

    private final class Bridge {
        @JavascriptInterface
        public void report(String json) {
            runOnUiThread(() -> {
                try {
                    JSONObject o = new JSONObject(json);
                    reply(o.optBoolean("ok"), o.optString("msg"));
                } catch (Exception ignored) { }
            });
        }
    }

    private void showStatus() {
        String ip = wifiIp();
        status.setBackgroundColor(pcCount > 0 ? Color.rgb(26, 127, 55) : Color.rgb(87, 96, 106));
        status.setText("IP " + (ip == null ? "no Wi-Fi" : ip) + "   code " + code + "   "
                + (pcCount > 0 ? "PC connected" : "PC not connected") + "\n" + lastAction);
    }

    private static String wifiIp() {
        try {
            String other = null;
            for (NetworkInterface ni : Collections.list(NetworkInterface.getNetworkInterfaces())) {
                if (!ni.isUp() || ni.isLoopback()) continue;
                for (InetAddress a : Collections.list(ni.getInetAddresses())) {
                    if (a instanceof Inet4Address && a.isSiteLocalAddress()) {
                        if (ni.getName().startsWith("wlan")) return a.getHostAddress();
                        other = a.getHostAddress();
                    }
                }
            }
            return other;
        } catch (Exception e) {
            return null;
        }
    }

    private String readAsset(String name) {
        try (InputStream in = getAssets().open(name)) {
            ByteArrayOutputStream out = new ByteArrayOutputStream();
            byte[] buf = new byte[8192];
            int n;
            while ((n = in.read(buf)) > 0) out.write(buf, 0, n);
            return new String(out.toByteArray(), StandardCharsets.UTF_8);
        } catch (Exception e) {
            return "";
        }
    }

    private String helpPage() {
        return "<html><body style='font:16px sans-serif;padding:20px;line-height:1.5'>"
                + "<h3>BetMirror</h3><ol>"
                + "<li>Keep this phone and the PC on the same Wi-Fi.</li>"
                + "<li>In the Chrome extension on the PC, enter the IP and code shown above.</li>"
                + "<li>Type the site address above, tap Go and log in.</li>"
                + "<li>Open the same match on the PC and the phone.</li></ol>"
                + "<p>The bar turns green when the PC is connected.</p></body></html>";
    }

    @Override
    public boolean onKeyDown(int keyCode, KeyEvent event) {
        if (keyCode == KeyEvent.KEYCODE_BACK && web.canGoBack()) {
            web.goBack();
            return true;
        }
        return super.onKeyDown(keyCode, event);
    }

    @Override
    protected void onResume() {
        super.onResume();
        showStatus();
    }

    @Override
    protected void onDestroy() {
        if (server != null) server.stop();
        web.destroy();
        super.onDestroy();
    }
}
