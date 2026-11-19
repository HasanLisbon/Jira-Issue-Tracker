package dev.jiraissuetracker.intellij;

import com.google.gson.JsonArray;
import com.google.gson.JsonElement;
import com.google.gson.JsonObject;
import com.google.gson.JsonParser;

import java.net.URLEncoder;
import java.nio.charset.StandardCharsets;
import java.time.LocalDateTime;
import java.time.OffsetDateTime;
import java.time.ZoneId;
import java.time.format.DateTimeFormatter;
import java.util.HashSet;
import java.util.ResourceBundle;
import java.util.Set;
import java.util.regex.Pattern;

final class JiraClient {
    private static final ResourceBundle MESSAGES = ResourceBundle.getBundle("src");
    private static final Pattern KEY = Pattern.compile("[A-Z][A-Z0-9_]*-[0-9]+");
    private static final Pattern DURATION = Pattern.compile("(?:(\\d+)h)?\\s*(?:(\\d+)m)?");
    private final Transport transport;
    private final ZoneId systemZone;

    interface Transport {
        String request(String method, String path, JsonObject body) throws Exception;
    }

    JiraClient(Transport transport) {
        this(transport, ZoneId.systemDefault());
    }

    JiraClient(Transport transport, ZoneId systemZone) {
        this.transport = transport;
        this.systemZone = systemZone;
    }

    JsonElement execute(JsonObject request) throws Exception {
        String operation = required(request, "operation");
        if (operation.equals("search")) {
            String query = required(request, "query");
            String filter = request.has("filter") ? request.get("filter").getAsString() : "all";
            query = filteredQuery(query, filter);
            String sprintField = "";
            for (JsonElement field : read("field").getAsJsonArray()) {
                JsonObject definition = field.getAsJsonObject();
                if (definition.has("schema") && definition.get("schema").isJsonObject()
                    && definition.getAsJsonObject("schema").has("custom")
                    && "com.pyxis.greenhopper.jira:gh-sprint".equals(definition.getAsJsonObject("schema").get("custom").getAsString())) {
                    String id = definition.get("id").getAsString();
                    if (!id.matches("customfield_[0-9]+")) throw invalid("response.incomplete");
                    sprintField = "," + id;
                    break;
                }
            }
            return pages("search?jql=" + encode(query)
                + "&fields=summary,status,parent,issuetype,priority,assignee,reporter,timetracking,fixVersions,components,project,description,resolution,subtasks,labels,created,updated" + sprintField, "issues");
        }
        if (operation.equals("myself")) {
            return read("myself");
        }
        String key = required(request, "key");
        if (!KEY.matcher(key).matches()) {
            throw invalid("request.invalid");
        }
        String issuePath = "issue/" + key;
        return switch (operation) {
            case "issue" -> read(issuePath);
            case "comments" -> pages(issuePath + "/comment", "comments");
            case "worklogs" -> pages(issuePath + "/worklog", "worklogs");
            case "transitions" -> read(issuePath + "/transitions");
            case "transition" -> transition(issuePath, request);
            case "comment" -> comment(issuePath, request);
            case "worklog" -> worklog(issuePath, request);
            case "devBranches" -> devBranches(issuePath);
            default -> throw invalid("request.invalid");
        };
    }

    private JsonElement devBranches(String issuePath) throws Exception {
        String id = read(issuePath).getAsJsonObject().get("id").getAsString();
        if (!id.matches("[0-9]+")) throw invalid("response.incomplete");
        JsonObject summary = read("dev-status/summary?issueId=" + id).getAsJsonObject().getAsJsonObject("summary");
        JsonObject branch = summary == null ? null : summary.getAsJsonObject("branch");
        JsonArray branches = new JsonArray();
        if (branch == null || !branch.has("byInstanceType") || !branch.get("byInstanceType").isJsonObject()) return branches;
        for (String type : branch.getAsJsonObject("byInstanceType").keySet()) {
            if (!type.matches("[A-Za-z0-9_-]+")) throw invalid("response.incomplete");
            JsonObject detail = read("dev-status/issue/detail?issueId=" + id + "&applicationType=" + type
                + "&dataType=branch").getAsJsonObject();
            for (JsonElement entry : detail.getAsJsonArray("detail")) {
                for (JsonElement element : entry.getAsJsonObject().getAsJsonArray("branches")) {
                    JsonObject source = element.getAsJsonObject();
                    JsonObject repository = source.has("repository") && source.get("repository").isJsonObject()
                        ? source.getAsJsonObject("repository") : new JsonObject();
                    JsonObject item = new JsonObject();
                    item.add("name", source.get("name"));
                    item.add("repositoryUrl", repository.has("url") ? repository.get("url") : source.get("url"));
                    branches.add(item);
                }
            }
        }
        return branches;
    }

    private JsonElement transition(String issuePath, JsonObject request) throws Exception {
        String id = required(request, "transitionId");
        JsonArray transitions = read(issuePath + "/transitions").getAsJsonObject().getAsJsonArray("transitions");
        boolean available = false;
        for (JsonElement transition : transitions) {
            if (id.equals(transition.getAsJsonObject().get("id").getAsString())) {
                available = true;
            }
        }
        if (!available) {
            throw invalid("transition.invalid");
        }
        JsonObject transition = new JsonObject();
        transition.addProperty("id", id);
        JsonObject body = new JsonObject();
        body.add("transition", transition);
        transport.request("POST", issuePath + "/transitions", body);
        return new JsonObject();
    }

