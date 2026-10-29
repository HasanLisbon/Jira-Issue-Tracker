package dev.jiraissuetracker.intellij;

import com.google.gson.JsonArray;
import com.google.gson.JsonObject;
import com.intellij.credentialStore.CredentialAttributes;
import com.intellij.credentialStore.CredentialStore;
import com.intellij.credentialStore.Credentials;
import com.intellij.openapi.application.Application;
import com.intellij.openapi.application.ApplicationManager;
import com.intellij.openapi.project.Project;
import com.intellij.util.xmlb.XmlSerializer;
import org.jdom.Element;
import org.jdom.output.XMLOutputter;
import org.junit.After;
import org.junit.Before;
import org.junit.Test;

import java.lang.reflect.Proxy;
import java.util.HashMap;
import java.util.List;
import java.util.Map;

import static org.junit.Assert.*;

public class JiraConnectionProfilesTest {
    private final Map<CredentialAttributes, Credentials> secrets = new HashMap<>();
    private final JiraSettings settings = new JiraSettings(() -> new CredentialStore() {
        @Override
        public Credentials get(CredentialAttributes attributes) {
            return secrets.get(attributes);
        }

        @Override
        public void set(CredentialAttributes attributes, Credentials credentials) {
            if (credentials == null) {
                secrets.remove(attributes);
            } else {
                secrets.put(attributes, credentials);
            }
        }
    });
    private Application previousApplication;

    @Before
    public void installApplication() {
        previousApplication = ApplicationManager.getApplication();
        Application application = (Application) Proxy.newProxyInstance(
                Application.class.getClassLoader(), new Class<?>[]{Application.class},
                (proxy, method, arguments) -> switch (method.getName()) {
                    case "getService" -> {
                        assertEquals(JiraSettings.class, arguments[0]);
                        yield settings;
                    }
                    case "isUnitTestMode" -> false;
                    case "toString" -> "Test application";
                    default -> throw new AssertionError("Unexpected application call: " + method.getName());
                });
        ApplicationManager.setApplication(application);
    }

    @After
    public void restoreApplication() {
        ApplicationManager.setApplication(previousApplication);
    }

    @Test
    public void when_sameUrlHasDifferentQueries_then_save_should_PersistDistinctProfiles() {
        JiraSettings.ConnectionState first = profile("Test repository one", "project = TESTONE");
        JiraSettings.ConnectionState second = profile("Test repository two", "project = TESTTWO");
        first.url += "/";
        settings.save(List.of(first, second), List.of("test-password", "test-password"));
        Element serialized = XmlSerializer.serialize(settings.getState());
        settings.loadState(XmlSerializer.deserialize(serialized, JiraSettings.SettingsState.class));

        List<JiraSettings.ConnectionState> saved = settings.getState().servers;
        assertEquals(2, saved.size());
        assertEquals(saved.get(0).url, saved.get(1).url);
        assertNotEquals(saved.get(0).id, saved.get(1).id);
        assertEquals(List.of(first.id, second.id),
                saved.stream().map(connection -> connection.id).toList());
        assertEquals(List.of("project = TESTONE", "project = TESTTWO"),
                saved.stream().map(connection -> connection.query).toList());
        assertEquals("test-password", settings.secret(saved.get(0)));
        assertEquals("test-password", settings.secret(saved.get(1)));
        assertEquals(1, secrets.size());
        assertFalse(new XMLOutputter().outputString(serialized).contains("test-password"));
    }

    @Test
    public void when_profileIsAddedAndAnotherRemoved_then_save_should_RetainSharedCredentials() {
        JiraSettings.ConnectionState first = profile("Test repository one", "project = TESTONE");
        JiraSettings.ConnectionState second = profile("Test repository two", "project = TESTTWO");
        settings.save(List.of(first), List.of("test-password"));
        settings.save(List.of(first, second), List.of("", ""));

        settings.save(List.of(second), List.of(""));

        assertEquals(second.id, settings.getState().servers.get(0).id);
        assertEquals("test-password", settings.secret(second));
        assertEquals(1, secrets.size());
        settings.save(List.of(), List.of());
        assertTrue(secrets.isEmpty());
    }

    @Test
    public void when_sharedProfilesEnterConflictingSecrets_then_save_should_RejectWithoutChanges() {
        JiraSettings.ConnectionState first = profile("Test repository one", "project = TESTONE");
        JiraSettings.ConnectionState second = profile("Test repository two", "project = TESTTWO");
        settings.save(List.of(first), List.of("test-password"));

        assertThrows(IllegalArgumentException.class, () -> settings.save(
                List.of(first, second), List.of("replacement-one", "replacement-two")));

        assertEquals(1, settings.getState().servers.size());
        assertEquals("test-password", settings.secret(first));
    }

