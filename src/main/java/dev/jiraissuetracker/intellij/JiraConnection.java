package dev.jiraissuetracker.intellij;

import com.google.gson.JsonArray;
import com.google.gson.JsonElement;
import com.google.gson.JsonObject;
import com.intellij.openapi.application.ApplicationManager;
import com.intellij.openapi.options.ShowSettingsUtil;
import com.intellij.openapi.project.Project;
import com.intellij.util.net.ssl.CertificateManager;

import java.net.ProxySelector;
import java.net.http.HttpClient;
import java.time.Duration;
import java.util.List;
import java.util.ResourceBundle;

final class JiraConnection {
    private static final ResourceBundle MESSAGES =
            ResourceBundle.getBundle("src");

    private final Project project;

    JiraConnection(Project project) {
        this.project = project;
    }

    JsonElement execute(JsonObject request) throws Exception {
        if (project.isDisposed()) {
            throw new IllegalStateException(
                    MESSAGES.getString("connection.missing")
            );
        }

        String operation =
                request.get("operation").getAsString();

        if (operation.equals("branchDiagnostics")) {
            java.util.logging.Logger.getLogger(JiraConnection.class.getName()).info(
                    "Branch card snapshot: project=" + project.getBasePath() + ", cards=" + request.get("cards"));
            return new JsonObject();
        }

        if (operation.equals("branches") || operation.equals("createBranch") || operation.equals("remotes")) {
            if (operation.equals("branches")) {
                java.util.logging.Logger.getLogger(JiraConnection.class.getName()).info(
                        "Branch lookup request: project=" + project.getBasePath() + ", key=" + request.get("key")
                                + ", issueKeys=" + request.get("issueKeys"));
            }
            return new GitBranches(project).execute(request);
        }

        if (operation.equals("configure")) {
            ApplicationManager.getApplication().invokeLater(() -> {
                if (!project.isDisposed()) {
                    ShowSettingsUtil.getInstance()
                            .showSettingsDialog(
                                    project,
                                    JiraSettingsConfigurable.class
                            );
                }
            });

            return new JsonObject();
        }

        JiraSettings settings = JiraSettings.getInstance();
        JiraSettings.SettingsState settingsState = settings.getState();
        List<JiraSettings.ConnectionState> configured = settingsState.servers;

        if (operation.equals("connections")) {
            JsonArray connections = new JsonArray();

            for (JiraSettings.ConnectionState server : configured) {
                JsonObject connection = new JsonObject();
                connection.addProperty("id", server.id);
                connection.addProperty("name", server.name);
                connection.addProperty("url", server.url);
                connection.addProperty("query", server.query);
                connection.addProperty(
                        "commitMessageTemplate",
                        settingsState.commitMessageTemplate
                );
                connections.add(connection);
            }

            return connections;
        }

        if (operation.equals("saveTeamsConfig")) {
            String icsUrl = request.has("icsUrl") && !request.get("icsUrl").isJsonNull()
                    ? request.get("icsUrl").getAsString()
                    : "";
            boolean useGraph = request.has("useGraph")
                    && !request.get("useGraph").isJsonNull()
                    && request.get("useGraph").getAsBoolean();
            String graphToken = request.has("graphToken") && !request.get("graphToken").isJsonNull()
                    ? request.get("graphToken").getAsString()
                    : "";
            settings.saveTeamsConfig(icsUrl, useGraph, graphToken);
            return buildTeamsResponse(settings, settings.getState(), false);
        }

        if (operation.equals("saveMeetingMapping")) {
            String matchKey = request.has("matchKey") && !request.get("matchKey").isJsonNull()
                    ? request.get("matchKey").getAsString()
                    : "";
            String matchType = request.has("matchType") && !request.get("matchType").isJsonNull()
                    ? request.get("matchType").getAsString()
                    : "series";
            String meetingTitle = request.has("meetingTitle") && !request.get("meetingTitle").isJsonNull()
                    ? request.get("meetingTitle").getAsString()
                    : "";
            String issueKey = request.has("issueKey") && !request.get("issueKey").isJsonNull()
                    ? request.get("issueKey").getAsString()
                    : "";
            String issueTitle = request.has("issueTitle") && !request.get("issueTitle").isJsonNull()
                    ? request.get("issueTitle").getAsString()
                    : "";
            settings.saveMeetingMapping(matchKey, matchType, meetingTitle, issueKey, issueTitle);
            return serializeMappings(settings.getState().meetingMappings);
        }

        if (operation.equals("teamsMeetings")) {
            boolean sync = !request.has("sync")
                    || request.get("sync").isJsonNull()
                    || request.get("sync").getAsBoolean();
            return buildTeamsResponse(settings, settingsState, sync);
        }

        String repositoryId =
                request.get("repositoryId").getAsString();

        JiraSettings.ConnectionState selected = configured.stream()
                .filter(server -> server.id.equals(repositoryId))
                .findFirst()
                .orElseThrow(() -> new IllegalArgumentException(
                        MESSAGES.getString("connection.missing")
                ));

        String secret = settings.secret(selected);

        try (HttpClient client = httpClient()) {
            return new JiraClient(
                    new JiraHttpTransport(
                            client,
                            selected.url,
                            selected.username,
                            secret,
                            selected.bearer
                    )
            ).execute(request);
        }
    }

