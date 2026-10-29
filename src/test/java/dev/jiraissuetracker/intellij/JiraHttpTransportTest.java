package dev.jiraissuetracker.intellij;

import com.google.gson.JsonObject;
import com.sun.net.httpserver.HttpServer;
import org.junit.Test;

import java.net.InetSocketAddress;
import java.net.URI;
import java.net.http.HttpClient;
import java.net.http.HttpRequest;
import java.net.http.HttpResponse;
import java.nio.charset.StandardCharsets;
import java.util.Base64;
import java.util.ArrayList;
import java.util.List;
import java.util.ResourceBundle;
import java.util.concurrent.atomic.AtomicInteger;
import java.util.concurrent.atomic.AtomicReference;
import java.util.logging.Handler;
import java.util.logging.LogRecord;
import java.util.logging.Logger;

import static org.junit.Assert.*;

public class JiraHttpTransportTest {
    @Test
    public void when_basicCredentialsAreConfigured_then_request_should_UseContextPathAndReturnJiraIdentity() throws Exception {
        AtomicReference<String> authorization = new AtomicReference<>();
        AtomicReference<String> requestPath = new AtomicReference<>();
        HttpServer server = HttpServer.create(new InetSocketAddress("127.0.0.1", 0), 0);
        server.createContext("/", exchange -> {
            authorization.set(exchange.getRequestHeaders().getFirst("Authorization"));
            requestPath.set(exchange.getRequestURI().toString());
            byte[] response = "{\"name\":\"test-user\"}".getBytes(StandardCharsets.UTF_8);
            exchange.getResponseHeaders().set("Content-Type", "application/json;charset=UTF-8");
            exchange.sendResponseHeaders(200, response.length);
            exchange.getResponseBody().write(response);
            exchange.close();
        });
        server.start();
        try (HttpClient http = HttpClient.newHttpClient()) {
            JiraClient client = new JiraClient(new JiraHttpTransport(http, url(server) + "/jira/", "test-user", "test-password", false));
            JsonObject request = new JsonObject();
            request.addProperty("operation", "myself");
            assertEquals("test-user", client.execute(request).getAsJsonObject().get("name").getAsString());
            assertEquals("/jira/rest/api/2/myself", requestPath.get());
            assertEquals("Basic " + Base64.getEncoder().encodeToString("test-user:test-password".getBytes(StandardCharsets.UTF_8)), authorization.get());
        } finally {
            server.stop(0);
        }
    }

    @Test
    public void when_bearerCommentIsSubmitted_then_request_should_SendJsonExactlyOnce() throws Exception {
        AtomicInteger writes = new AtomicInteger();
        AtomicReference<String> authorization = new AtomicReference<>();
        AtomicReference<String> body = new AtomicReference<>();
        HttpServer server = HttpServer.create(new InetSocketAddress("127.0.0.1", 0), 0);
        server.createContext("/rest/api/2/issue/TEST-1/comment", exchange -> {
            writes.incrementAndGet();
            authorization.set(exchange.getRequestHeaders().getFirst("Authorization"));
            body.set(new String(exchange.getRequestBody().readAllBytes(), StandardCharsets.UTF_8));
            byte[] response = "{\"id\":\"42\"}".getBytes(StandardCharsets.UTF_8);
            exchange.getResponseHeaders().set("Content-Type", "application/json");
            exchange.sendResponseHeaders(201, response.length);
            exchange.getResponseBody().write(response);
            exchange.close();
        });
        server.start();
        try (HttpClient http = HttpClient.newHttpClient()) {
            JiraClient client = new JiraClient(new JiraHttpTransport(http, url(server), "", "test-token", true));
            JsonObject request = new JsonObject();
            request.addProperty("operation", "comment");
            request.addProperty("key", "TEST-1");
            request.addProperty("body", "Test comment");
            assertEquals("42", client.execute(request).getAsJsonObject().get("id").getAsString());
            assertEquals("Bearer test-token", authorization.get());
            assertEquals("{\"body\":\"Test comment\"}", body.get());
            assertEquals(1, writes.get());
        } finally {
            server.stop(0);
        }
    }

