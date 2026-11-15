package dev.jiraissuetracker.intellij;

import com.intellij.credentialStore.CredentialAttributes;
import com.intellij.credentialStore.CredentialStore;
import com.intellij.credentialStore.Credentials;
import com.intellij.ide.passwordSafe.PasswordSafe;
import com.intellij.openapi.application.ApplicationManager;
import com.intellij.openapi.components.PersistentStateComponent;
import com.intellij.openapi.components.RoamingType;
import com.intellij.openapi.components.State;
import com.intellij.openapi.components.Storage;

import java.net.URI;
import java.util.ArrayList;
import java.util.HashSet;
import java.util.LinkedHashMap;
import java.util.List;
import java.util.Map;
import java.util.Objects;
import java.util.ResourceBundle;
import java.util.Set;
import java.util.UUID;
import java.util.function.Supplier;

@State(
        name = "JiraIssueTrackerSettings",
        storages = @Storage(
                value = "jiraIssueTracker.xml",
                roamingType = RoamingType.DISABLED
        )
)
public final class JiraSettings
        implements PersistentStateComponent<JiraSettings.SettingsState> {

    static final String DEFAULT_COMMIT_MESSAGE_TEMPLATE =
            "{issueKey}: {summary}";

    private static final ResourceBundle MESSAGES =
            ResourceBundle.getBundle("src");

    private final Supplier<CredentialStore> credentialStore;
    private SettingsState state = new SettingsState();

    public JiraSettings() {
        this(PasswordSafe::getInstance);
    }

    JiraSettings(Supplier<CredentialStore> credentialStore) {
        this.credentialStore = credentialStore;
    }

    public static JiraSettings getInstance() {
        return ApplicationManager.getApplication()
                .getService(JiraSettings.class);
    }

    public static final class ConnectionState {
        public String id = UUID.randomUUID().toString();
        public String name = "";
        public String url = "";
        public String username = "";
        public String query =
                "assignee = currentUser() ORDER BY updated DESC";
        public boolean bearer;
    }

    public static final class MeetingMappingState {
        public String matchKey = "";
        public String matchType = "series";
        public String meetingTitle = "";
        public String issueKey = "";
        public String issueTitle = "";
    }

    public static final class SettingsState {
        public List<ConnectionState> servers = new ArrayList<>();
        public String commitMessageTemplate =
                DEFAULT_COMMIT_MESSAGE_TEMPLATE;
        public String teamsIcsUrl = "";
        public boolean teamsUseGraph;
        public List<MeetingMappingState> meetingMappings = new ArrayList<>();

        // Legacy single-server fields for migration.
        public String url = "";
        public String username = "";
        public String query =
                "assignee = currentUser() ORDER BY updated DESC";
        public boolean bearer;
    }

    @Override
    public synchronized SettingsState getState() {
        SettingsState snapshot = new SettingsState();

        for (ConnectionState connection : state.servers) {
            snapshot.servers.add(copy(connection));
        }
        snapshot.commitMessageTemplate = state.commitMessageTemplate;
        snapshot.teamsIcsUrl = state.teamsIcsUrl;
        snapshot.teamsUseGraph = state.teamsUseGraph;
        for (MeetingMappingState mapping : state.meetingMappings) {
            snapshot.meetingMappings.add(copyMapping(mapping));
        }

        return snapshot;
    }

    @Override
    public synchronized void loadState(SettingsState loaded) {
        SettingsState replacement = new SettingsState();
        replacement.commitMessageTemplate = Objects.requireNonNullElse(
                loaded.commitMessageTemplate,
                DEFAULT_COMMIT_MESSAGE_TEMPLATE
        );
        replacement.teamsIcsUrl = Objects.requireNonNullElse(
                loaded.teamsIcsUrl,
                ""
        );
        replacement.teamsUseGraph = loaded.teamsUseGraph;

        if (loaded.servers != null) {
            for (ConnectionState connection : loaded.servers) {
                replacement.servers.add(copy(connection));
            }
        }

        if (loaded.meetingMappings != null) {
            for (MeetingMappingState mapping : loaded.meetingMappings) {
                if (mapping != null
                        && mapping.matchKey != null
                        && !mapping.matchKey.isBlank()
                        && mapping.issueKey != null
                        && !mapping.issueKey.isBlank()) {
                    replacement.meetingMappings.add(copyMapping(mapping));
                }
            }
        }

        if (replacement.servers.isEmpty()
                && loaded.url != null
                && !loaded.url.isBlank()) {

            ConnectionState migrated = new ConnectionState();
            migrated.name = loaded.url;
            migrated.url = loaded.url;
            migrated.username =
                    Objects.requireNonNullElse(loaded.username, "");
            migrated.query =
                    Objects.requireNonNullElse(loaded.query, migrated.query);
            migrated.bearer = loaded.bearer;

            replacement.servers.add(migrated);
        }

        state = replacement;
    }

    synchronized void save(
            List<ConnectionState> connections,
            List<String> enteredSecrets
    ) {
        save(connections, enteredSecrets, state.commitMessageTemplate);
    }

    synchronized void save(
            List<ConnectionState> connections,
            List<String> enteredSecrets,
            String commitMessageTemplate
    ) {
        save(
                connections,
                enteredSecrets,
                commitMessageTemplate,
                state.teamsIcsUrl,
                state.teamsUseGraph,
                ""
        );
    }

    synchronized void save(
            List<ConnectionState> connections,
            List<String> enteredSecrets,
            String commitMessageTemplate,
            String teamsIcsUrl,
            boolean teamsUseGraph,
            String enteredTeamsGraphToken
    ) {
        if (commitMessageTemplate == null
                || commitMessageTemplate.isBlank()) {
            throw invalid("settings.commit.message.template.required");
        }

        if (connections.size() != enteredSecrets.size()) {
            throw new IllegalArgumentException(
                    "Each connection must have a matching secret entry."
            );
        }

        String normalizedIcsUrl = normalizeIcsUrl(teamsIcsUrl);
        String trimmedGraphToken = Objects.requireNonNullElse(
                enteredTeamsGraphToken,
                ""
        ).trim();

        SettingsState replacement = new SettingsState();
        replacement.commitMessageTemplate = commitMessageTemplate;
        replacement.teamsIcsUrl = normalizedIcsUrl;
        replacement.teamsUseGraph = teamsUseGraph;
        for (MeetingMappingState mapping : state.meetingMappings) {
            replacement.meetingMappings.add(copyMapping(mapping));
        }
        Set<String> ids = new HashSet<>();

        for (ConnectionState connection : connections) {
            ConnectionState validated = copy(connection);

            validated.name = validated.name.trim();
            validated.url =
                    JiraHttpTransport.normalizeUrl(validated.url.trim());
            validated.username = validated.username.trim();
            validated.query = validated.query.trim();

            if (validated.name.isBlank()) {
                throw invalid("settings.server.name.required");
            }

            if (!validated.bearer
                    && (validated.username.isBlank()
                    || validated.username.contains(":"))) {
                throw invalid("settings.username.invalid");
            }

            if (validated.id == null || validated.id.isBlank()
                    || !ids.add(validated.id)) {
                throw invalid("settings.server.id.duplicate");
            }

            replacement.servers.add(validated);
        }

        CredentialStore store = credentialStore.get();
        Map<CredentialAttributes, Credentials> changes =
                new LinkedHashMap<>();
        Set<CredentialAttributes> retained = new HashSet<>();

        for (int i = 0; i < replacement.servers.size(); i++) {
            ConnectionState connection = replacement.servers.get(i);
            CredentialAttributes key = attributes(connection);
            String enteredSecret =
                    Objects.requireNonNull(enteredSecrets.get(i));

            retained.add(key);

            boolean existingIdentity = state.servers.stream()
                    .anyMatch(saved -> sameIdentity(saved, connection));

            if (enteredSecret.isEmpty()) {
                if (!existingIdentity) {
                    throw invalid("settings.secret.required");
                }

                String savedSecret = store.getPassword(key);

                if (savedSecret == null || savedSecret.isEmpty()) {
                    throw invalid("settings.secret.required");
                }
            } else {
                Credentials previous = changes.putIfAbsent(
                        key,
                        new Credentials(connection.username, enteredSecret)
                );
                if (previous != null
                        && !enteredSecret.equals(previous.getPasswordAsString())) {
                    throw invalid("settings.secret.conflict");
                }
            }
        }

        for (ConnectionState previous : state.servers) {
            CredentialAttributes key = attributes(previous);

            if (!retained.contains(key)) {
                changes.put(key, null);
            }
        }

        if (teamsUseGraph) {
            if (!trimmedGraphToken.isEmpty()) {
                changes.put(
                        teamsGraphAttributes(),
                        new Credentials("teams-graph", trimmedGraphToken)
                );
            } else {
                String savedToken = store.getPassword(teamsGraphAttributes());
                if (savedToken == null || savedToken.isEmpty()) {
                    throw invalid("settings.teams.token.required");
                }
            }
        } else if (!trimmedGraphToken.isEmpty()) {
            changes.put(
                    teamsGraphAttributes(),
                    new Credentials("teams-graph", trimmedGraphToken)
            );
        }

        Map<CredentialAttributes, Credentials> previousCredentials =
                new LinkedHashMap<>();

        for (CredentialAttributes key : changes.keySet()) {
            previousCredentials.put(key, store.get(key));
        }

        List<CredentialAttributes> attempted = new ArrayList<>();

        try {
            for (Map.Entry<CredentialAttributes, Credentials> change
                    : changes.entrySet()) {

                attempted.add(change.getKey());
                store.set(change.getKey(), change.getValue());
            }
        } catch (RuntimeException failure) {
            for (int i = attempted.size() - 1; i >= 0; i--) {
                CredentialAttributes key = attempted.get(i);

                try {
                    store.set(key, previousCredentials.get(key));
                } catch (RuntimeException rollbackFailure) {
                    failure.addSuppressed(rollbackFailure);
                }
            }

            throw failure;
        }

        state = replacement;
    }

    synchronized void saveTeamsConfig(
            String teamsIcsUrl,
            boolean teamsUseGraph,
            String enteredTeamsGraphToken
    ) {
        String normalizedIcsUrl = normalizeIcsUrl(teamsIcsUrl);
        String trimmedToken = Objects.requireNonNullElse(
                enteredTeamsGraphToken,
                ""
        ).trim();
        CredentialStore store = credentialStore.get();
        CredentialAttributes key = teamsGraphAttributes();

        if (teamsUseGraph) {
            if (!trimmedToken.isEmpty()) {
                store.set(key, new Credentials("teams-graph", trimmedToken));
            } else {
                String saved = store.getPassword(key);
                if (saved == null || saved.isEmpty()) {
                    throw invalid("settings.teams.token.required");
                }
            }
        } else if (!trimmedToken.isEmpty()) {
            store.set(key, new Credentials("teams-graph", trimmedToken));
        }

        state.teamsIcsUrl = normalizedIcsUrl;
        state.teamsUseGraph = teamsUseGraph;
    }

    synchronized void saveMeetingMapping(
            String matchKey,
            String matchType,
            String meetingTitle,
            String issueKey,
            String issueTitle
    ) {
        String normalizedKey = Objects.requireNonNullElse(matchKey, "").trim();
        String normalizedType = "instance".equals(matchType) ? "instance" : "series";
        String normalizedIssue = Objects.requireNonNullElse(issueKey, "").trim();

        if (normalizedKey.isEmpty()) {
            throw invalid("request.invalid");
        }

        state.meetingMappings.removeIf(existing ->
                existing.matchKey.equalsIgnoreCase(normalizedKey)
                        && existing.matchType.equals(normalizedType)
        );

        if (!normalizedIssue.isEmpty()) {
            MeetingMappingState added = new MeetingMappingState();
            added.matchKey = normalizedKey;
            added.matchType = normalizedType;
            added.meetingTitle = Objects.requireNonNullElse(meetingTitle, "").trim();
            added.issueKey = normalizedIssue;
            added.issueTitle = Objects.requireNonNullElse(issueTitle, "").trim();
            state.meetingMappings.add(added);
        }
    }

    boolean hasTeamsGraphToken() {
        String saved = credentialStore.get().getPassword(teamsGraphAttributes());
        return saved != null && !saved.isEmpty();
    }

    String teamsGraphToken() {
        String saved = credentialStore.get().getPassword(teamsGraphAttributes());
        if (saved == null || saved.isEmpty()) {
            throw invalid("settings.teams.token.required");
        }
        return saved;
    }

    static String normalizeIcsUrl(String rawUrl) {
        String trimmed = Objects.requireNonNullElse(rawUrl, "").trim();
        if (trimmed.isEmpty()) {
            return "";
        }
        if (trimmed.regionMatches(true, 0, "webcals://", 0, 10)) {
            trimmed = "https://" + trimmed.substring(10);
        } else if (trimmed.regionMatches(true, 0, "webcal://", 0, 9)) {
            trimmed = "https://" + trimmed.substring(9);
        }
        try {
            URI uri = URI.create(trimmed);
            String scheme = uri.getScheme();
            if (scheme == null
                    || (!scheme.equalsIgnoreCase("http")
                    && !scheme.equalsIgnoreCase("https"))
                    || uri.getHost() == null
                    || uri.getHost().isBlank()) {
                throw invalid("settings.teams.ics.invalid");
            }
            return uri.toString();
        } catch (IllegalArgumentException exception) {
            throw invalid("settings.teams.ics.invalid");
        }
    }

    String secret(ConnectionState selected) {
        synchronized (this) {
            boolean configured = state.servers.stream()
                    .anyMatch(saved -> sameIdentity(saved, selected));

            if (!configured) {
                throw invalid("connection.missing");
            }
        }

        String savedSecret = credentialStore.get()
                .getPassword(attributes(selected));

        if (savedSecret == null || savedSecret.isEmpty()) {
            throw invalid("settings.secret.required");
        }

        return savedSecret;
    }

    static ConnectionState copy(ConnectionState original) {
        ConnectionState result = new ConnectionState();

        result.id = original.id;
        result.name = Objects.requireNonNullElse(original.name, "");
        result.url = Objects.requireNonNullElse(original.url, "");
        result.username =
                Objects.requireNonNullElse(original.username, "");
        result.query =
                Objects.requireNonNullElse(original.query, result.query);
        result.bearer = original.bearer;

        return result;
    }

    static MeetingMappingState copyMapping(MeetingMappingState original) {
        MeetingMappingState result = new MeetingMappingState();
        result.matchKey = Objects.requireNonNullElse(original.matchKey, "");
        result.matchType = Objects.requireNonNullElse(original.matchType, "series");
        result.meetingTitle = Objects.requireNonNullElse(original.meetingTitle, "");
        result.issueKey = Objects.requireNonNullElse(original.issueKey, "");
        result.issueTitle = Objects.requireNonNullElse(original.issueTitle, "");
        return result;
    }

    private static boolean sameIdentity(
            ConnectionState first,
            ConnectionState second
    ) {
        return first.url.equals(second.url)
                && first.username.equals(second.username)
                && first.bearer == second.bearer;
    }

    private static CredentialAttributes attributes(
            ConnectionState connection
    ) {
        return new CredentialAttributes(
                "Jira Issue Tracker:"
                        + connection.url
                        + ":"
                        + connection.bearer,
                connection.username
        );
    }

    private static CredentialAttributes teamsGraphAttributes() {
        return new CredentialAttributes(
                "Jira Issue Tracker:TeamsGraph",
                "teams-graph"
        );
    }

    private static IllegalArgumentException invalid(String key) {
        return new IllegalArgumentException(MESSAGES.getString(key));
    }
}
