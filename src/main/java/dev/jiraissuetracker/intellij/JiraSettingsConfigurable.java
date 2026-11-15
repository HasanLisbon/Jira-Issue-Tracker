package dev.jiraissuetracker.intellij;

import com.google.gson.JsonObject;
import com.intellij.openapi.application.ApplicationManager;
import com.intellij.openapi.diagnostic.Logger;
import com.intellij.openapi.options.Configurable;
import com.intellij.openapi.options.ConfigurationException;
import com.intellij.openapi.progress.ProgressIndicator;
import com.intellij.openapi.progress.ProgressManager;
import com.intellij.openapi.progress.Task;
import com.intellij.openapi.ui.Messages;
import org.jetbrains.annotations.NotNull;

import javax.swing.DefaultListCellRenderer;
import javax.swing.DefaultListModel;
import javax.swing.JButton;
import javax.swing.JCheckBox;
import javax.swing.JComponent;
import javax.swing.JLabel;
import javax.swing.JList;
import javax.swing.JPanel;
import javax.swing.JPasswordField;
import javax.swing.JScrollPane;
import javax.swing.JSplitPane;
import javax.swing.JTabbedPane;
import javax.swing.JTextField;
import javax.swing.ListSelectionModel;
import javax.swing.event.DocumentEvent;
import javax.swing.event.DocumentListener;
import java.awt.BorderLayout;
import java.awt.Component;
import java.awt.Dimension;
import java.awt.FlowLayout;
import java.awt.GridLayout;
import java.util.ArrayList;
import java.util.Arrays;
import java.util.List;
import java.util.Objects;
import java.util.ResourceBundle;

public final class JiraSettingsConfigurable implements Configurable {
    private static final ResourceBundle MESSAGES =
            ResourceBundle.getBundle("src");

    private static final Logger LOG =
            Logger.getInstance(JiraSettingsConfigurable.class);

    private final DefaultListModel<ServerEditor> servers =
            new DefaultListModel<>();

    private JPanel panel;
    private JPanel details;
    private JTabbedPane tabs;
    private JList<ServerEditor> serverList;
    private JButton removeButton;
    private JTextField commitMessageTemplate;
    private JTextField teamsIcsUrl;
    private JCheckBox teamsUseGraph;
    private JPasswordField teamsGraphToken;

    @Override
    public String getDisplayName() {
        return MESSAGES.getString("settings.title");
    }

    @Override
    public JComponent createComponent() {
        panel = new JPanel(new BorderLayout(0, 8));
        details = new JPanel(new BorderLayout());

        serverList = new JList<>(servers);
        serverList.setSelectionMode(
                ListSelectionModel.SINGLE_SELECTION
        );

        serverList.setCellRenderer(new DefaultListCellRenderer() {
            @Override
            public Component getListCellRendererComponent(
                    JList<?> list,
                    Object value,
                    int index,
                    boolean selected,
                    boolean focused
            ) {
                ServerEditor editor = (ServerEditor) value;
                String label = editor.name.getText().trim();

                if (label.isEmpty()) {
                    label = MESSAGES.getString(
                            "settings.server.unnamed"
                    );
                }

                return super.getListCellRendererComponent(
                        list,
                        label,
                        index,
                        selected,
                        focused
                );
            }
        });

        serverList.addListSelectionListener(event -> {
            if (!event.getValueIsAdjusting()) {
                showSelectedServer();
            }
        });

        JButton addButton = new JButton(
                MESSAGES.getString("settings.servers.add")
        );
        removeButton = new JButton(
                MESSAGES.getString("settings.servers.remove")
        );

        addButton.addActionListener(event -> addServer());
        removeButton.addActionListener(event -> removeServer());

        JPanel toolbar = new JPanel(
                new FlowLayout(FlowLayout.LEFT, 6, 0)
        );
        toolbar.add(addButton);
        toolbar.add(removeButton);

        JPanel master = new JPanel(new BorderLayout(0, 6));
        master.add(toolbar, BorderLayout.NORTH);
        master.add(
                new JScrollPane(serverList),
                BorderLayout.CENTER
        );
        master.setPreferredSize(new Dimension(420, 150));

        tabs = new JTabbedPane();
        tabs.addTab(
                MESSAGES.getString("settings.general.tab"),
                new JScrollPane(details)
        );

        JPanel commitMessage = new JPanel(
                new GridLayout(0, 1, 0, 6)
        );
        commitMessageTemplate = new JTextField();
        JLabel templateLabel = new JLabel(
                MESSAGES.getString("settings.commit.message.template")
        );
        templateLabel.setLabelFor(commitMessageTemplate);
        commitMessage.add(templateLabel);
        commitMessage.add(commitMessageTemplate);
        commitMessage.add(new JLabel(
                MESSAGES.getString("settings.commit.message.template.hint")
        ));
        tabs.addTab(
                MESSAGES.getString("settings.commit.message.tab"),
                commitMessage
        );

        JPanel teamsPanel = new JPanel(
                new GridLayout(0, 1, 0, 6)
        );
        teamsIcsUrl = new JTextField();
        JLabel icsLabel = new JLabel(
                MESSAGES.getString("meetings.ics.url")
        );
        icsLabel.setLabelFor(teamsIcsUrl);
        teamsPanel.add(icsLabel);
        teamsPanel.add(teamsIcsUrl);
        teamsPanel.add(new JLabel(
                MESSAGES.getString("meetings.ics.hint")
        ));

        teamsUseGraph = new JCheckBox(
                MESSAGES.getString("settings.teams.use.graph")
        );
        teamsPanel.add(teamsUseGraph);

        teamsGraphToken = new JPasswordField();
        JLabel graphLabel = new JLabel(
                MESSAGES.getString("meetings.graph.token")
        );
        graphLabel.setLabelFor(teamsGraphToken);
        teamsPanel.add(graphLabel);
        teamsPanel.add(teamsGraphToken);
        teamsPanel.add(new JLabel(
                MESSAGES.getString("meetings.graph.hint")
        ));

        tabs.addTab(
                MESSAGES.getString("settings.teams.tab"),
                new JScrollPane(teamsPanel)
        );

        JSplitPane split = new JSplitPane(
                JSplitPane.VERTICAL_SPLIT,
                master,
                tabs
        );
        split.setResizeWeight(0.35);
        split.setDividerLocation(150);

        panel.add(split, BorderLayout.CENTER);
        panel.add(
                new JLabel(MESSAGES.getString("settings.scope")),
                BorderLayout.SOUTH
        );

        reset();
        return panel;
    }

