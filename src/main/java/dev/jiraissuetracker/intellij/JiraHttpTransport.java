package dev.jiraissuetracker.intellij;

import com.google.gson.JsonElement;
import com.google.gson.JsonObject;
import com.google.gson.JsonParseException;
import com.google.gson.JsonParser;

import javax.net.ssl.SSLHandshakeException;
import java.io.IOException;
import java.net.URI;
import java.net.http.HttpClient;
import java.net.http.HttpRequest;
import java.net.http.HttpResponse;
import java.net.http.HttpTimeoutException;
import java.nio.charset.StandardCharsets;
import java.time.Duration;
import java.util.Base64;
import java.util.ArrayList;
import java.util.List;
import java.util.Locale;
import java.util.ResourceBundle;
import java.util.logging.Logger;

final class JiraHttpTransport implements JiraClient.Transport {
    private static final ResourceBundle MESSAGES = ResourceBundle.getBundle("src");
    private final HttpClient client;
    private final String baseUrl;
    private final String devStatusUrl;
    private final String authorization;
    private final List<String> protectedValues;

    JiraHttpTransport(HttpClient client, String url, String username, String secret, boolean bearer) {
        this.client = client;
        String root = normalizeUrl(url);
        baseUrl = root + "/rest/api/2/";
        devStatusUrl = root + "/rest/dev-status/latest/";
        if (!bearer && (username == null || username.isBlank() || username.contains(":"))) {
            throw invalid("settings.username.invalid");
        }
        if (secret == null || secret.isEmpty() || secret.contains("\r") || secret.contains("\n")) {
            throw invalid("settings.secret.required");
        }
        authorization = bearer ? "Bearer " + secret : "Basic " + Base64.getEncoder()
            .encodeToString((username + ":" + secret).getBytes(StandardCharsets.UTF_8));
        protectedValues = List.of(authorization, authorization.substring(authorization.indexOf(' ') + 1),
            secret, username == null ? "" : username);
    }

    static String normalizeUrl(String value) {
        URI uri;
        try {
            uri = URI.create(value.trim().replaceAll("/+$", ""));
        } catch (IllegalArgumentException exception) {
            throw invalid("settings.url.invalid");
        }
        if (!("https".equalsIgnoreCase(uri.getScheme()) || "http".equalsIgnoreCase(uri.getScheme()))
            || uri.getHost() == null || uri.getUserInfo() != null || uri.getRawQuery() != null || uri.getRawFragment() != null
            || uri.getPath().contains("/rest/") || !uri.normalize().equals(uri)) {
            throw invalid("settings.url.invalid");
        }
        if (uri.getHost().toLowerCase(Locale.ROOT).endsWith(".atlassian.net")) throw invalid("cloud.unsupported");
        return uri.toASCIIString().replaceAll("/+$", "");
    }

    @Override
    public String request(String method, String path, JsonObject body) throws Exception {
        String resourcePath = path.split("\\?", 2)[0];
        if (resourcePath.startsWith("/") || resourcePath.contains(":") || resourcePath.contains("..")) throw invalid("request.invalid");
        String target = path.startsWith("dev-status/") ? devStatusUrl + path.substring("dev-status/".length()) : baseUrl + path;
        HttpRequest.Builder request = HttpRequest.newBuilder(URI.create(target))
            .timeout(Duration.ofSeconds(30)).header("Accept", "application/json").header("Authorization", authorization);
        if ("POST".equals(method)) {
            request.header("Content-Type", "application/json; charset=UTF-8")
                .POST(HttpRequest.BodyPublishers.ofString(body.toString(), StandardCharsets.UTF_8));
        } else if ("GET".equals(method)) {
            request.GET();
        } else {
            throw invalid("request.invalid");
        }
        HttpResponse<String> response;
        try {
            response = client.send(request.build(), HttpResponse.BodyHandlers.ofString(StandardCharsets.UTF_8));
        } catch (HttpTimeoutException exception) {
            throw invalid("connection.timeout");
        } catch (SSLHandshakeException exception) {
            throw invalid("connection.tls");
        } catch (IOException exception) {
            throw invalid("connection.network");
        }
        int status = response.statusCode();
        if (status < 200 || status >= 300) {
            Logger.getLogger(JiraHttpTransport.class.getName()).warning("Jira HTTP response status: " + status
                + "; " + method + " " + resourcePath.replaceFirst("^issue/[^/]+", "issue/{issue}")
                    .replaceAll("/[0-9]+(?=/|$)", "/{id}") + errorDetails(response, body));
            throw invalid(switch (status) {
                case 401 -> "connection.unauthorized";
                case 403 -> "connection.forbidden";
                case 407 -> "connection.proxy";
                case 429 -> "connection.rate.limited";
                default -> status >= 300 && status < 400 ? "connection.redirect" : "connection.http.failed";
            });
        }
        if (status != 204 && !response.headers().firstValue("Content-Type").orElse("")
            .toLowerCase(Locale.ROOT).contains("application/json")) throw invalid("connection.not.json");
        return response.body();
    }

