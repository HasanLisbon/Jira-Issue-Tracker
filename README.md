# Jira Issue Tracker IntelliJ Plugin

A Jira tool window with the existing dark card-based Issues, Tracker, and Details interface, plus confirmed Git branch creation when starting task timers. There is no simulated IDE view or view-mode toggle.

## Jira connection and usage

The settings screen places the server list above the **General** and **Commit Message** tabs. In an issue's **Details** view, **Copy commit message** copies the formatted message to the clipboard; it does not integrate with VCS.

The plugin has its own IDE-wide Jira Server/Data Center connection, independent of IntelliJ Tasks. Credentials are stored in IntelliJ Password Safe and are never sent to the React interface or stored in project files. Non-secret settings are saved in `jiraIssueTracker.xml` in the IDE configuration directory, with settings roaming disabled. Password persistence follows your IntelliJ Password Safe configuration; memory-only storage requires re-entering the secret after an IDE restart.

1. Open **Settings > Tools > Jira Issue Tracker**, or use the tool window's connection-settings button. Enter the Jira base URL (including any context path, such as `/jira`), username, and password. For a Jira personal access token, select **Use a personal access token (Bearer authentication)** instead. Use HTTPS: HTTP sends credentials without transport encryption. Do not enter a REST API URL.
2. Use **Test Connection** to check the entered values without saving them. Choose **Apply** or **OK**, then **Refresh** in the tool-window connection dialog. Tasks credentials are not imported or modified. Add multiple named connections in the server list, including the same Jira base URL more than once. Give each entry a distinct name (for example, its repository name) and its own **Default JQL**. Entries with the same URL, username, and authentication type share the Password Safe secret; removing an entry deletes that secret only when no remaining entry uses it. Leave the password/token blank to retain an already saved secret. Conflicting secrets for the same login are rejected. In **Commit Message**, set the template; `{issueKey}` and `{summary}` are replaced with the selected issue's key and summary. The default is `{issueKey}: {summary}`.
3. Select a saved connection by name in each project's tool-window selector to load its default JQL. Selection is manual, not automatically associated with a Git repository, and resets to the first entry when the tool window reloads. Existing saved entries are upgraded automatically without changing their URL, JQL, or credentials. Edit JQL and choose **Load issues** or refresh; both reload the saved connection list while preserving the selected connection and temporary JQL when that connection still exists. Tool-window query edits are temporary, so save persistent defaults in settings. Assigned, Reported, Recent, and Sprint filters are applied by Jira, within the configured query. All result pages are fetched, not just the first page.
4. Open an issue's **Details** to see Jira fields and comments. The status selector uses the exact transitions Jira currently permits. Comments and replies are written to Jira; a reply is a new comment linking to the original comment because standard Jira Server/Data Center comments are flat, not threaded.
5. Use **Tracker** to select an issue, start/pause the timer, or enter a duration such as `1h 30m`. Set the start date/time and work description, then submit the worklog. Start times and existing worklogs use your system's local time zone, with the offset for the entered date (including daylight-saving changes). Timestamps are posted in Jira's numeric-offset format, for example `+0100` in Swedish winter time and `+0200` in summer time. Nonexistent local times during the spring clock change are rejected; repeated times during the autumn change use the first occurrence. Remaining estimates are left unchanged. The timer resets only after Jira accepts the worklog.

Only the selected connection's configured Jira URL is used. The frontend communicates through a session-protected loopback bridge, not directly with Jira or Git. Git operations use IntelliJ's Git integration for repositories configured in the current project. Refreshes, writes, and Git commands run off the IDE UI thread. Failures are displayed rather than represented as successful local edits.

### Task branches

Use **Start Task**, **Start**, a subtask's timer action, or the Tracker issue selector to check for an existing branch before starting the timer. The plugin loads the issue's parent when present and uses that parent ticket key for branch matching and naming; the timer and worklog still belong to the task you clicked. Without a parent, the issue's own key is used. Selecting a card or opening Details does not start a timer.

