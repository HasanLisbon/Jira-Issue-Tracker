package dev.jiraissuetracker.intellij;

import com.intellij.credentialStore.CredentialAttributes;
import com.intellij.credentialStore.CredentialStore;
import com.intellij.credentialStore.Credentials;
import com.intellij.openapi.components.State;
import com.intellij.util.xmlb.XmlSerializer;
import org.jdom.Element;
import org.jdom.output.XMLOutputter;
import org.junit.Test;

import java.nio.file.Path;
import java.util.HashMap;
import java.util.List;
import java.util.Map;
import javax.xml.parsers.DocumentBuilderFactory;

import static org.junit.Assert.*;

public class JiraSettingsTest {
    private static final String COMMIT_MESSAGE_TEMPLATE =
            "[{issueKey}] {summary}";

    @Test
    public void when_settingsAreSavedAndReloaded_then_save_should_KeepSecretOutsidePersistedState() {
        Map<CredentialAttributes, Credentials> secrets = new HashMap<>();
        JiraSettings settings = settings(secrets);
        JiraSettings.ConnectionState connection = configured(
                "Primary", "https://jira.invalid/jira/", "test-user");
        settings.save(List.of(connection), List.of("test-password"));

        Element serialized = XmlSerializer.serialize(settings.getState());
        String xml = new XMLOutputter().outputString(serialized);
        assertFalse(xml.contains("test-password"));

        JiraSettings reloaded = settings(secrets);
        reloaded.loadState(XmlSerializer.deserialize(
                serialized, JiraSettings.SettingsState.class));
        JiraSettings.ConnectionState loaded =
                reloaded.getState().servers.get(0);
        assertEquals("https://jira.invalid/jira", loaded.url);
        assertEquals("test-user", loaded.username);
        assertEquals("test-password", reloaded.secret(loaded));
        assertEquals(1, secrets.size());
    }

    @Test
    public void when_onlyQueryChanges_then_save_should_RetainSavedSecret() {
        Map<CredentialAttributes, Credentials> secrets = new HashMap<>();
        JiraSettings settings = settings(secrets);
        JiraSettings.ConnectionState connection = configured(
                "Primary", "https://jira.invalid", "test-user");
        settings.save(List.of(connection), List.of("test-password"));

        JiraSettings.ConnectionState updated =
                settings.getState().servers.get(0);
        updated.query = "project = TEST";
        settings.save(List.of(updated), List.of(""));

        JiraSettings.ConnectionState saved =
                settings.getState().servers.get(0);
        assertEquals("test-password", settings.secret(saved));
        assertEquals("project = TEST", saved.query);
    }

    @Test
    public void when_multipleConnectionsAreSaved_then_getState_should_PreserveOrderAndSecrets() {
        Map<CredentialAttributes, Credentials> secrets = new HashMap<>();
        JiraSettings settings = settings(secrets);
        JiraSettings.ConnectionState first = configured(
                "First", "https://first.invalid", "first-user");
        JiraSettings.ConnectionState second = configured(
                "Second", "https://second.invalid", "second-user");
        settings.save(List.of(first, second),
                List.of("first-secret", "second-secret"));

        List<JiraSettings.ConnectionState> saved =
                settings.getState().servers;
        assertEquals(List.of("First", "Second"),
                saved.stream().map(connection -> connection.name).toList());
        assertEquals("first-secret", settings.secret(saved.get(0)));
        assertEquals("second-secret", settings.secret(saved.get(1)));
    }

    @Test
    public void when_identityChangesWithoutSecret_then_save_should_PreservePreviousConnection() {
        Map<CredentialAttributes, Credentials> secrets = new HashMap<>();
        JiraSettings settings = settings(secrets);
        JiraSettings.ConnectionState connection = configured(
                "Primary", "https://jira.invalid", "test-user");
        settings.save(List.of(connection), List.of("test-password"));

        JiraSettings.ConnectionState updated =
                settings.getState().servers.get(0);
        updated.url = "https://other.invalid";
        assertThrows(IllegalArgumentException.class,
                () -> settings.save(List.of(updated), List.of("")));

        JiraSettings.ConnectionState saved =
                settings.getState().servers.get(0);
        assertEquals("https://jira.invalid", saved.url);
        assertEquals("test-password", settings.secret(saved));
    }