    @Test
    public void when_jiraRejectsOrRedirectsRequest_then_request_should_ReportSafeDistinctErrorWithoutRetry() throws Exception {
        int[] statuses = {401, 403, 407, 429, 302, 500, 200};
        String[] keys = {"connection.unauthorized", "connection.forbidden", "connection.proxy", "connection.rate.limited",
            "connection.redirect", "connection.http.failed", "connection.not.json"};
        for (int i = 0; i < statuses.length; i++) {
            int status = statuses[i];
            AtomicInteger requests = new AtomicInteger();
            HttpServer server = HttpServer.create(new InetSocketAddress("127.0.0.1", 0), 0);
            server.createContext("/", exchange -> {
                requests.incrementAndGet();
                exchange.getResponseHeaders().set("Location", "/login");
                exchange.getResponseHeaders().set("Content-Type", "text/html");
                byte[] response = "Sensitive server details".getBytes(StandardCharsets.UTF_8);
                exchange.sendResponseHeaders(status, response.length);
                exchange.getResponseBody().write(response);
                exchange.close();
            });
            server.start();
            try (HttpClient http = HttpClient.newHttpClient()) {
                JiraHttpTransport transport = new JiraHttpTransport(http, url(server), "test-user", "test-password", false);
                IllegalArgumentException failure = assertThrows(IllegalArgumentException.class,
                    () -> transport.request("POST", "issue/TEST-1/transitions", new JsonObject()));
                assertEquals(ResourceBundle.getBundle("src").getString(keys[i]), failure.getMessage());
                assertEquals(1, requests.get());
            } finally {
                server.stop(0);
            }
        }
    }

    @Test
    public void when_transitionReturnsNoContent_then_request_should_AcceptSuccessfulWrite() throws Exception {
        HttpServer server = HttpServer.create(new InetSocketAddress("127.0.0.1", 0), 0);
        server.createContext("/", exchange -> {
            exchange.sendResponseHeaders(204, -1);
            exchange.close();
        });
        server.start();
        try (HttpClient http = HttpClient.newHttpClient()) {
            JiraHttpTransport transport = new JiraHttpTransport(http, url(server), "test-user", "test-password", false);
            assertEquals("", transport.request("POST", "issue/TEST-1/transitions", new JsonObject()));
        } finally {
            server.stop(0);
        }
    }

    @Test
    public void when_urlContainsCredentialsOrApiPath_then_normalizeUrl_should_RejectUnsafeConfiguration() {
        for (String url : new String[]{"", "file:///test", "https://test-user:test-password@jira.invalid", "https://jira.invalid?token=test",
            "https://jira.invalid/#fragment", "https://jira.invalid/rest/api/2", "https://jira.invalid/jira/../other", "https://test.atlassian.net"}) {
            assertThrows(IllegalArgumentException.class, () -> JiraHttpTransport.normalizeUrl(url));
        }
        assertEquals("https://jira.invalid/jira", JiraHttpTransport.normalizeUrl(" https://jira.invalid/jira/// "));
    }

    @Test
    public void when_worklogIsRejected_then_request_should_LogSanitizedJiraErrorsWithoutRetry() throws Exception {
        assertWorklogFailureLog(400, "application/json",
            "{\"errorMessages\":[\"Invalid request for test-user using test-token\",\"Test description\\nnext line\"],"
                + "\"errors\":{\"started\":\"Invalid timestamp\"},\"stackTrace\":\"Private server stack\"}",
            "Invalid request for [redacted] using [redacted]", "[redacted] next line", "started: Invalid timestamp");
        assertWorklogFailureLog(500, "application/json",
            "{\"errorMessages\":[\"Cannot parse timestamp\"],\"errors\":{}}", "Cannot parse timestamp");
    }

    @Test
    public void when_jiraErrorIsUnsafeOrMalformed_then_request_should_LogOnlyBoundedDiagnostics() throws Exception {
        for (String response : List.of("", "<html>Private server stack</html>", "not JSON", "[]", "{}",
            "{\"errorMessages\":{},\"errors\":[]}", "x".repeat(65_537))) {
            assertWorklogFailureLog(500, "text/html", response);
            assertWorklogFailureLog(500, "application/json", response);
        }
        assertWorklogFailureLog(500, "application/json",
            "{\"errorMessages\":[\"test@example.invalid https://jira.invalid/private Bearer test-token\\r\\n"
                + "x".repeat(2000) + "\"]}", "[redacted] [redacted] [redacted]");
        assertWorklogFailureLog(500, "application/json",
            "{\"errorMessages\":[\"Authorization: Bearer other-token password=other-password Basic other-encoded\"]}",
            "[redacted] [redacted] [redacted]");
    }