    @Test
    public void when_sameUrlHasDifferentUsers_then_save_should_KeepCredentialsSeparate() {
        JiraSettings.ConnectionState first = profile("Test repository one", "project = TESTONE");
        JiraSettings.ConnectionState second = profile("Test repository two", "project = TESTTWO");
        second.username = "other-test-user";
        settings.save(List.of(first, second), List.of("first-secret", "second-secret"));

        assertEquals("first-secret", settings.secret(first));
        assertEquals("second-secret", settings.secret(second));
        assertEquals(2, secrets.size());
    }

    @Test
    public void when_savedProfileHasNoId_then_loadState_should_AssignAndPersistStableId() {
        Element serialized = new Element("state");
        serialized.addContent(new Element("option").setAttribute("name", "servers")
                .addContent(new Element("list").addContent(new Element("ConnectionState")
                        .addContent(new Element("option").setAttribute("name", "name").setAttribute("value", "Legacy"))
                        .addContent(new Element("option").setAttribute("name", "url").setAttribute("value", "https://jira.invalid")))));
        settings.loadState(XmlSerializer.deserialize(serialized, JiraSettings.SettingsState.class));
        assertEquals(1, settings.getState().servers.size());
        String id = settings.getState().servers.get(0).id;
        assertFalse(id.isBlank());

        settings.loadState(XmlSerializer.deserialize(
                XmlSerializer.serialize(settings.getState()), JiraSettings.SettingsState.class));

        assertEquals(id, settings.getState().servers.get(0).id);
        assertEquals("Legacy", settings.getState().servers.get(0).name);
    }

    @Test
    public void when_settingsEditorApplies_then_apply_should_PreserveProfileIds() throws Exception {
        JiraSettings.ConnectionState first = profile("Test repository one", "project = TESTONE");
        JiraSettings.ConnectionState second = profile("Test repository two", "project = TESTTWO");
        settings.save(List.of(first, second), List.of("test-password", "test-password"));
        JiraSettingsConfigurable configurable = new JiraSettingsConfigurable();
        try {
            configurable.createComponent();
            assertFalse(configurable.isModified());
            configurable.apply();
            assertEquals(List.of(first.id, second.id), settings.getState().servers.stream()
                    .map(connection -> connection.id).toList());
            assertFalse(configurable.isModified());
        } finally {
            configurable.disposeUIResources();
        }
    }

    @Test
    public void when_profilesShareUrl_then_execute_should_ExposeNamesAndRejectRemovedProfileId() throws Exception {
        JiraSettings.ConnectionState first = profile("Test repository one", "project = TESTONE");
        JiraSettings.ConnectionState second = profile("Test repository two", "project = TESTTWO");
        settings.save(List.of(first, second), List.of("test-password", "test-password"));
        Project project = (Project) Proxy.newProxyInstance(
                Project.class.getClassLoader(), new Class<?>[]{Project.class},
                (proxy, method, arguments) -> {
                    if (method.getName().equals("isDisposed")) return false;
                    throw new AssertionError("Unexpected project call: " + method.getName());
                });
        JiraConnection bridge = new JiraConnection(project);
        JsonObject request = new JsonObject();
        request.addProperty("operation", "connections");
        JsonArray connections = bridge.execute(request).getAsJsonArray();
        assertEquals(2, connections.size());
        assertEquals(first.id, connections.get(0).getAsJsonObject().get("id").getAsString());
        assertEquals(second.id, connections.get(1).getAsJsonObject().get("id").getAsString());
        assertEquals(second.name, connections.get(1).getAsJsonObject().get("name").getAsString());
        assertEquals(second.query, connections.get(1).getAsJsonObject().get("query").getAsString());
        assertFalse(connections.toString().contains("test-password"));
        assertFalse(connections.get(0).getAsJsonObject().has("username"));

        settings.save(List.of(first), List.of(""));
        request.addProperty("operation", "myself");
        request.addProperty("repositoryId", second.id);
        assertThrows(IllegalArgumentException.class, () -> bridge.execute(request));
        request.addProperty("repositoryId", first.url);
        assertThrows(IllegalArgumentException.class, () -> bridge.execute(request));
    }

    private static JiraSettings.ConnectionState profile(String name, String query) {
        JiraSettings.ConnectionState connection = new JiraSettings.ConnectionState();
        connection.name = name;
        connection.url = "https://jira.invalid";
        connection.username = "test-user";
        connection.query = query;
        return connection;
    }
}
