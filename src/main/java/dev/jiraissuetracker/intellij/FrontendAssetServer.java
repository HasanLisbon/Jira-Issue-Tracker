package dev.jiraissuetracker.intellij;

import com.intellij.openapi.Disposable;
import com.google.gson.JsonObject;
import com.google.gson.JsonElement;
import com.google.gson.JsonParser;
import com.sun.net.httpserver.HttpExchange;
import com.sun.net.httpserver.HttpServer;

import java.io.IOException;
import java.io.InputStream;
import java.net.InetAddress;
import java.net.InetSocketAddress;
import java.nio.charset.StandardCharsets;
import java.security.MessageDigest;
import java.util.Locale;
import java.util.ResourceBundle;
import java.util.UUID;
import java.util.logging.Logger;

final class FrontendAssetServer implements Disposable {
    private final HttpServer server;
    private final String session = UUID.randomUUID().toString();
    private final ApiHandler api;

    interface ApiHandler {
        JsonElement execute(JsonObject request) throws Exception;
    }

    FrontendAssetServer() throws IOException {
        this(null);
    }

    FrontendAssetServer(ApiHandler api) throws IOException {
        this.api = api;
        server = HttpServer.create(new InetSocketAddress(InetAddress.getByName("127.0.0.1"), 0), 0);
        server.createContext("/api/jira", this::serveApi);
        server.createContext("/", this::serve);
        server.start();
    }

    String getUrl() {
        return "http://127.0.0.1:" + server.getAddress().getPort() + "/";
    }

    String getSessionUrl() {
        return getUrl() + "#" + session;
    }

    private void serveApi(HttpExchange exchange) throws IOException {
        try {
            String origin = exchange.getRequestHeaders().getFirst("Origin");
            String token = exchange.getRequestHeaders().getFirst("X-Jira-Session");
            String expectedOrigin = getUrl().substring(0, getUrl().length() - 1);
            if (!exchange.getRequestURI().getPath().equals("/api/jira")
                || !expectedOrigin.substring("http://".length()).equals(exchange.getRequestHeaders().getFirst("Host"))
                || origin != null && !origin.equals(expectedOrigin)
                || token == null || !MessageDigest.isEqual(session.getBytes(StandardCharsets.UTF_8), token.getBytes(StandardCharsets.UTF_8))) {
                respond(exchange, 403, "{}");
                return;
            }
            if (!exchange.getRequestMethod().equals("POST")) {
                exchange.getResponseHeaders().set("Allow", "POST");
                respond(exchange, 405, "{}");
                return;
            }
            byte[] bytes = exchange.getRequestBody().readNBytes(65_537);
            if (bytes.length > 65_536) {
                respond(exchange, 413, "{}");
                return;
            }
            if (api == null) {
                respond(exchange, 503, "{}");
                return;
            }
            JsonObject request = JsonParser.parseString(new String(bytes, StandardCharsets.UTF_8)).getAsJsonObject();
            JsonElement result = api.execute(request);
            respond(exchange, 200, result.toString());
        } catch (IllegalArgumentException exception) {
            JsonObject error = new JsonObject();
            ResourceBundle messages = ResourceBundle.getBundle("src");
            String message = messages.keySet().stream().map(messages::getString)
                .filter(value -> value.equals(exception.getMessage())).findFirst().orElse(messages.getString("request.invalid"));
            error.addProperty("error", message);
            respond(exchange, 400, error.toString());
        } catch (Exception exception) {
            if (exception instanceof InterruptedException) {
                Thread.currentThread().interrupt();
            }
            Logger.getLogger(FrontendAssetServer.class.getName()).warning("Jira operation failed: " + exception.getClass().getSimpleName());
            JsonObject error = new JsonObject();
            error.addProperty("error", ResourceBundle.getBundle("src").getString("operation.failed"));
            respond(exchange, 502, error.toString());
        } finally {
            exchange.close();
        }
    }

    private static void respond(HttpExchange exchange, int status, String json) throws IOException {
        byte[] bytes = json.getBytes(StandardCharsets.UTF_8);
        exchange.getResponseHeaders().set("Content-Type", "application/json; charset=utf-8");
        exchange.getResponseHeaders().set("Cache-Control", "no-store");
        exchange.getResponseHeaders().set("X-Content-Type-Options", "nosniff");
        exchange.sendResponseHeaders(status, bytes.length);
        exchange.getResponseBody().write(bytes);
    }

    private void serve(HttpExchange exchange) throws IOException {
        String method = exchange.getRequestMethod();
        if (!method.equals("GET") && !method.equals("HEAD")) {
            exchange.getResponseHeaders().set("Allow", "GET, HEAD");
            exchange.sendResponseHeaders(405, -1);
            exchange.close();
            return;
        }

        String path = exchange.getRequestURI().getPath();
        if (!isSafePath(path)) {
            exchange.sendResponseHeaders(404, -1);
            exchange.close();
            return;
        }
        String resourcePath = path.equals("/") ? "web/index.html" : "web/" + path.substring(1);

        try (InputStream resource = getClass().getClassLoader().getResourceAsStream(resourcePath)) {
            if (resource == null) {
                exchange.sendResponseHeaders(404, -1);
                exchange.close();
                return;
            }

            byte[] content = resource.readAllBytes();
            exchange.getResponseHeaders().set("Content-Type", contentType(resourcePath));
            exchange.getResponseHeaders().set("X-Content-Type-Options", "nosniff");
            exchange.getResponseHeaders().set("Cache-Control", "no-store");
            exchange.sendResponseHeaders(200, method.equals("HEAD") ? -1 : content.length);
            if (method.equals("GET")) {
                exchange.getResponseBody().write(content);
            }
        } finally {
            exchange.close();
        }
    }

    private static boolean isSafePath(String path) {
        if (path == null || !path.startsWith("/") || path.indexOf('\\') >= 0 || path.indexOf('\0') >= 0) {
            return false;
        }
        for (String segment : path.split("/")) {
            if (segment.equals(".") || segment.equals("..")) {
                return false;
            }
        }
        return true;
    }

    private static String contentType(String resourcePath) {
        String lowerPath = resourcePath.toLowerCase(Locale.ROOT);
        if (lowerPath.endsWith(".html")) return "text/html; charset=utf-8";
        if (lowerPath.endsWith(".js")) return "text/javascript; charset=utf-8";
        if (lowerPath.endsWith(".css")) return "text/css; charset=utf-8";
        if (lowerPath.endsWith(".svg")) return "image/svg+xml";
        if (lowerPath.endsWith(".png")) return "image/png";
        if (lowerPath.endsWith(".jpg") || lowerPath.endsWith(".jpeg")) return "image/jpeg";
        if (lowerPath.endsWith(".woff2")) return "font/woff2";
        if (lowerPath.endsWith(".ico")) return "image/x-icon";
        return "application/octet-stream";
    }

    @Override
    public void dispose() {
        server.stop(0);
    }
}