- A matching local or remote-tracking branch in any project Git repository starts only the timer. Ticket keys are matched as complete keys, so `TEST-12` does not match `TEST-123`.
- Each task card shows matching branch names below its title, or **No branch created** when none exist. Cards check branches when issues load or refresh and update after confirmed creation. Loading and failed lookups have separate labels; hover over a failed lookup for the error. Parent-ticket matches are shared by its task cards.
- If no match exists, a confirmation dialog suggests `bugfix/TICKET-summary` for a Bug or `feature/TICKET-summary` otherwise. Change the type or edit the complete branch name before confirming. Keep the ticket key in the name for future automatic detection.
- Choose the target repository explicitly when the project has multiple repositories. **Base branch** lists all locally known local and remote-tracking branches for that repository, grouped by type; **Current HEAD** is the default. Changing the repository resets the base to its current HEAD. **Create branch & start timer** creates and checks out a local branch from the selected base and starts the task timer only after creation succeeds. The plugin never pushes or force-replaces a branch. If a selected base branch has been deleted, cancel and reopen the dialog to refresh the list.
- **Start timer only** skips creation; **Cancel** leaves the timer unchanged. With no configured Git repository, only timer-only and cancel are available. Invalid names and Git failures remain visible in the dialog for correction or retry.
- Branches are checked again before creation to avoid duplicating a ticket branch created while the dialog was open. Checks use locally available refs; fetch through IntelliJ first to discover branches that exist only on the remote server. The plugin does not perform network fetches.
- The Issues list hides a task whose Jira-linked branches (development panel, `rest/dev-status`) all belong to repositories other than the project's `origin`. Tasks without linked branches, with a matching local branch, or whose development data cannot be loaded stay visible. Repositories are compared by `project/repo` path; the host is ignored. The dev-status API is undocumented and may differ per Jira version.

Requests use a direct HTTP client rather than the Tasks Jira client, with IntelliJ's certificate manager and the runtime's default proxy selector. Connection establishment has a 15-second timeout; each API request has a 30-second timeout. Redirects are rejected to avoid forwarding credentials to an SSO or different host. Authentication, permission, proxy, TLS, timeout, and non-JSON responses have distinct errors. This independence does not guarantee a fix for failures caused by network, proxy, certificates, or Jira itself.

### Limitations

- Jira Server/Data Center is supported; Jira Cloud remains outside the supported scope.
- Jira permissions and workflow validators still apply. Transitions requiring additional fields cannot be completed by the quick status selector; complete those transitions in Jira.
- Worklog durations use hours/minutes and must be positive. Billable flags are not offered because the standard Jira worklog API does not provide that field.
- Timer state and unsent drafts are in memory and do not survive closing/reloading the tool window. Log or reset a timer before switching to a different issue or connection.
- Writes are never automatically retried. If a connection fails during a write, inspect Jira before retrying because the server may have accepted the write before the response was lost.

## Build

Use a JDK compatible with the selected IntelliJ platform, Node.js, npm, and the checked-in Gradle wrapper (9.6.0). Java sources target Java 21; the default IntelliJ target is declared in `gradle.properties`.

1. Install frontend dependencies with `npm install` when needed.
2. Run `npm run lint` and `npm test` for frontend checks.
   Run `npm run test:browser` for the task/branch dialog regression in a local headless Chrome or Edge (Chrome is preferred when both are installed). Set `TRACKER_BROWSER` to choose a Chromium executable explicitly or when it is not installed in a standard Windows location. The browser test uses fixture Jira/Git responses and does not contact Jira or modify a project repository; it is skipped explicitly if no browser is available. Gradle `check` runs it against the bundled frontend as well.
3. Run `.\gradlew.bat test check buildPlugin` from the project root. The Gradle build compiles the frontend, runs frontend contract tests during `check`, and bundles frontend assets into the plugin.
4. Find the installable plugin ZIP under `build\distributions\`.

The plugin requires a runtime with JCEF support and the bundled Git plugin enabled; IntelliJ's Tasks plugin is not required. Install the ZIP using **Install Plugin from Disk**, restart if prompted, and open **Jira Issue Tracker**.

## Standalone UI preview

Run `npm run dev` to preview the tool-window layout outside IntelliJ. The preview has no Jira bridge or credentials and displays an explicit connection-unavailable message instead of sample data or simulated successful writes.
