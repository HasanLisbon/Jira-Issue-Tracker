package dev.jiraissuetracker.intellij;

import com.google.gson.JsonObject;
import com.google.gson.JsonParser;
import org.junit.Test;

import java.util.ArrayList;
import java.util.List;

import static org.junit.Assert.*;

public class GitBranchesTest {
    private final List<String> branches = new ArrayList<>();
    private final List<String> created = new ArrayList<>();
    private final List<String> bases = new ArrayList<>();
    private final GitBranches git = new GitBranches(new GitBranches.Access() {
        public List<GitBranches.Root> roots() {
            return List.of(new GitBranches.Root("test-root", "Test repository", "main"));
        }

        public List<String> branches(String root) {
            assertEquals("test-root", root);
            return List.copyOf(branches);
        }

        public void create(String root, String name, String base) {
            assertEquals("test-root", root);
            created.add(name);
            bases.add(base);
            branches.add("refs/heads/" + name);
        }
    });

    @Test
    public void when_localAndRemoteRefsContainExactKey_then_execute_should_ReturnMatchesWithoutCreating() {
        branches.addAll(List.of("refs/heads/feature/TEST-12-work", "refs/remotes/origin/bugfix/TEST-12",
                "refs/heads/TEST-123", "refs/heads/OTHERTEST-12", "refs/heads/TEST-12ABC", "refs/remotes/TEST-12/main"));
        JsonObject result = git.execute(request("branches"));
        assertEquals(2, result.getAsJsonArray("repositories").get(0).getAsJsonObject().getAsJsonArray("matches").size());
        assertTrue(created.isEmpty());
    }

    @Test
    public void when_remotesRequested_then_execute_should_ReturnOriginUrlsWithoutTicketKey() {
        JsonObject request = new JsonObject();
        request.addProperty("operation", "remotes");
        GitBranches origins = new GitBranches(new GitBranches.Access() {
            public List<GitBranches.Root> roots() { return List.of(); }
            public List<String> branches(String root) { return List.of(); }
            public void create(String root, String name, String base) { fail(); }
            public List<String> originUrls() { return List.of("https://git.test/scm/p/r.git"); }
        });
        assertEquals("https://git.test/scm/p/r.git", origins.execute(request).getAsJsonArray("urls").get(0).getAsString());
    }

    @Test
    public void when_noBranchExists_then_execute_should_SuggestTypeBasedEditableNameWithoutCreating() {
        JsonObject request = request("branches");
        request.addProperty("type", "bug");
        request.addProperty("summary", "Fix input / validation!");
        assertEquals("bugfix/TEST-12-fix-input-validation", git.execute(request).get("suggestedName").getAsString());
        request.addProperty("type", "story");
        request.addProperty("summary", "");
        assertEquals("feature/TEST-12", git.execute(request).get("suggestedName").getAsString());
        assertTrue(created.isEmpty());
    }

    @Test
    public void when_confirmationContainsEditedName_then_execute_should_CreateOnceFromHead() {
        JsonObject request = request("createBranch");
        request.addProperty("root", "test-root");
        request.addProperty("name", "bugfix/TEST-12-custom-name");
        assertTrue(git.execute(request).get("created").getAsBoolean());
        assertFalse(git.execute(request).get("created").getAsBoolean());
        assertEquals(List.of("bugfix/TEST-12-custom-name"), created);
        assertEquals(List.of("HEAD"), bases);
    }

    @Test
    public void when_branchesDoNotMatchTicket_then_execute_should_ReturnAllLocalAndRemoteBaseRefs() {
        branches.addAll(List.of("refs/heads/main", "refs/heads/develop", "refs/remotes/origin/develop"));

        JsonObject repository = git.execute(request("branches")).getAsJsonArray("repositories").get(0).getAsJsonObject();

        assertEquals(branches, repository.getAsJsonArray("branches").asList().stream()
                .map(element -> element.getAsString()).toList());
        assertTrue(repository.getAsJsonArray("matches").isEmpty());
        assertTrue(created.isEmpty());
    }

    @Test
    public void when_repositoryHasNoBranches_then_execute_should_ReturnEmptyBaseRefs() {
        JsonObject repository = git.execute(request("branches")).getAsJsonArray("repositories").get(0).getAsJsonObject();
        assertTrue(repository.getAsJsonArray("branches").isEmpty());
    }

    @Test
    public void when_baseRefIsSelected_then_execute_should_CreateFromThatExactRef() {
        for (String base : List.of("refs/heads/develop", "refs/remotes/origin/develop")) {
            branches.clear();
            branches.add(base);
            JsonObject request = request("createBranch");
            request.addProperty("root", "test-root");
            request.addProperty("name", "feature/TEST-12");
            request.addProperty("base", base);

            assertTrue(git.execute(request).get("created").getAsBoolean());
            assertEquals(base, bases.get(bases.size() - 1));
        }
    }

    @Test
    public void when_baseRefIsMissingOrInvalid_then_execute_should_RejectWithoutCreating() {
        branches.add("refs/heads/main");
        for (String base : List.of("", " ", "main", "refs/heads/deleted", "refs/remotes/origin/deleted", "-f", "HEAD~1")) {
            JsonObject request = request("createBranch");
            request.addProperty("root", "test-root");
            request.addProperty("name", "feature/TEST-12");
            request.addProperty("base", base);
            assertThrows(IllegalArgumentException.class, () -> git.execute(request));
        }
        JsonObject request = request("createBranch");
        request.addProperty("root", "test-root");
        request.addProperty("name", "feature/TEST-12");
        request.remove("base");
        assertThrows(IllegalArgumentException.class, () -> git.execute(request));
        request.addProperty("base", (String) null);
        assertThrows(IllegalArgumentException.class, () -> git.execute(request));
        assertTrue(created.isEmpty());
    }

    @Test
    public void when_nameOrRootIsInvalid_then_execute_should_RejectWithoutCreating() {
        for (String name : List.of("", " ", "-f", "HEAD", "bad..name", "bad name", "name.lock", "feature/")) {
            JsonObject request = request("createBranch");
            request.addProperty("root", "test-root");
            request.addProperty("name", name);
            assertThrows(IllegalArgumentException.class, () -> git.execute(request));
        }
        JsonObject request = request("createBranch");
        request.addProperty("root", "not-a-project-root");
        request.addProperty("name", "feature/TEST-12");
        assertThrows(IllegalArgumentException.class, () -> git.execute(request));
        assertTrue(created.isEmpty());
    }

    @Test
    public void when_branchCheckFails_then_execute_should_PropagateFailureInsteadOfSuggestingCreation() {
        GitBranches failing = new GitBranches(new GitBranches.Access() {
            public List<GitBranches.Root> roots() { throw new IllegalArgumentException("Git unavailable"); }
            public List<String> branches(String root) { throw new AssertionError(); }
            public void create(String root, String name, String base) { throw new AssertionError(); }
        });
        assertThrows(IllegalArgumentException.class, () -> failing.execute(request("branches")));
    }

    private static JsonObject request(String operation) {
        JsonObject request = JsonParser.parseString("{\"key\":\"TEST-12\",\"type\":\"task\",\"summary\":\"Test work\"}").getAsJsonObject();
        request.addProperty("operation", operation);
        request.addProperty("base", "HEAD");
        return request;
    }
}
