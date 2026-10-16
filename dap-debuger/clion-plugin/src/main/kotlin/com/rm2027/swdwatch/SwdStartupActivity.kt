package com.rm2027.swdwatch

import com.intellij.openapi.project.Project
import com.intellij.openapi.startup.ProjectActivity
import com.rm2027.swdwatch.engine.SwdWatchService

class SwdStartupActivity : ProjectActivity {
    override suspend fun execute(project: Project) {
        SwdWatchService.getInstance(project)
    }
}