    @Test
    public void when_connectionsAreRemoved_then_save_should_DeleteStoredSecrets() {
        Map<CredentialAttributes, Credentials> secrets = new HashMap<>();
        JiraSettings settings = settings(secrets);
        assertTrue(settings.getState().servers.isEmpty());
        settings.save(List.of(configured(
                "Primary", "https://jira.invalid", "test-user")),
                List.of("test-password"));
        settings.save(List.of(), List.of());

        assertTrue(secrets.isEmpty());
        assertTrue(settings.getState().servers.isEmpty());
    }

    @Test
    public void when_credentialStoreFails_then_save_should_NotPersistNewConnections() {
        JiraSettings settings = new JiraSettings(() -> new CredentialStore() {
            @Override
            public Credentials get(CredentialAttributes attributes) {
                return null;
            }

            @Override
            public void set(
                    CredentialAttributes attributes,
                    Credentials credentials
            ) {
                throw new IllegalStateException("Test storage failure");
            }
        });
        JiraSettings.ConnectionState connection = configured(
                "Primary", "https://jira.invalid", "test-user");

        assertThrows(IllegalStateException.class,
                () -> settings.save(List.of(connection), List.of("test-password")));
        assertTrue(settings.getState().servers.isEmpty());
    }

    @Test
    public void when_legacyStateIsLoaded_then_loadState_should_MigrateSingleConnection() {
        JiraSettings settings = settings(new HashMap<>());
        JiraSettings.SettingsState legacy = new JiraSettings.SettingsState();
        legacy.url = "https://jira.invalid";
        legacy.username = "test-user";
        legacy.query = "project = LEGACY";

        settings.loadState(legacy);

        JiraSettings.ConnectionState migrated =
                settings.getState().servers.get(0);
        assertEquals("https://jira.invalid", migrated.url);
        assertEquals("https://jira.invalid", migrated.name);
        assertEquals("test-user", migrated.username);
        assertEquals("project = LEGACY", migrated.query);
    }

    @Test
    public void when_commitMessageTemplateIsLoaded_then_getState_should_PersistTemplate() {
        Element serialized = new Element("state");
        serialized.addContent(new Element("option")
                .setAttribute("name", "commitMessageTemplate")
                .setAttribute("value", COMMIT_MESSAGE_TEMPLATE));
        JiraSettings settings = settings(new HashMap<>());
        JiraSettings.SettingsState loaded = XmlSerializer.deserialize(
                serialized, JiraSettings.SettingsState.class);

        settings.loadState(loaded);

        String roundTrip = new XMLOutputter().outputString(
                XmlSerializer.serialize(settings.getState()));
        assertTrue(roundTrip, roundTrip.contains(COMMIT_MESSAGE_TEMPLATE));
    }

    @Test
    public void when_commitMessageTemplateIsSaved_then_save_should_PersistTemplate() {
        Map<CredentialAttributes, Credentials> secrets = new HashMap<>();
        JiraSettings settings = settings(secrets);
        JiraSettings.ConnectionState connection = configured(
                "Primary", "https://jira.invalid", "test-user");
        settings.save(List.of(connection), List.of("test-password"),
                COMMIT_MESSAGE_TEMPLATE);

        String roundTrip = new XMLOutputter().outputString(
                XmlSerializer.serialize(settings.getState()));
        assertTrue(roundTrip, roundTrip.contains(COMMIT_MESSAGE_TEMPLATE));
        assertEquals("test-password",
                settings.secret(settings.getState().servers.get(0)));
    }

