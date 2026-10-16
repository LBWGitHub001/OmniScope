package com.rm2027.swdwatch

import androidx.compose.ui.awt.ComposePanel
import com.intellij.openapi.project.Project
import com.intellij.openapi.wm.ToolWindow
import com.intellij.openapi.wm.ToolWindowFactory
import com.rm2027.swdwatch.ui.SwdWatchApp
import org.jetbrains.jewel.bridge.theme.SwingBridgeTheme

class SwdWatchToolWindowFactory : ToolWindowFactory {
    override fun createToolWindowContent(project: Project, toolWindow: ToolWindow) {
        val panel = ComposePanel()
        panel.setContent {
            SwingBridgeTheme {
                SwdWatchApp(project)
            }
        }
        val content = toolWindow.contentManager.factory.createContent(panel, "", false)
        toolWindow.contentManager.addContent(content)
    }
}