    static HttpClient httpClient() {
        HttpClient.Builder builder = HttpClient.newBuilder()
                .connectTimeout(Duration.ofSeconds(15))
                .followRedirects(HttpClient.Redirect.NEVER)
                .sslContext(
                        CertificateManager.getInstance().getSslContext()
                );

        ProxySelector proxy = ProxySelector.getDefault();

        if (proxy != null) {
            builder.proxy(proxy);
        }

        return builder.build();
    }

    static HttpClient teamsHttpClient() {
        HttpClient.Builder builder = HttpClient.newBuilder()
                .connectTimeout(Duration.ofSeconds(15))
                .followRedirects(HttpClient.Redirect.NORMAL)
                .sslContext(
                        CertificateManager.getInstance().getSslContext()
                );

        ProxySelector proxy = ProxySelector.getDefault();

        if (proxy != null) {
            builder.proxy(proxy);
        }

        return builder.build();
    }

    private static JsonObject buildTeamsResponse(
            JiraSettings settings,
            JiraSettings.SettingsState state,
            boolean sync
    ) throws Exception {
        boolean hasToken = settings.hasTeamsGraphToken();
        boolean configured = state.teamsUseGraph
                ? hasToken
                : (state.teamsIcsUrl != null && !state.teamsIcsUrl.isBlank());

        JsonObject response = new JsonObject();
        response.addProperty("configured", configured);
        response.addProperty("mode", state.teamsUseGraph ? "graph" : "ics");
        response.addProperty("icsUrl", state.teamsIcsUrl == null ? "" : state.teamsIcsUrl);
        response.addProperty("hasGraphToken", hasToken);
        response.add("mappings", serializeMappings(state.meetingMappings));

        JsonArray meetingsArray = new JsonArray();
        if (sync && configured) {
            try (HttpClient client = teamsHttpClient()) {
                TeamsMeetingsClient teamsClient = new TeamsMeetingsClient(client);
                List<TeamsMeetingsClient.MeetingItem> items = state.teamsUseGraph
                        ? teamsClient.fetchFromGraph(settings.teamsGraphToken())
                        : teamsClient.fetchFromIcs(state.teamsIcsUrl);
                for (TeamsMeetingsClient.MeetingItem item : items) {
                    meetingsArray.add(item.toJson());
                }
            }
        }
        response.add("meetings", meetingsArray);
        return response;
    }

    private static JsonArray serializeMappings(
            List<JiraSettings.MeetingMappingState> mappings
    ) {
        JsonArray array = new JsonArray();
        if (mappings == null) {
            return array;
        }
        for (JiraSettings.MeetingMappingState mapping : mappings) {
            JsonObject obj = new JsonObject();
            obj.addProperty("matchKey", mapping.matchKey);
            obj.addProperty("matchType", mapping.matchType);
            obj.addProperty("meetingTitle", mapping.meetingTitle);
            obj.addProperty("issueKey", mapping.issueKey);
            obj.addProperty("issueTitle", mapping.issueTitle);
            array.add(obj);
        }
        return array;
    }
}
