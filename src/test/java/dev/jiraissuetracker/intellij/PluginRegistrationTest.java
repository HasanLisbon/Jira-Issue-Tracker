package dev.jiraissuetracker.intellij;

import org.junit.Test;
import org.w3c.dom.Document;
import org.w3c.dom.Element;
import org.w3c.dom.NodeList;

import javax.xml.XMLConstants;
import javax.xml.parsers.DocumentBuilderFactory;
import java.io.InputStream;
import java.nio.file.Files;
import java.nio.file.Path;

import static org.junit.Assert.assertEquals;
import static org.junit.Assert.assertNotNull;
import static org.junit.Assert.assertTrue;

public class PluginRegistrationTest {
    @Test
    public void when_pluginDescriptorIsRead_then_loadPlugin_should_ExposeToolWindow() throws Exception {
        Path descriptorPath = Path.of("src", "main", "resources", "META-INF", "plugin.xml");
        assertTrue("The project plugin descriptor must exist", Files.isRegularFile(descriptorPath));
        try (InputStream descriptor = Files.newInputStream(descriptorPath)) {
            DocumentBuilderFactory factory = DocumentBuilderFactory.newInstance();
            factory.setFeature(XMLConstants.FEATURE_SECURE_PROCESSING, true);
            factory.setFeature("http://apache.org/xml/features/disallow-doctype-decl", true);
            factory.setXIncludeAware(false);
            factory.setExpandEntityReferences(false);
            Document document = factory.newDocumentBuilder().parse(descriptor);
            NodeList toolWindows = document.getElementsByTagName("toolWindow");

            assertEquals("A single Jira Issues tool window must be registered", 1, toolWindows.getLength());
            Element toolWindow = (Element) toolWindows.item(0);
            assertEquals("Jira Issues", toolWindow.getAttribute("id"));
            assertEquals(
                    "dev.jiraissuetracker.intellij.JiraIssuesToolWindowFactory",
                    toolWindow.getAttribute("factoryClass")
            );
            assertNotNull(Class.forName(toolWindow.getAttribute("factoryClass")));
        }
    }
}