    private JsonElement comment(String issuePath, JsonObject request) throws Exception {
        String text = required(request, "body");
        if (request.has("replyTo") && !request.get("replyTo").isJsonNull()) {
            String replyTo = required(request, "replyTo");
            if (!replyTo.matches("[0-9]+")) {
                throw invalid("request.invalid");
            }
            JsonObject original = read(issuePath + "/comment/" + replyTo).getAsJsonObject();
            if (!replyTo.equals(original.get("id").getAsString())) {
                throw invalid("reply.missing");
            }
            text = "[Reply to comment " + replyTo + "|#comment-" + replyTo + "]\n" + text;
        }
        JsonObject body = new JsonObject();
        body.addProperty("body", text);
        return JsonParser.parseString(transport.request("POST", issuePath + "/comment", body));
    }

    private JsonElement worklog(String issuePath, JsonObject request) throws Exception {
        var duration = DURATION.matcher(required(request, "duration"));
        if (!duration.matches() || duration.group(1) == null && duration.group(2) == null) {
            throw invalid("duration.invalid");
        }
        long seconds;
        try {
            long hours = duration.group(1) == null ? 0 : Long.parseLong(duration.group(1));
            long minutes = duration.group(2) == null ? 0 : Long.parseLong(duration.group(2));
            seconds = Math.addExact(Math.multiplyExact(hours, 3600), Math.multiplyExact(minutes, 60));
        } catch (ArithmeticException exception) {
            throw invalid("duration.invalid");
        }
        if (seconds <= 0 || seconds > Integer.MAX_VALUE) {
            throw invalid("duration.invalid");
        }
        String rawStarted = required(request, "started");
        OffsetDateTime started = (rawStarted.endsWith("Z") || rawStarted.matches(".*[+-]\\d{2}:?\\d{2}$"))
                ? OffsetDateTime.parse(rawStarted)
                : LocalDateTime.parse(rawStarted).atZone(systemZone).toOffsetDateTime();
        JsonObject body = new JsonObject();
        body.addProperty("timeSpentSeconds", seconds);
        body.addProperty("started", started.format(DateTimeFormatter.ofPattern("yyyy-MM-dd'T'HH:mm:ss.SSSxx")));
        body.addProperty("comment", request.has("body") ? request.get("body").getAsString() : "");
        return JsonParser.parseString(transport.request("POST", issuePath + "/worklog?adjustEstimate=leave", body));
    }

    private JsonArray pages(String path, String collection) throws Exception {
        JsonArray results = new JsonArray();
        Set<String> identifiers = new HashSet<>();
        int offset = 0;
        int total;
        do {
            if (Thread.currentThread().isInterrupted()) {
                throw new InterruptedException();
            }
            JsonObject page = read(path + (path.contains("?") ? "&" : "?") + "startAt=" + offset + "&maxResults=100").getAsJsonObject();
            total = page.get("total").getAsBigDecimal().intValueExact();
            JsonArray entries = page.getAsJsonArray(collection);
            if (page.get("startAt").getAsInt() != offset || total < offset || entries == null
                || entries.isEmpty() && offset < total) {
                throw invalid("response.incomplete");
            }
            for (JsonElement entry : entries) {
                String id = entry.getAsJsonObject().get("id").getAsString();
                if (!identifiers.add(id)) {
                    throw invalid("response.incomplete");
                }
                results.add(entry);
            }
            offset = Math.addExact(offset, entries.size());
            if (offset > total) {
                throw invalid("response.incomplete");
            }
        } while (offset < total);
        return results;
    }

    private JsonElement read(String path) throws Exception {
        return JsonParser.parseString(transport.request("GET", path, null));
    }

    private static String filteredQuery(String base, String filter) {
        String clause = switch (filter) {
            case "all" -> "";
            case "assigned" -> "assignee = currentUser()";
            case "reported" -> "reporter = currentUser()";
            case "recent" -> "updated >= -7d";
            case "sprint" -> "sprint in openSprints()";
            default -> throw invalid("request.invalid");
        };
        if (clause.isEmpty()) return base;
        char quote = 0;
        int depth = 0;
        for (int i = 0; i < base.length(); i++) {
            char character = base.charAt(i);
            if (character == '\\') {
                i++;
            } else if (quote != 0) {
                if (character == quote) quote = 0;
            } else if (character == '\'' || character == '"') {
                quote = character;
            } else if (character == '(') {
                depth++;
            } else if (character == ')') {
                depth--;
            } else if (depth == 0 && (i == 0 || Character.isWhitespace(base.charAt(i - 1)))
                && base.substring(i).matches("(?is)ORDER\\s+BY\\b.*")) {
                String condition = base.substring(0, i).trim();
                return (condition.isEmpty() ? "" : "(" + condition + ") AND ") + "(" + clause + ") " + base.substring(i);
            }
        }
        return "(" + base + ") AND (" + clause + ")";
    }

    private static String encode(String value) {
        return URLEncoder.encode(value, StandardCharsets.UTF_8);
    }

    private static String required(JsonObject request, String key) {
        if (!request.has(key) || !request.get(key).isJsonPrimitive()
            || !request.getAsJsonPrimitive(key).isString() || request.get(key).getAsString().isBlank()) {
            throw invalid("request.invalid");
        }
        return request.get(key).getAsString().trim();
    }

    private static IllegalArgumentException invalid(String key) {
        return new IllegalArgumentException(MESSAGES.getString(key));
    }
}