    private String errorDetails(HttpResponse<String> response, JsonObject requestBody) {
        if (!response.headers().firstValue("Content-Type").orElse("").toLowerCase(Locale.ROOT).contains("application/json")
            || response.body() == null || response.body().length() > 65_536) {
            return "; Jira error details omitted (non-JSON or oversized response)";
        }
        JsonElement parsed;
        try {
            parsed = JsonParser.parseString(response.body());
        } catch (JsonParseException exception) {
            return "; Jira error details omitted (invalid JSON)";
        }
        if (!parsed.isJsonObject()) return "; Jira error details unavailable";
        List<String> details = new ArrayList<>();
        JsonObject error = parsed.getAsJsonObject();
        if (error.has("errorMessages") && error.get("errorMessages").isJsonArray()) {
            for (JsonElement message : error.getAsJsonArray("errorMessages")) {
                if (message.isJsonPrimitive() && message.getAsJsonPrimitive().isString()) details.add(message.getAsString());
                if (details.size() >= 3) break;
            }
        }
        if (error.has("errors") && error.get("errors").isJsonObject()) {
            for (var entry : error.getAsJsonObject("errors").entrySet()) {
                if (details.size() >= 6) break;
                if (entry.getValue().isJsonPrimitive() && entry.getValue().getAsJsonPrimitive().isString()) {
                    details.add(entry.getKey() + ": " + entry.getValue().getAsString());
                }
            }
        }
        if (details.isEmpty()) return "; Jira error details unavailable";
        String diagnostic = String.join("; ", details);
        for (String value : protectedValues) {
            if (!value.isEmpty()) diagnostic = diagnostic.replace(value, "[redacted]");
        }
        if (requestBody != null) {
            for (JsonElement value : requestBody.asMap().values()) {
                if (value.isJsonPrimitive() && value.getAsJsonPrimitive().isString() && !value.getAsString().isEmpty()) {
                    diagnostic = diagnostic.replace(value.getAsString(), "[redacted]");
                }
            }
        }
        diagnostic = diagnostic.replaceAll("[\\p{Cntrl}\\p{Cf}\\p{Zl}\\p{Zp}]", " ")
            .replaceAll("(?i)\\b(?:https?://|www\\.)\\S+", "[redacted]")
            .replaceAll("[A-Za-z0-9._%+-]+@[A-Za-z0-9.-]+\\.[A-Za-z]{2,}", "[redacted]")
            .replaceAll("(?i)\\b(?:password|token|secret|authorization|cookie)\\s*[:=]\\s*(?:(?:Bearer|Basic)\\s+)?\\S+", "[redacted]")
            .replaceAll("(?i)\\b(?:Bearer|Basic)\\s+\\S+", "[redacted]");
        return "; Jira errors: " + diagnostic.substring(0, Math.min(diagnostic.length(), 512));
    }

    private static IllegalArgumentException invalid(String key) {
        return new IllegalArgumentException(MESSAGES.getString(key));
    }
}
