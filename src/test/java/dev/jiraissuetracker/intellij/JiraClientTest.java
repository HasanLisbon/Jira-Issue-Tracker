package dev.jiraissuetracker.intellij;

import com.google.gson.JsonObject;
import com.google.gson.JsonParser;
import org.junit.Test;

import java.time.ZoneId;
import java.util.ArrayList;
import java.util.List;

import static org.junit.Assert.*;

public class JiraClientTest {
    @Test
    public void when_searchHasMultiplePages_then_execute_should_ReturnAllIssues() throws Exception {
        List<String> paths = new ArrayList<>();
        JiraClient client = new JiraClient((method, path, body) -> {
            if (path.equals("field")) return "[]";
            paths.add(path);
            return path.contains("startAt=0")
                ? "{\"total\":2,\"startAt\":0,\"issues\":[{\"id\":\"1\"}]}"
                : "{\"total\":2,\"startAt\":1,\"issues\":[{\"id\":\"2\"}]}";
        });
        assertEquals(2, client.execute(request("{\"operation\":\"search\",\"query\":\"assignee = currentUser()\"}")).getAsJsonArray().size());
        assertEquals(2, paths.size());
        assertTrue(paths.get(0).contains("jql=assignee+%3D+currentUser%28%29"));
    }

    @Test
    public void when_jiraReturnsEmptyIntermediatePage_then_execute_should_RejectIncompleteResults() {
        JiraClient client = new JiraClient((method, path, body) -> path.equals("field") ? "[]" : "{\"total\":1,\"startAt\":0,\"issues\":[]}");
        assertThrows(IllegalArgumentException.class, () -> client.execute(request("{\"operation\":\"search\",\"query\":\"test\"}")));
    }

    @Test
    public void when_durationIsValid_then_execute_should_PostWorklogWithCestOffset() throws Exception {
        JiraClient client = new JiraClient((method, path, body) -> {
            assertEquals("POST", method);
            assertEquals("issue/TEST-1/worklog?adjustEstimate=leave", path);
            assertEquals(5400, body.get("timeSpentSeconds").getAsInt());
            assertEquals("2026-10-24T10:30:00.000+0200", body.get("started").getAsString());
            assertEquals("Work done", body.get("comment").getAsString());
            return "{\"id\":\"123\"}";
        });
        assertEquals("123", client.execute(request("{\"operation\":\"worklog\",\"key\":\"TEST-1\",\"duration\":\"1h 30m\",\"started\":\"2026-10-24T10:30:00+02:00\",\"body\":\"Work done\"}")).getAsJsonObject().get("id").getAsString());
    }

    @Test
    public void when_worklogHasLocalOffset_then_execute_should_PreserveOffsetInJiraFormat() throws Exception {
        for (String offset : List.of("+01:00", "+02:00", "+05:30", "-04:00", "+00:00")) {
            JiraClient client = new JiraClient((method, path, body) -> {
                assertEquals("POST", method);
                assertEquals("issue/TEST-1/worklog?adjustEstimate=leave", path);
                assertEquals("2026-10-29T09:30:00.000" + offset.replace(":", ""), body.get("started").getAsString());
                return "{\"id\":\"123\"}";
            });
            JsonObject request = request("{\"operation\":\"worklog\",\"key\":\"TEST-1\",\"duration\":\"1m\"}");
            request.addProperty("started", "2026-10-29T09:30:00" + offset);
            assertEquals("123", client.execute(request).getAsJsonObject().get("id").getAsString());
        }
    }

    @Test
    public void when_worklogHasBareLocalTime_then_execute_should_ResolveUsingSystemZone() throws Exception {
        ZoneId stockholm = ZoneId.of("Europe/Stockholm");
        JiraClient winterClient = new JiraClient((method, path, body) -> {
            assertEquals("2026-11-19T14:30:00.000+0100", body.get("started").getAsString());
            return "{\"id\":\"124\"}";
        }, stockholm);
        assertEquals("124", winterClient.execute(request(
                "{\"operation\":\"worklog\",\"key\":\"TEST-1\",\"duration\":\"30m\",\"started\":\"2026-11-19T14:30\"}"
        )).getAsJsonObject().get("id").getAsString());

        JiraClient summerClient = new JiraClient((method, path, body) -> {
            assertEquals("2026-07-24T14:30:00.000+0200", body.get("started").getAsString());
            return "{\"id\":\"125\"}";
        }, stockholm);
        assertEquals("125", summerClient.execute(request(
                "{\"operation\":\"worklog\",\"key\":\"TEST-1\",\"duration\":\"30m\",\"started\":\"2026-07-24T14:30\"}"
        )).getAsJsonObject().get("id").getAsString());
    }