    private void addServer() {
        JiraSettings.ConnectionState connection =
                new JiraSettings.ConnectionState();

        connection.name = MESSAGES.getString(
                "settings.server.new"
        );

        ServerEditor editor = new ServerEditor(connection);
        servers.addElement(editor);
        serverList.setSelectedValue(editor, true);
        editor.name.requestFocusInWindow();
        editor.name.selectAll();
    }

    private void removeServer() {
        int selectedIndex = serverList.getSelectedIndex();

        if (selectedIndex < 0) {
            return;
        }

        servers.get(selectedIndex).password.setText("");
        servers.remove(selectedIndex);

        if (!servers.isEmpty()) {
            serverList.setSelectedIndex(
                    Math.min(selectedIndex, servers.size() - 1)
            );
        }

        showSelectedServer();
    }

    private void showSelectedServer() {
        details.removeAll();

        ServerEditor selected = serverList.getSelectedValue();
        removeButton.setEnabled(selected != null);

        if (selected == null) {
            details.add(
                    new JLabel(
                            MESSAGES.getString("settings.servers.empty")
                    ),
                    BorderLayout.NORTH
            );
        } else {
            details.add(selected, BorderLayout.NORTH);
        }

        details.revalidate();
        details.repaint();
    }

    @Override
    public boolean isModified() {
        if (panel == null) {
            return false;
        }

        JiraSettings.SettingsState savedState =
                JiraSettings.getInstance().getState();
        List<JiraSettings.ConnectionState> saved = savedState.servers;

        if (!Objects.equals(
                savedState.commitMessageTemplate,
                commitMessageTemplate.getText()
        )) {
            return true;
        }

        if (!Objects.equals(
                Objects.requireNonNullElse(savedState.teamsIcsUrl, ""),
                teamsIcsUrl.getText().trim()
        )
                || savedState.teamsUseGraph != teamsUseGraph.isSelected()
                || hasEnteredTeamsToken()) {
            return true;
        }

        if (saved.size() != servers.size()) {
            return true;
        }

        for (int i = 0; i < servers.size(); i++) {
            ServerEditor editor = servers.get(i);
            JiraSettings.ConnectionState edited =
                    editor.connection();
            JiraSettings.ConnectionState previous = saved.get(i);

            if (!previous.name.equals(edited.name)
                    || !previous.url.equals(edited.url)
                    || !previous.username.equals(edited.username)
                    || !previous.query.equals(edited.query)
                    || previous.bearer != edited.bearer
                    || editor.hasEnteredSecret()) {
                return true;
            }
        }

        return false;
    }

