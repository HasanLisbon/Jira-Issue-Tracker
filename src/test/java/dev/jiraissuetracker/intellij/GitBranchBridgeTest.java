package dev.jiraissuetracker.intellij;

import com.google.gson.JsonObject;
import com.google.gson.JsonParser;
import org.junit.Rule;
import org.junit.Test;
import org.junit.rules.TemporaryFolder;

import java.nio.charset.StandardCharsets;
import java.nio.file.Path;
import java.net.URI;
import java.net.http.HttpClient;
import java.net.http.HttpRequest;
import java.net.http.HttpResponse;
import java.util.ArrayList;
import java.util.List;
import java.util.concurrent.TimeUnit;

import static org.junit.Assert.*;

public class GitBranchBridgeTest {
    @Rule public TemporaryFolder temporary = new TemporaryFolder();

    @Test
    public void when_branchCreationIsConfirmedThroughBridge_then_execute_should_CreateAndCheckOutEditedRef() throws Exception {
        Path root = temporary.newFolder("repository").toPath();
        run(root, "init", "-b", "main");
        run(root, "-c", "user.name=Test Fixture", "-c", "user.email=test@example.invalid", "commit", "--allow-empty", "-m", "Test baseline");
        GitBranches branches = new GitBranches(new GitBranches.Access() {
            public List<GitBranches.Root> roots() {
                return List.of(new GitBranches.Root(root.toString(), "Test repository", "main"));
            }
            public List<String> branches(String ignored) {
                return run(root, "for-each-ref", "--format=%(refname)", "refs/heads/", "refs/remotes/").lines().toList();
            }
            public void create(String ignored, String name, String base) { run(root, "checkout", "-b", name, base); }
        });
        FrontendAssetServer server = new FrontendAssetServer(branches::execute);
        try (HttpClient client = HttpClient.newHttpClient()) {
            String check = "{\"operation\":\"branches\",\"key\":\"TEST-12\",\"type\":\"bug\",\"summary\":\"Test fix\"}";
            JsonObject result = send(client, server, check, 200);
            assertEquals("bugfix/TEST-12-test-fix", result.get("suggestedName").getAsString());
            assertEquals(0, result.getAsJsonArray("repositories").get(0).getAsJsonObject().getAsJsonArray("matches").size());
            assertEquals("refs/heads/main", run(root, "for-each-ref", "--format=%(refname)").trim());
            JsonObject create = new JsonObject();
            create.addProperty("operation", "createBranch");
            create.addProperty("key", "TEST-12");
            create.addProperty("root", root.toString());
            create.addProperty("name", "bugfix/TEST-12-edited");
            create.addProperty("base", "HEAD");
            assertTrue(send(client, server, create.toString(), 200).get("created").getAsBoolean());
            assertEquals(run(root, "rev-parse", "HEAD"), run(root, "rev-parse", "refs/heads/bugfix/TEST-12-edited"));
            assertEquals("bugfix/TEST-12-edited", run(root, "branch", "--show-current").trim());
            assertFalse(send(client, server, create.toString(), 200).get("created").getAsBoolean());
            create.addProperty("name", "bad name");
            assertTrue(send(client, server, create.toString(), 400).has("error"));
        } finally {
            server.dispose();
        }
    }

