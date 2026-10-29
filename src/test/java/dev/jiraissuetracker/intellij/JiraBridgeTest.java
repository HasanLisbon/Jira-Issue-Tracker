package dev.jiraissuetracker.intellij;

import com.google.gson.JsonObject;
import org.junit.Test;

import java.net.URI;
import java.net.http.HttpClient;
import java.net.http.HttpRequest;
import java.net.http.HttpResponse;
import java.util.concurrent.atomic.AtomicInteger;

import static org.junit.Assert.*;

public class JiraBridgeTest {
    @Test
    public void when_sessionIsMissingOrOriginIsForeign_then_serveApi_should_RejectWithoutExecuting() throws Exception {
        AtomicInteger writes = new AtomicInteger();
        FrontendAssetServer server = new FrontendAssetServer(request -> { writes.incrementAndGet(); return new JsonObject(); });
        try (HttpClient client = HttpClient.newHttpClient()) {
            URI endpoint = URI.create(server.getUrl() + "api/jira");
            HttpRequest request = HttpRequest.newBuilder(endpoint).POST(HttpRequest.BodyPublishers.ofString("{}")).build();
            assertEquals(403, client.send(request, HttpResponse.BodyHandlers.ofString()).statusCode());
            String session = URI.create(server.getSessionUrl()).getFragment();
            request = HttpRequest.newBuilder(endpoint).header("X-Jira-Session", session).header("Origin", "https://untrusted.invalid")
                .POST(HttpRequest.BodyPublishers.ofString("{}")).build();
            assertEquals(403, client.send(request, HttpResponse.BodyHandlers.ofString()).statusCode());
            assertEquals(0, writes.get());
        } finally {
            server.dispose();
        }
    }

    @Test
    public void when_authorizedCommentIsSubmitted_then_serveApi_should_WriteThroughJiraClient() throws Exception {
        AtomicInteger writes = new AtomicInteger();
        JiraClient jira = new JiraClient((method, path, body) -> {
            assertEquals("POST", method);
            assertEquals("issue/TEST-1/comment", path);
            assertEquals("Persisted comment", body.get("body").getAsString());
            writes.incrementAndGet();
            return "{\"id\":\"456\"}";
        });
        FrontendAssetServer server = new FrontendAssetServer(jira::execute);
        try (HttpClient client = HttpClient.newHttpClient()) {
            HttpRequest request = HttpRequest.newBuilder(URI.create(server.getUrl() + "api/jira"))
                .header("X-Jira-Session", URI.create(server.getSessionUrl()).getFragment())
                .POST(HttpRequest.BodyPublishers.ofString("{\"operation\":\"comment\",\"key\":\"TEST-1\",\"body\":\"Persisted comment\"}")).build();
            HttpResponse<String> response = client.send(request, HttpResponse.BodyHandlers.ofString());
            assertEquals(200, response.statusCode());
            assertEquals("{\"id\":\"456\"}", response.body());
            assertEquals(1, writes.get());
        } finally {
            server.dispose();
        }
    }
}
