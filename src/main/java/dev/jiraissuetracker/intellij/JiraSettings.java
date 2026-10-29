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

    public static final class SettingsState {
        public List<ConnectionState> servers = new ArrayList<>();
        public String commitMessageTemplate =
                DEFAULT_COMMIT_MESSAGE_TEMPLATE;

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

        return snapshot;
    }

    @Override
    public synchronized void loadState(SettingsState loaded) {
        SettingsState replacement = new SettingsState();
        replacement.commitMessageTemplate = Objects.requireNonNullElse(
                loaded.commitMessageTemplate,
                DEFAULT_COMMIT_MESSAGE_TEMPLATE
        );

        if (loaded.servers != null) {
            for (ConnectionState connection : loaded.servers) {
                replacement.servers.add(copy(connection));
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
        if (commitMessageTemplate == null
                || commitMessageTemplate.isBlank()) {
            throw invalid("settings.commit.message.template.required");
        }

        if (connections.size() != enteredSecrets.size()) {
            throw new IllegalArgumentException(
                    "Each connection must have a matching secret entry."
            );
        }

        SettingsState replacement = new SettingsState();
        replacement.commitMessageTemplate = commitMessageTemplate;
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

    private static IllegalArgumentException invalid(String key) {
        return new IllegalArgumentException(MESSAGES.getString(key));
    }
}