    @Test
    public void when_nonCurrentBaseIsConfirmedThroughBridge_then_execute_should_CreateAtSelectedCommit() throws Exception {
        Path root = temporary.newFolder("base-repository").toPath();
        run(root, "init", "-b", "main");
        run(root, "-c", "user.name=Test Fixture", "-c", "user.email=test@example.invalid", "commit", "--allow-empty", "-m", "Test main");
        run(root, "checkout", "-b", "develop");
        run(root, "-c", "user.name=Test Fixture", "-c", "user.email=test@example.invalid", "commit", "--allow-empty", "-m", "Test develop");
        run(root, "update-ref", "refs/remotes/origin/develop", "HEAD");
        String baseCommit = run(root, "rev-parse", "HEAD");
        run(root, "checkout", "main");
        assertNotEquals(baseCommit, run(root, "rev-parse", "HEAD"));
        GitBranches branches = new GitBranches(new GitBranches.Access() {
            public List<GitBranches.Root> roots() {
                return List.of(new GitBranches.Root(root.toString(), "Test repository", "main"));
            }
            public List<String> branches(String ignored) {
                return run(root, "for-each-ref", "--format=%(refname)", "refs/heads/", "refs/remotes/").lines().toList();
            }
            public void create(String ignored, String name, String base) { run(root, "checkout", "-b", name, base); }
        });
        FrontendAssetServer server = new FrontendAssetServer(branches::execute);
        try (HttpClient client = HttpClient.newHttpClient()) {
            JsonObject check = send(client, server, "{\"operation\":\"branches\",\"key\":\"TEST-20\",\"type\":\"task\",\"summary\":\"Test\"}", 200);
            assertEquals(List.of("refs/heads/develop", "refs/heads/main", "refs/remotes/origin/develop"),
                    check.getAsJsonArray("repositories").get(0).getAsJsonObject().getAsJsonArray("branches")
                            .asList().stream().map(element -> element.getAsString()).toList());
            int ticket = 20;
            for (String base : List.of("refs/heads/develop", "refs/remotes/origin/develop")) {
                String key = "TEST-" + ticket++;
                JsonObject create = new JsonObject();
                create.addProperty("operation", "createBranch");
                create.addProperty("key", key);
                create.addProperty("root", root.toString());
                create.addProperty("name", "feature/" + key);
                create.addProperty("base", base);
                assertTrue(send(client, server, create.toString(), 200).get("created").getAsBoolean());
                assertEquals(baseCommit, run(root, "rev-parse", "refs/heads/feature/" + key));
                assertEquals("feature/" + key, run(root, "branch", "--show-current").trim());
            }
            run(root, "branch", "-D", "develop");
            JsonObject stale = JsonParser.parseString("{\"operation\":\"createBranch\",\"key\":\"TEST-22\",\"name\":\"feature/TEST-22\",\"base\":\"refs/heads/develop\"}").getAsJsonObject();
            stale.addProperty("root", root.toString());
            assertTrue(send(client, server, stale.toString(), 400).has("error"));
            assertEquals("", run(root, "for-each-ref", "--format=%(refname)", "refs/heads/feature/TEST-22"));
        } finally {
            server.dispose();
        }
    }

    @Test
    public void when_gitIntegrationIsRegistered_then_plugin_should_DispatchBranchOperationsBeforeJiraCredentials() throws Exception {
        String descriptor = java.nio.file.Files.readString(Path.of("src", "main", "resources", "META-INF", "plugin.xml"));
        assertTrue(descriptor.contains("<depends>Git4Idea</depends>"));
        String connection = java.nio.file.Files.readString(Path.of("src", "main", "java", "dev", "jiraissuetracker", "intellij", "JiraConnection.java"));
        assertTrue(connection.indexOf("new GitBranches(project).execute(request)") >= 0);
        assertTrue(connection.indexOf("new GitBranches(project).execute(request)") < connection.indexOf("JiraSettings.getInstance()"));
        String git = java.nio.file.Files.readString(Path.of("src", "main", "java", "dev", "jiraissuetracker", "intellij", "GitBranches.java"));
        assertTrue(git.contains("run(repository, GitCommand.CHECKOUT, \"-b\", name, base)"));
    }

    private static JsonObject send(HttpClient client, FrontendAssetServer server, String body, int status) throws Exception {
        HttpRequest request = HttpRequest.newBuilder(URI.create(server.getUrl() + "api/jira"))
                .header("X-Jira-Session", URI.create(server.getSessionUrl()).getFragment())
                .POST(HttpRequest.BodyPublishers.ofString(body)).build();
        HttpResponse<String> response = client.send(request, HttpResponse.BodyHandlers.ofString());
        assertEquals(response.body(), status, response.statusCode());
        return JsonParser.parseString(response.body()).getAsJsonObject();
    }

    private static String run(Path root, String... arguments) {
        List<String> command = new ArrayList<>(List.of("git", "-C", root.toString()));
        command.addAll(List.of(arguments));
        try {
            Process process = new ProcessBuilder(command).redirectErrorStream(true).start();
            if (!process.waitFor(30, TimeUnit.SECONDS)) {
                process.destroyForcibly();
                throw new AssertionError("Test Git command timed out");
            }
            String output = new String(process.getInputStream().readAllBytes(), StandardCharsets.UTF_8);
            assertEquals(output, 0, process.exitValue());
            return output;
        } catch (java.io.IOException exception) {
            throw new AssertionError(exception);
        } catch (InterruptedException exception) {
            Thread.currentThread().interrupt();
            throw new AssertionError(exception);
        }
    }
}
