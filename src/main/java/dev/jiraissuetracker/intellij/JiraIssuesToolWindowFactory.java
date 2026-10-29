package dev.jiraissuetracker.intellij;

import com.intellij.openapi.Disposable;
import com.intellij.openapi.project.Project;
import com.intellij.openapi.util.Disposer;
import com.intellij.openapi.wm.ToolWindow;
import com.intellij.openapi.wm.ToolWindowFactory;
import com.intellij.ui.content.ContentFactory;
import com.intellij.ui.jcef.JBCefApp;
import com.intellij.ui.jcef.JBCefBrowser;

import javax.swing.JLabel;
import javax.swing.JPanel;
import java.awt.BorderLayout;
import java.io.IOException;
import java.util.ResourceBundle;

public final class JiraIssuesToolWindowFactory implements ToolWindowFactory {
    private static final ResourceBundle MESSAGES = ResourceBundle.getBundle("messages.JiraIssuesBundle");

    @Override
    public void createToolWindowContent(Project project, ToolWindow toolWindow) {
        JPanel panel = new JPanel(new BorderLayout());
        if (!JBCefApp.isSupported()) {
            panel.add(new JLabel(MESSAGES.getString("jcef.unavailable")), BorderLayout.CENTER);
        } else {
            try {
                JiraConnection connection = new JiraConnection(project);
                FrontendAssetServer server = new FrontendAssetServer(connection::execute);
                JBCefBrowser browser;
                try {
                    browser = new JBCefBrowser(server.getSessionUrl());
                } catch (RuntimeException exception) {
                    server.dispose();
                    throw exception;
                }
                Disposer.register(project, server);
                Disposer.register(project, browser);
                panel.add(browser.getComponent(), BorderLayout.CENTER);
            } catch (IOException exception) {
                panel.add(new JLabel(MESSAGES.getString("frontend.start.failed")), BorderLayout.CENTER);
            }
        }
        toolWindow.getContentManager().addContent(
                ContentFactory.getInstance().createContent(panel, null, false)
        );
    }
}