    private static void assertWorklogFailureLog(int status, String contentType, String responseBody,
                                               String... expectedDetails) throws Exception {
        AtomicInteger requests = new AtomicInteger();
        List<String> logs = new ArrayList<>();
        Logger logger = Logger.getLogger(JiraHttpTransport.class.getName());
        Handler handler = new Handler() {
            @Override
            public void publish(LogRecord record) { logs.add(record.getMessage()); }
            @Override
            public void flush() {}
            @Override
            public void close() {}
        };
        HttpServer server = HttpServer.create(new InetSocketAddress("127.0.0.1", 0), 0);
        server.createContext("/rest/api/2/issue/TEST-1/worklog", exchange -> {
            requests.incrementAndGet();
            byte[] response = responseBody.getBytes(StandardCharsets.UTF_8);
            exchange.getResponseHeaders().set("Content-Type", contentType);
            exchange.sendResponseHeaders(status, response.length);
            exchange.getResponseBody().write(response);
            exchange.close();
        });
        server.start();
        logger.addHandler(handler);
        try (HttpClient http = HttpClient.newHttpClient()) {
            JiraHttpTransport transport = new JiraHttpTransport(http, url(server), "test-user", "test-token", true);
            FrontendAssetServer bridge = new FrontendAssetServer(new JiraClient(transport)::execute);
            try {
                HttpRequest request = HttpRequest.newBuilder(URI.create(bridge.getUrl() + "api/jira"))
                    .header("X-Jira-Session", URI.create(bridge.getSessionUrl()).getFragment())
                    .POST(HttpRequest.BodyPublishers.ofString("{\"operation\":\"worklog\",\"key\":\"TEST-1\","
                        + "\"duration\":\"1m\",\"started\":\"2026-10-28T22:59:00+02:00\",\"body\":\"Test description\"}")).build();
                HttpResponse<String> response = http.send(request, HttpResponse.BodyHandlers.ofString());
                assertEquals(400, response.statusCode());
                JsonObject error = com.google.gson.JsonParser.parseString(response.body()).getAsJsonObject();
                assertEquals(ResourceBundle.getBundle("src").getString("connection.http.failed"), error.get("error").getAsString());
            } finally {
                bridge.dispose();
            }
            assertEquals(1, requests.get());
            assertEquals(1, logs.size());
            String diagnostic = logs.get(0);
            assertTrue(diagnostic.contains("Jira HTTP response status: " + status));
            assertTrue(diagnostic.contains("POST issue/{issue}/worklog"));
            for (String detail : expectedDetails) assertTrue(diagnostic, diagnostic.contains(detail));
            for (String sensitive : List.of("test-user", "test-token", "Test description", "Private server stack",
                "test@example.invalid", "https://jira.invalid/private", "TEST-1", "adjustEstimate", "\r", "\n")) {
                assertFalse(diagnostic, diagnostic.contains(sensitive));
            }
            for (String sensitive : List.of("other-token", "other-password", "other-encoded")) {
                assertFalse(diagnostic, diagnostic.contains(sensitive));
            }
            assertTrue(diagnostic.length() <= 650);
        } finally {
            logger.removeHandler(handler);
            server.stop(0);
        }
    }

    private static String url(HttpServer server) {
        return "http://127.0.0.1:" + server.getAddress().getPort();
    }

    @Test
    public void when_frontendSubmitsAuthorizedRequest_then_serveApi_should_ReachDirectJiraTransportWithoutExposingCredentials() throws Exception {
        AtomicInteger requests = new AtomicInteger();
        AtomicReference<String> authorization = new AtomicReference<>();
        HttpServer jiraServer = HttpServer.create(new InetSocketAddress("127.0.0.1", 0), 0);
        jiraServer.createContext("/rest/api/2/myself", exchange -> {
            requests.incrementAndGet();
            authorization.set(exchange.getRequestHeaders().getFirst("Authorization"));
            byte[] response = "{\"name\":\"test-user\"}".getBytes(StandardCharsets.UTF_8);
            exchange.getResponseHeaders().set("Content-Type", "application/json");
            exchange.sendResponseHeaders(200, response.length);
            exchange.getResponseBody().write(response);
            exchange.close();
        });
        jiraServer.start();
        try (HttpClient http = HttpClient.newHttpClient()) {
            JiraClient jira = new JiraClient(new JiraHttpTransport(http, url(jiraServer), "", "test-token", true));
            FrontendAssetServer bridge = new FrontendAssetServer(jira::execute);
            try {
                HttpRequest request = HttpRequest.newBuilder(URI.create(bridge.getUrl() + "api/jira"))
                    .header("X-Jira-Session", URI.create(bridge.getSessionUrl()).getFragment())
                    .POST(HttpRequest.BodyPublishers.ofString("{\"operation\":\"myself\"}")).build();
                HttpResponse<String> response = http.send(request, HttpResponse.BodyHandlers.ofString());
                assertEquals(200, response.statusCode());
                assertEquals("{\"name\":\"test-user\"}", response.body());
                assertFalse(response.body().contains("test-token"));
                assertEquals("Bearer test-token", authorization.get());
                assertEquals(1, requests.get());
            } finally {
                bridge.dispose();
            }
        } finally {
            jiraServer.stop(0);
        }
    }
}