    @Override
    public void apply() throws ConfigurationException {
        List<JiraSettings.ConnectionState> connections =
                new ArrayList<>();
        List<String> enteredSecrets = new ArrayList<>();

        try {
            for (int i = 0; i < servers.size(); i++) {
                ServerEditor editor = servers.get(i);
                connections.add(editor.connection());

                char[] entered = editor.password.getPassword();

                try {
                    enteredSecrets.add(new String(entered));
                } finally {
                    Arrays.fill(entered, '\0');
                }
            }

            char[] enteredTeamsChars = teamsGraphToken.getPassword();
            String enteredTeamsSecret;
            try {
                enteredTeamsSecret = new String(enteredTeamsChars);
            } finally {
                Arrays.fill(enteredTeamsChars, '\0');
            }

            JiraSettings.getInstance().save(
                    connections,
                    enteredSecrets,
                    commitMessageTemplate.getText(),
                    teamsIcsUrl.getText().trim(),
                    teamsUseGraph.isSelected(),
                    enteredTeamsSecret
            );

            reset();
        } catch (IllegalArgumentException exception) {
            throw new ConfigurationException(
                    exception.getMessage()
            );
        } catch (RuntimeException exception) {
            LOG.warn(
                    "Saving Jira settings failed: "
                            + exception.getClass().getName()
                            + "; rollback failures: "
                            + exception.getSuppressed().length
            );

            throw new ConfigurationException(
                    MESSAGES.getString("settings.save.failed")
            );
        } finally {
            enteredSecrets.clear();
        }
    }

    @Override
    public void reset() {
        if (panel == null) {
            return;
        }

        int selectedIndex = serverList.getSelectedIndex();
        JiraSettings.SettingsState savedState =
                JiraSettings.getInstance().getState();
        commitMessageTemplate.setText(savedState.commitMessageTemplate);
        teamsIcsUrl.setText(
                Objects.requireNonNullElse(savedState.teamsIcsUrl, "")
        );
        teamsUseGraph.setSelected(savedState.teamsUseGraph);
        teamsGraphToken.setText("");
        clearEditors();

        for (JiraSettings.ConnectionState connection : savedState.servers) {
            servers.addElement(new ServerEditor(connection));
        }

        if (!servers.isEmpty()) {
            serverList.setSelectedIndex(
                    Math.max(
                            0,
                            Math.min(selectedIndex, servers.size() - 1)
                    )
            );
        }

        showSelectedServer();
    }

    private void testConnection(ServerEditor editor) {
        JPanel owner = panel;
        JiraSettings.ConnectionState connection =
                editor.connection();

        char[] entered = editor.password.getPassword();
        String enteredSecret;

        try {
            enteredSecret = new String(entered);
        } finally {
            Arrays.fill(entered, '\0');
        }

        editor.testButton.setEnabled(false);

        ProgressManager.getInstance().run(
                new Task.Backgroundable(
                        null,
                        MESSAGES.getString("settings.test"),
                        false
                ) {
                    @Override
                    public void run(
                            @NotNull ProgressIndicator indicator
                    ) {
                        String result;
                        boolean success;

                        try {
                            connection.url =
                                    JiraHttpTransport.normalizeUrl(
                                            connection.url
                                    );

                            String selectedSecret =
                                    enteredSecret.isEmpty()
                                            ? JiraSettings.getInstance()
                                            .secret(connection)
                                            : enteredSecret;

                            try (var client =
                                         JiraConnection.httpClient()) {

                                JiraClient jira = new JiraClient(
                                        new JiraHttpTransport(
                                                client,
                                                connection.url,
                                                connection.username,
                                                selectedSecret,
                                                connection.bearer
                                        )
                                );

                                JsonObject request = new JsonObject();
                                request.addProperty(
                                        "operation",
                                        "myself"
                                );

                                JsonObject identity =
                                        jira.execute(request)
                                                .getAsJsonObject();

                                if (!identity.has("name")
                                        && !identity.has("key")) {
                                    throw new IllegalArgumentException(
                                            MESSAGES.getString(
                                                    "connection.not.json"
                                            )
                                    );
                                }
                            }

                            result = MESSAGES.getString(
                                    "settings.test.success"
                            );
                            success = true;
                        } catch (Exception exception) {
                            if (exception
                                    instanceof InterruptedException) {
                                Thread.currentThread().interrupt();
                            }

                            LOG.warn(
                                    "Testing Jira connection failed: "
                                            + exception.getClass().getName()
                            );

                            result =
                                    exception instanceof
                                            IllegalArgumentException
                                            && MESSAGES.keySet().stream()
                                            .anyMatch(key ->
                                                    MESSAGES.getString(key)
                                                            .equals(
                                                                    exception.getMessage()
                                                            )
                                            )
                                            ? exception.getMessage()
                                            : MESSAGES.getString(
                                            "operation.failed"
                                    );

                            success = false;
                        }

                        String message = result;
                        boolean connected = success;

                        ApplicationManager.getApplication()
                                .invokeLater(() -> {
                                    if (panel != owner
                                            || !servers.contains(editor)) {
                                        return;
                                    }

                                    editor.testButton.setEnabled(true);

                                    if (connected) {
                                        Messages.showInfoMessage(
                                                owner,
                                                message,
                                                getDisplayName()
                                        );
                                    } else {
                                        Messages.showErrorDialog(
                                                owner,
                                                message,
                                                getDisplayName()
                                        );
                                    }
                                });
                    }
                }
        );
    }