    @Test
    public void when_worklogInputIsInvalid_then_execute_should_NotWriteToJira() {
        JiraClient client = new JiraClient((method, path, body) -> { fail("Invalid work must not be sent"); return ""; });
        for (String duration : List.of("0m", "-1h", "1hour", "999999999999999999999h")) {
            JsonObject request = request("{\"operation\":\"worklog\",\"key\":\"TEST-1\",\"started\":\"2026-10-24T10:30:00+02:00\"}");
            request.addProperty("duration", duration);
            assertThrows(IllegalArgumentException.class, () -> client.execute(request));
        }
    }

    @Test
    public void when_replyIsSubmitted_then_execute_should_LinkExistingComment() throws Exception {
        JiraClient client = new JiraClient((method, path, body) -> {
            if (method.equals("GET")) {
                assertEquals("issue/TEST-1/comment/42", path);
                return "{\"id\":\"42\"}";
            }
            assertEquals("issue/TEST-1/comment", path);
            assertEquals("[Reply to comment 42|#comment-42]\nThanks", body.get("body").getAsString());
            return "{\"id\":\"43\"}";
        });
        assertEquals("43", client.execute(request("{\"operation\":\"comment\",\"key\":\"TEST-1\",\"replyTo\":\"42\",\"body\":\"Thanks\"}")).getAsJsonObject().get("id").getAsString());
    }

    @Test
    public void when_transitionIsAvailable_then_execute_should_PostItsExactId() throws Exception {
        List<String> methods = new ArrayList<>();
        JiraClient client = new JiraClient((method, path, body) -> {
            methods.add(method);
            if (method.equals("GET")) return "{\"transitions\":[{\"id\":\"31\",\"name\":\"Review\"}]}";
            assertEquals("31", body.getAsJsonObject("transition").get("id").getAsString());
            return "";
        });
        client.execute(request("{\"operation\":\"transition\",\"key\":\"TEST-1\",\"transitionId\":\"31\"}"));
        assertEquals(List.of("GET", "POST"), methods);
    }

    @Test
    public void when_jiraRejectsWrite_then_execute_should_PropagateFailure() {
        JiraClient client = new JiraClient((method, path, body) -> { throw new java.io.IOException("denied"); });
        assertThrows(java.io.IOException.class, () -> client.execute(request("{\"operation\":\"comment\",\"key\":\"TEST-1\",\"body\":\"Hello\"}")));
    }

    @Test
    public void when_issueHasLinkedBranches_then_execute_should_ReturnNameAndRepositoryUrl() throws Exception {
        List<String> paths = new ArrayList<>();
        JiraClient client = new JiraClient((method, path, body) -> {
            paths.add(path);
            if (path.equals("issue/TEST-1")) return "{\"id\":\"10\"}";
            if (path.startsWith("dev-status/summary")) return "{\"summary\":{\"branch\":{\"byInstanceType\":{\"stash\":{\"count\":1}}}}}";
            return "{\"detail\":[{\"branches\":[{\"name\":\"feature/TEST-1\",\"repository\":{\"url\":\"https://git.test/projects/P/repos/r\"}}]}]}";
        });
        var result = client.execute(request("{\"operation\":\"devBranches\",\"key\":\"TEST-1\"}")).getAsJsonArray();
        assertEquals(1, result.size());
        assertEquals("https://git.test/projects/P/repos/r", result.get(0).getAsJsonObject().get("repositoryUrl").getAsString());
        assertEquals("dev-status/issue/detail?issueId=10&applicationType=stash&dataType=branch", paths.get(2));
    }

    @Test
    public void when_issueHasNoDevelopmentData_then_execute_should_ReturnNoBranches() throws Exception {
        JiraClient client = new JiraClient((method, path, body) -> path.equals("issue/TEST-1")
            ? "{\"id\":\"10\"}" : "{\"summary\":{\"branch\":{\"byInstanceType\":{}}}}");
        assertEquals(0, client.execute(request("{\"operation\":\"devBranches\",\"key\":\"TEST-1\"}")).getAsJsonArray().size());
    }

    private static JsonObject request(String json) {
        return JsonParser.parseString(json).getAsJsonObject();
    }
}
