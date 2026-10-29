package dev.jiraissuetracker.intellij;

import com.google.gson.JsonArray;
import com.google.gson.JsonObject;
import com.intellij.openapi.project.Project;
import git4idea.commands.Git;
import git4idea.commands.GitCommand;
import git4idea.commands.GitCommandResult;
import git4idea.commands.GitLineHandler;
import git4idea.repo.GitRepository;
import git4idea.repo.GitRepositoryManager;
import git4idea.validators.GitRefNameValidator;

import java.util.List;
import java.util.Locale;
import java.util.ResourceBundle;
import java.util.logging.Logger;
import java.util.regex.Pattern;

final class GitBranches {
    private static final ResourceBundle MESSAGES = ResourceBundle.getBundle("src");
    private final Access access;

    record Root(String id, String name, String base) {}

    interface Access {
        List<Root> roots();
        List<String> branches(String root);
        void create(String root, String name, String base);

        default List<String> originUrls() {
            return List.of();
        }
    }

    GitBranches(Project project) {
        this(new Access() {
            public List<Root> roots() {
                return GitRepositoryManager.getInstance(project).getRepositories().stream()
                        .map(repository -> new Root(repository.getRoot().getPath(), repository.getRoot().getName(),
                                repository.getCurrentBranchName())).toList();
            }

            public List<String> branches(String root) {
                return run(repository(root), GitCommand.FOR_EACH_REF,
                        "--format=%(refname)", "refs/heads/", "refs/remotes/").getOutput();
            }

            public void create(String root, String name, String base) {
                GitRepository repository = repository(root);
                run(repository, GitCommand.CHECKOUT, "-b", name, base);
                repository.update();
            }

            public List<String> originUrls() {
                return GitRepositoryManager.getInstance(project).getRepositories().stream()
                        .flatMap(repository -> repository.getRemotes().stream())
                        .filter(remote -> remote.getName().equals("origin"))
                        .flatMap(remote -> remote.getUrls().stream()).distinct().toList();
            }

            private GitRepository repository(String root) {
                return GitRepositoryManager.getInstance(project).getRepositories().stream()
                        .filter(repository -> repository.getRoot().getPath().equals(root)).findFirst()
                        .orElseThrow(() -> new IllegalArgumentException(MESSAGES.getString("git.root.invalid")));
            }

            private GitCommandResult run(GitRepository repository, GitCommand command, String... arguments) {
                GitLineHandler handler = new GitLineHandler(project, repository.getRoot(), command);
                handler.addParameters(arguments);
                GitCommandResult result = Git.getInstance().runCommand(handler);
                if (!result.success()) {
                    Logger.getLogger(GitBranches.class.getName()).warning("Git " + command.name() + " failed: exit " + result.getExitCode());
                    throw new IllegalArgumentException(MESSAGES.getString("git.failed"));
                }
                return result;
            }
        });
    }

    GitBranches(Access access) {
        this.access = access;
    }

    JsonObject execute(JsonObject request) {
        if (text(request, "operation").equals("remotes")) {
            JsonArray urls = new JsonArray();
            access.originUrls().forEach(urls::add);
            JsonObject remotes = new JsonObject();
            remotes.add("urls", urls);
            return remotes;
        }
        String key = text(request, "key");
        if (!key.matches("[A-Z][A-Z0-9_]*-\\d+(?:-\\d+)*")) {
            throw new IllegalArgumentException(MESSAGES.getString("request.invalid"));
        }
        List<Root> roots = access.roots();
        Logger.getLogger(GitBranches.class.getName()).info("Branch lookup roots: key=" + key
                + ", roots=" + roots.stream().map(Root::id).toList());
        if (text(request, "operation").equals("createBranch")) {
            return create(request, key, roots);
        }
        JsonObject result = new JsonObject();
        String prefix = text(request, "type").equalsIgnoreCase("bug") ? "bugfix/" : "feature/";
        String summary = text(request, "summary").toLowerCase(Locale.ROOT)
                .replaceAll("[^a-z0-9]+", "-").replaceAll("^-|-$", "");
        result.addProperty("suggestedName", prefix + key + (summary.isEmpty() ? "" : "-" + summary));
        JsonArray repositories = new JsonArray();
        for (Root root : roots) {
            JsonObject repository = new JsonObject();
            repository.addProperty("id", root.id());
            repository.addProperty("name", root.name());
            repository.addProperty("base", root.base() == null ? "HEAD" : root.base());
            List<String> branches = access.branches(root.id());
            JsonArray baseBranches = new JsonArray();
            branches.forEach(baseBranches::add);
            repository.add("branches", baseBranches);
            JsonArray matches = new JsonArray();
            matchingBranches(root.id(), key, branches).forEach(matches::add);
            repository.add("matches", matches);
            repositories.add(repository);
        }
        result.add("repositories", repositories);
        return result;
    }

    private JsonObject create(JsonObject request, String key, List<Root> roots) {
        String root = text(request, "root");
        String name = text(request, "name");
        String base = text(request, "base");
        if (roots.stream().noneMatch(candidate -> candidate.id().equals(root))) {
            throw new IllegalArgumentException(MESSAGES.getString("git.root.invalid"));
        }
        if (name.isBlank() || name.startsWith("-") || name.equals("HEAD")
                || !GitRefNameValidator.getInstance().checkInput(name)) {
            throw new IllegalArgumentException(MESSAGES.getString("git.name.invalid"));
        }
        JsonObject result = new JsonObject();
        List<String> branches = access.branches(root);
        if (!matchingBranches(root, key, branches).isEmpty()) {
            result.addProperty("created", false);
            return result;
        }
        if (!base.equals("HEAD") && !branches.contains(base)) {
            throw new IllegalArgumentException(MESSAGES.getString("git.base.invalid"));
        }
        access.create(root, name, base);
        result.addProperty("created", true);
        return result;
    }

    private List<String> matchingBranches(String root, String key, List<String> branches) {
        Pattern ticket = Pattern.compile("(?<![A-Z0-9])" + Pattern.quote(key) + "(?![A-Z0-9]|-\\d)", Pattern.CASE_INSENSITIVE);
        List<String> matches = branches.stream().filter(branch -> ticket.matcher(branch
                .replaceFirst("^refs/remotes/[^/]+/", "").replaceFirst("^refs/heads/", "")).find()).toList();
        Logger.getLogger(GitBranches.class.getName()).info("Branch lookup refs: key=" + key + ", root=" + root
                + ", refs=" + branches.size() + ", matches=" + matches);
        return matches;
    }

    private static String text(JsonObject request, String field) {
        if (!request.has(field) || !request.get(field).isJsonPrimitive() || !request.getAsJsonPrimitive(field).isString()) {
            throw new IllegalArgumentException(MESSAGES.getString("request.invalid"));
        }
        return request.get(field).getAsString();
    }
}