    private void clearEditors() {
        for (int i = 0; i < servers.size(); i++) {
            servers.get(i).password.setText("");
        }

        servers.clear();
    }

    @Override
    public void disposeUIResources() {
        clearEditors();

        if (details != null) {
            details.removeAll();
        }

        panel = null;
        details = null;
        tabs = null;
        serverList = null;
        removeButton = null;
        commitMessageTemplate = null;
        if (teamsGraphToken != null) {
            teamsGraphToken.setText("");
        }
        teamsIcsUrl = null;
        teamsUseGraph = null;
        teamsGraphToken = null;
    }

    private boolean hasEnteredTeamsToken() {
        if (teamsGraphToken == null) {
            return false;
        }
        char[] entered = teamsGraphToken.getPassword();
        try {
            return entered.length != 0;
        } finally {
            Arrays.fill(entered, '\0');
        }
    }

    private final class ServerEditor extends JPanel {
        private final String id;
        private final JTextField name = new JTextField();
        private final JTextField url = new JTextField();
        private final JTextField username = new JTextField();
        private final JTextField query = new JTextField();
        private final JPasswordField password =
                new JPasswordField();

        private final JCheckBox bearer = new JCheckBox(
                MESSAGES.getString("settings.bearer")
        );

        private final JButton testButton = new JButton(
                MESSAGES.getString("settings.test")
        );

        private ServerEditor(
                JiraSettings.ConnectionState connection
        ) {
            super(new GridLayout(0, 1, 0, 6));
            id = connection.id;

            addField("settings.server.name", name);
            addField("settings.url", url);
            addField("settings.username", username);
            add(bearer);
            addField("settings.secret", password);
            add(
                    new JLabel(
                            MESSAGES.getString("settings.secret.hint")
                    )
            );
            addField("settings.query", query);
            add(testButton);

            name.setText(connection.name);
            url.setText(connection.url);
            username.setText(connection.username);
            query.setText(connection.query);
            bearer.setSelected(connection.bearer);
            username.setEnabled(!connection.bearer);

            bearer.addActionListener(event ->
                    username.setEnabled(!bearer.isSelected())
            );

            testButton.addActionListener(event ->
                    testConnection(this)
            );

            name.getDocument().addDocumentListener(
                    new DocumentListener() {
                        @Override
                        public void insertUpdate(DocumentEvent event) {
                            refreshLabel();
                        }

                        @Override
                        public void removeUpdate(DocumentEvent event) {
                            refreshLabel();
                        }

                        @Override
                        public void changedUpdate(DocumentEvent event) {
                            refreshLabel();
                        }

                        private void refreshLabel() {
                            if (serverList != null) {
                                serverList.repaint();
                            }
                        }
                    }
            );
        }

        private void addField(
                String key,
                JComponent field
        ) {
            JLabel label = new JLabel(MESSAGES.getString(key));
            label.setLabelFor(field);
            add(label);
            add(field);
        }

        private JiraSettings.ConnectionState connection() {
            JiraSettings.ConnectionState connection =
                    new JiraSettings.ConnectionState();

            connection.id = id;
            connection.name = name.getText().trim();
            connection.url = url.getText().trim();
            connection.username = username.getText().trim();
            connection.query = query.getText().trim();
            connection.bearer = bearer.isSelected();

            return connection;
        }

        private boolean hasEnteredSecret() {
            char[] entered = password.getPassword();

            try {
                return entered.length != 0;
            } finally {
                Arrays.fill(entered, '\0');
            }
        }
    }
}
