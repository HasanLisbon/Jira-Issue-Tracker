package dev.jiraissuetracker.intellij;

import com.intellij.openapi.util.IconLoader;
import kotlin.jvm.JvmField;

import javax.swing.*;

public interface AppIcon {
    @JvmField
    Icon MyAction = IconLoader.getIcon("/icons/add_task.svg", AppIcon.class);
}
