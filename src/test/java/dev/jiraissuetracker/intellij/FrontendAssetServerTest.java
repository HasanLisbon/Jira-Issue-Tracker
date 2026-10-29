package dev.jiraissuetracker.intellij;

import org.junit.Test;

import java.io.InputStream;
import java.lang.reflect.Constructor;
import java.lang.reflect.Method;
import java.net.HttpURLConnection;
import java.net.URL;
import java.nio.charset.StandardCharsets;

import static org.junit.Assert.assertEquals;
import static org.junit.Assert.assertTrue;
import static org.junit.Assert.fail;

public class FrontendAssetServerTest {
    private static final String SERVER_CLASS = "dev.jiraissuetracker.intellij.FrontendAssetServer";

    @Test
    public void whenServerReceivesRootRequest_then_serve_should_ReturnFrontendHtml() throws Exception {
        Object server = createServer();
        try {
            HttpURLConnection connection = openConnection(server, "");
            try {
                assertEquals(200, connection.getResponseCode());
                try (InputStream response = connection.getInputStream()) {
                    String html = new String(response.readAllBytes(), StandardCharsets.UTF_8);
                    assertTrue(html.contains("id=\"root\""));
                }
            } finally {
                connection.disconnect();
            }
        } finally {
            disposeServer(server);
        }
    }

    @Test
    public void whenServerReceivesTraversalRequest_then_serve_should_ReturnNotFound() throws Exception {
        Object server = createServer();
        try {
            HttpURLConnection connection = openConnection(server, "..%2fMETA-INF%2fplugin.xml");
            try {
                assertEquals(404, connection.getResponseCode());
            } finally {
                connection.disconnect();
            }
        } finally {
            disposeServer(server);
        }
    }

    private static Object createServer() throws Exception {
        Class<?> serverType;
        try {
            serverType = Class.forName(SERVER_CLASS);
        } catch (ClassNotFoundException exception) {
            fail("The bundled frontend server must be implemented before the plugin is loaded");
            throw exception;
        }
        Constructor<?> constructor = serverType.getDeclaredConstructor();
        constructor.setAccessible(true);
        return constructor.newInstance();
    }

    private static HttpURLConnection openConnection(Object server, String path) throws Exception {
        Method getUrl = server.getClass().getDeclaredMethod("getUrl");
        getUrl.setAccessible(true);
        String baseUrl = (String) getUrl.invoke(server);
        HttpURLConnection connection = (HttpURLConnection) new URL(baseUrl + path).openConnection();
        connection.setConnectTimeout(3000);
        connection.setReadTimeout(3000);
        return connection;
    }

    private static void disposeServer(Object server) throws Exception {
        Method dispose = server.getClass().getDeclaredMethod("dispose");
        dispose.setAccessible(true);
        dispose.invoke(server);
    }
}
