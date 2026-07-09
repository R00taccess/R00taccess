package com.omnicorp.terminalquest;

import android.app.Activity;
import android.graphics.Color;
import android.os.Bundle;
import android.view.KeyEvent;
import android.webkit.WebChromeClient;
import android.webkit.WebSettings;
import android.webkit.WebView;
import android.webkit.WebViewClient;

/**
 * Terminal Quest — Android shell.
 * A single fullscreen WebView loading the bundled game from assets/www.
 * The entire game (filesystem, shell, levels) runs inside the page; this
 * activity only hosts it. Saves persist via WebView localStorage
 * (setDomStorageEnabled), so progress survives app restarts.
 */
public class MainActivity extends Activity {

    private WebView webView;

    @Override
    protected void onCreate(Bundle savedInstanceState) {
        super.onCreate(savedInstanceState);

        webView = new WebView(this);
        webView.setBackgroundColor(Color.BLACK);

        WebSettings s = webView.getSettings();
        s.setJavaScriptEnabled(true);       // the game is JavaScript
        s.setDomStorageEnabled(true);       // localStorage = save files
        s.setAllowFileAccess(true);         // load from file:///android_asset
        s.setLoadWithOverviewMode(true);
        s.setUseWideViewPort(false);
        s.setTextZoom(100);
        s.setMediaPlaybackRequiresUserGesture(true);

        webView.setWebViewClient(new WebViewClient()); // keep navigation inside
        webView.setWebChromeClient(new WebChromeClient());

        webView.loadUrl("file:///android_asset/www/index.html");
        setContentView(webView);
    }

    @Override
    public boolean onKeyDown(int keyCode, KeyEvent event) {
        // Back button backgrounds the game instead of killing it mid-level.
        if (keyCode == KeyEvent.KEYCODE_BACK) {
            moveTaskToBack(true);
            return true;
        }
        return super.onKeyDown(keyCode, event);
    }

    @Override
    protected void onDestroy() {
        if (webView != null) {
            webView.destroy();
            webView = null;
        }
        super.onDestroy();
    }
}