    @Test
    public void when_templateIsBlank_then_save_should_LeaveSettingsAndCredentialsUnchanged() {
        Map<CredentialAttributes, Credentials> secrets = new HashMap<>();
        JiraSettings settings = settings(secrets);
        JiraSettings.ConnectionState connection = configured(
                "Primary", "https://jira.invalid", "test-user");
        settings.save(List.of(connection), List.of("test-password"));
        JiraSettings.ConnectionState renamed =
                settings.getState().servers.get(0);
        renamed.name = "Renamed";

        assertThrows(IllegalArgumentException.class,
                () -> settings.save(List.of(renamed),
                        List.of("replacement-password"), "  "));

        assertEquals("Primary",
                settings.getState().servers.get(0).name);
        assertEquals(JiraSettings.DEFAULT_COMMIT_MESSAGE_TEMPLATE,
                settings.getState().commitMessageTemplate);
        assertEquals("test-password",
                settings.secret(settings.getState().servers.get(0)));
    }

    @Test
    public void when_twoArgumentSaveIsUsed_then_save_should_PreserveTemplate() {
        Map<CredentialAttributes, Credentials> secrets = new HashMap<>();
        JiraSettings settings = settings(secrets);
        JiraSettings.ConnectionState connection = configured(
                "Primary", "https://jira.invalid", "test-user");
        settings.save(List.of(connection), List.of("test-password"),
                COMMIT_MESSAGE_TEMPLATE);
        JiraSettings.ConnectionState renamed =
                settings.getState().servers.get(0);
        renamed.name = "Renamed";

        settings.save(List.of(renamed), List.of(""));

        assertEquals(COMMIT_MESSAGE_TEMPLATE,
                settings.getState().commitMessageTemplate);
        assertEquals("test-password", settings.secret(renamed));
    }

    @Test
    public void when_pluginIsLoaded_then_registration_should_ExposePersistentSettingsWithoutTasksDependency() throws Exception {
        var document = DocumentBuilderFactory.newInstance()
                .newDocumentBuilder()
                .parse(Path.of("src", "main", "resources", "META-INF",
                        "plugin.xml").toFile());
        var services = document.getElementsByTagName("applicationService");
        assertEquals(1, services.getLength());
        assertEquals(JiraSettings.class.getName(), services.item(0)
                .getAttributes().getNamedItem("serviceImplementation")
                .getNodeValue());
        var configurables = document.getElementsByTagName(
                "applicationConfigurable");
        assertEquals(1, configurables.getLength());
        assertEquals(JiraSettingsConfigurable.class.getName(), configurables
                .item(0).getAttributes().getNamedItem("instance")
                .getNodeValue());
        assertEquals("tools", configurables.item(0).getAttributes()
                .getNamedItem("parentId").getNodeValue());
        var dependencies = document.getElementsByTagName("depends");
        for (int i = 0; i < dependencies.getLength(); i++) {
            assertNotEquals("com.intellij.tasks",
                    dependencies.item(i).getTextContent());
        }
        State persistence = JiraSettings.class.getAnnotation(State.class);
        assertNotNull(persistence);
        assertEquals("jiraIssueTracker.xml",
                persistence.storages()[0].value());
    }

    private static JiraSettings.ConnectionState configured(
            String name,
            String url,
            String username
    ) {
        JiraSettings.ConnectionState connection =
                new JiraSettings.ConnectionState();
        connection.name = name;
        connection.url = url;
        connection.username = username;
        return connection;
    }

    private static JiraSettings settings(
            Map<CredentialAttributes, Credentials> secrets
    ) {
        return new JiraSettings(() -> new CredentialStore() {
            @Override
            public Credentials get(CredentialAttributes attributes) {
                return secrets.get(attributes);
            }

            @Override
            public void set(
                    CredentialAttributes attributes,
                    Credentials credentials
            ) {
                if (credentials == null) {
                    secrets.remove(attributes);
                } else {
                    secrets.put(attributes, credentials);
                }
            }
        });
    }
}
