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
}
