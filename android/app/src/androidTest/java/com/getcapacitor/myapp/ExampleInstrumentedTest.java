package ai.allplays.lite;

import static org.junit.Assert.assertNotNull;
import static org.junit.Assert.assertTrue;

import android.os.SystemClock;
import android.webkit.WebView;
import androidx.test.core.app.ActivityScenario;
import androidx.test.ext.junit.runners.AndroidJUnit4;
import androidx.test.platform.app.InstrumentationRegistry;
import java.util.concurrent.CountDownLatch;
import java.util.concurrent.TimeUnit;
import java.util.concurrent.atomic.AtomicReference;
import org.junit.Test;
import org.junit.runner.RunWith;

@RunWith(AndroidJUnit4.class)
public class ExampleInstrumentedTest {

    @Test
    public void releaseWebViewBootsAtTheCapacitorAndroidOrigin() throws Exception {
        AtomicReference<WebView> webViewReference = new AtomicReference<>();
        try (ActivityScenario<MainActivity> scenario = ActivityScenario.launch(MainActivity.class)) {
            scenario.onActivity(activity -> {
                assertNotNull(activity.getBridge());
                assertNotNull(activity.getBridge().getWebView());
                assertNotNull(activity.getBridge().getPlugin("Camera"));
                webViewReference.set(activity.getBridge().getWebView());
            });

            WebView webView = webViewReference.get();
            assertNotNull(webView);
            waitForReleaseAppToRender(webView);
        }
    }

    private void waitForReleaseAppToRender(WebView webView) throws Exception {
        long deadline = SystemClock.elapsedRealtime() + TimeUnit.SECONDS.toMillis(30);
        String lastUrl = null;
        String lastRootResult = null;

        while (SystemClock.elapsedRealtime() < deadline) {
            AtomicReference<String> urlReference = new AtomicReference<>();
            InstrumentationRegistry.getInstrumentation().runOnMainSync(
                () -> urlReference.set(webView.getUrl())
            );
            lastUrl = urlReference.get();
            lastRootResult = evaluateJavascript(
                webView,
                "Boolean(document.querySelector('#root')?.childElementCount)"
            );

            if (lastUrl != null
                && lastUrl.startsWith("https://localhost")
                && "true".equals(lastRootResult)) {
                return;
            }
            SystemClock.sleep(250);
        }

        assertTrue(
            "Release WebView did not render from https://localhost; url="
                + lastUrl + ", root=" + lastRootResult,
            false
        );
    }

    private String evaluateJavascript(WebView webView, String script) throws Exception {
        CountDownLatch resultReady = new CountDownLatch(1);
        AtomicReference<String> result = new AtomicReference<>();
        InstrumentationRegistry.getInstrumentation().runOnMainSync(() ->
            webView.evaluateJavascript(script, value -> {
                result.set(value);
                resultReady.countDown();
            })
        );
        assertTrue("Timed out evaluating release WebView JavaScript", resultReady.await(5, TimeUnit.SECONDS));
        return result.get();
    }
}
